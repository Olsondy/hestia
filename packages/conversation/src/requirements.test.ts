import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { pool } from '../../persistence/src/client';
import { createProject, getProject } from '../../projects/src/service';
import { createTask, getTask, appendConversationInput, cancelTask, readTaskEvents } from '../../tasks/src/service';
import { claimTask, runTask } from '../../tasks/src/runner';
import { initializeQueue, createQueueClient, TASK_QUEUE } from '../../tasks/src/queue';
import { taskEventStream } from '../../tasks/src/events';
import { fixtureModel, toolChunks } from '../../model-validation/src/protocol-fixture';
import type { TaskView } from '../../contracts/src/tasks';

const owner = { userId: `requirements-${randomUUID()}` }, other = { userId: `requirements-${randomUUID()}` };
const schema = `requirements_${randomUUID().replaceAll('-', '')}`; let producer: PgBoss;
const create = () => createProject(owner, { name: '合成居住需求验收', template: 'courtyard', operationId: randomUUID() });
const input = (message = '需要会客与办公，保留现有书桌') => ({ protocol: 'conversation-v1', operationId: randomUUID(), expectedRevision: 1,
  message, referenceFrame: 'plan', selectedObjectId: 'sofa-a' });
const update = (task: TaskView, message = '每晚阅读一小时') => ({ kind: 'message', operationId: randomUUID(), expectedIntentVersion: task.conversation!.brief!.intentVersion,
  expectedRevision: task.checkpoint.expectedRevision, message });
const answer = { kind: 'answer', message: '已整理本轮需求，未修改空间。' };
const proposal = (task: TaskView, questions = [{ key: 'reading_schedule', prompt: '通常在什么时间阅读？' }]) => ({ summary: '会客与办公可以先分别整理功能，照明建议待确认。',
  requirements: [{ content: task.conversation!.input.message, sourceKind: 'user_explicit', sourceInputIds: [task.conversation!.brief!.inputs.at(-1)!.id] },
    { content: '增加独立阅读灯', sourceKind: 'assistant_suggestion', sourceInputIds: [] }], questions });
const model = (brief?: unknown, decision: unknown = answer, onRequest?: () => void) => fixtureModel(toolChunks({ reply: '先整理会客和办公功能；阅读照明可独立控制。', decision, ...(brief ? { brief } : {}) }, 'resolve_turn'), onRequest);
before(async () => { producer = await initializeQueue(schema); });
after(async () => {
  await pool.query('DELETE FROM operations WHERE actor_id=$1', [owner.userId]);
  await pool.query('DELETE FROM project_revisions WHERE project_id IN (SELECT id FROM projects WHERE created_by=$1)', [owner.userId]);
  await pool.query('DELETE FROM projects WHERE created_by=$1', [owner.userId]);
  assert.match(schema, /^requirements_[a-f0-9]{32}$/); await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end();
});

test('requirements and independent answer persist before waiting; answers resume once and answered questions cannot reopen', async () => {
  const p = await create(), initial = await createTask(owner, p.id, input(), producer);
  await runTask(initial.id, { conversation: { model: model(proposal(initial)) } });
  const waiting = await getTask(owner, p.id, initial.id), brief = waiting.conversation!.brief!;
  assert.equal(waiting.status, 'waiting_input'); assert.equal(waiting.usage.used, 1); assert.equal(waiting.usage.reserved, 0);
  assert.equal((await pool.query('SELECT lease_until FROM design_tasks WHERE id=$1', [initial.id])).rows[0].lease_until, null);
  assert.equal(await claimTask(initial.id), null); assert.equal(brief.requirements.length, 2); assert.ok(brief.workCompleted.length);
  assert.equal(brief.scope, 'requirements_and_local_changes'); assert.equal((await getProject(owner, p.id)).revision, 1);
  const stream = await taskEventStream(owner, p.id, initial.id, 0, new AbortController().signal);
  assert.match(await stream.text(), /waiting_input/);
  await assert.rejects(createTask(owner, p.id, input('另开一个任务'), producer), { code: 'TASK_ACTIVE' });
  const request = { ...update(waiting), questionId: brief.questions[0].id };
  const [a, b] = await Promise.all([appendConversationInput(owner, p.id, initial.id, request, producer), appendConversationInput(owner, p.id, initial.id, request, producer)]);
  assert.equal(a.id, b.id); assert.equal(a.conversation!.brief!.intentVersion, 2); assert.equal(a.conversation!.brief!.inputs.length, 2);
  assert.equal(a.conversation!.brief!.history[0].reply, '先整理会客和办公功能；阅读照明可独立控制。');
  assert.equal(a.conversation!.brief!.questions[0].answerInputId, a.conversation!.brief!.inputs[1].id);
  let dispatches = 0;
  await runTask(initial.id, { intentVersion: 1, conversation: { model: model(undefined, answer, () => { dispatches++; }) } });
  assert.equal(dispatches, 0); assert.equal((await getTask(owner, p.id, initial.id)).status, 'queued');
  await runTask(initial.id, { intentVersion: 2, conversation: { model: model(proposal(a, [{ key: 'Reading-Schedule!', prompt: '换个问法：你何时阅读？' }]), answer, () => { dispatches++; }) } });
  const done = await getTask(owner, p.id, initial.id);
  assert.equal(dispatches, 1); assert.equal(done.status, 'completed'); assert.equal(done.usage.used, 2);
  assert.equal(done.conversation!.brief!.questions.length, 1); assert.equal(done.conversation!.brief!.questions[0].status, 'answered');
  await assert.rejects(appendConversationInput(owner, p.id, done.id, { ...update(done), questionId: brief.questions[0].id }, producer), { code: 'QUESTION_NOT_OPEN' });
  assert.equal((await producer.fetch<{ taskId: string; intentVersion: number }>(TASK_QUEUE, { batchSize: 100 })).filter(job => job.data.taskId === initial.id).length, 2);
});

test('only real revision-bound confirmation upgrades suggestions; re-suggestion cannot downgrade or duplicate it', async () => {
  const p = await create(), initial = await createTask(owner, p.id, input(), producer);
  await runTask(initial.id, { conversation: { model: model(proposal(initial, [])) } });
  const done = await getTask(owner, p.id, initial.id), suggestion = done.conversation!.brief!.requirements.find(item => item.sourceKind === 'assistant_suggestion')!;
  const request = { kind: 'confirm_requirement', operationId: randomUUID(), expectedIntentVersion: 1, expectedRevision: 1,
    requirementId: suggestion.id, requirementRevision: suggestion.revision };
  await assert.rejects(appendConversationInput(other, p.id, done.id, request, producer), { code: 'NOT_FOUND' });
  await assert.rejects(appendConversationInput(owner, p.id, done.id, { ...request, requirementRevision: 99 }, producer), { code: 'REQUIREMENT_CONFLICT' });
  const confirmed = await appendConversationInput(owner, p.id, done.id, request, producer);
  const saved = confirmed.conversation!.brief!.requirements.find(item => item.id === suggestion.id)!;
  assert.equal(saved.sourceKind, 'user_confirmed'); assert.equal(saved.revision, 2);
  assert.equal(saved.confirmedByInputId, confirmed.conversation!.brief!.inputs.at(-1)!.id);
  await runTask(done.id, { conversation: { model: model({ summary: '已记录照明需求。', requirements: [{ content: suggestion.content, sourceKind: 'assistant_suggestion', sourceInputIds: [] }], questions: [] }) } });
  const after = (await getTask(owner, p.id, done.id)).conversation!.brief!;
  assert.equal(after.requirements.filter(item => item.content === suggestion.content).length, 1);
  assert.equal(after.requirements.find(item => item.id === suggestion.id)!.sourceKind, 'user_confirmed');
  assert.equal((await getProject(owner, p.id)).revision, 1);
});

test('negation remains whole, while excerpted, quoted, interrogative and hypothetical sources cannot become explicit requirements', async () => {
  for (const source of ['不要保留书桌', '假设我以后想保留书桌', '例如：保留书桌', '保留书桌会怎样？', '他说“保留书桌”',
    '保留书桌会影响通行吗', '举例：保留书桌', '「保留书桌」只是示例']) {
    const p = await create(), task = await createTask(owner, p.id, input(source), producer);
    const content = source === '不要保留书桌' ? '保留书桌' : source;
    await runTask(task.id, { conversation: { model: model({ summary: '提炼', requirements: [{ content, sourceKind: 'user_explicit', sourceInputIds: [task.conversation!.brief!.inputs[0].id] }], questions: [] }) } });
    assert.equal((await getTask(owner, p.id, task.id)).error?.code, 'INVALID_EXPLICIT_REQUIREMENT');
    assert.equal((await getTask(owner, p.id, task.id)).conversation!.brief!.requirements.length, 0);
  }
  const p = await create(), task = await createTask(owner, p.id, input('不要保留书桌'), producer);
  await runTask(task.id, { conversation: { model: model(proposal(task, [])) } });
  assert.equal((await getTask(owner, p.id, task.id)).conversation!.brief!.requirements[0].content, '不要保留书桌');
  assert.equal((await getProject(owner, p.id)).revision, 1);
});

test('later exact user wording promotes a suggestion with provenance but never fabricates a confirmation event', async () => {
  const p = await create(), task = await createTask(owner, p.id, input(), producer);
  await runTask(task.id, { conversation: { model: model(proposal(task, [])) } });
  const done = await getTask(owner, p.id, task.id), suggestion = done.conversation!.brief!.requirements.find(item => item.sourceKind === 'assistant_suggestion')!;
  const next = await appendConversationInput(owner, p.id, task.id, update(done, suggestion.content), producer);
  await runTask(task.id, { conversation: { model: model({ summary: '已记录用户明确的照明需求。', requirements: [{ content: suggestion.content,
    sourceKind: 'user_explicit', sourceInputIds: [next.conversation!.brief!.inputs.at(-1)!.id] }], questions: [] }) } });
  const saved = (await getTask(owner, p.id, task.id)).conversation!.brief!.requirements.find(item => item.id === suggestion.id)!;
  assert.equal(saved.sourceKind, 'user_explicit'); assert.equal(saved.revision, 2); assert.equal(saved.confirmedByInputId, null);
  assert.ok(saved.sourceInputIds.includes(next.conversation!.brief!.inputs.at(-1)!.id));
});

test('confirmation of a requirement never supplies authority for a proposed furniture movement', async () => {
  const p = await create(), task = await createTask(owner, p.id, input(), producer), content = '把所选家具沿图纸向右移动20厘米';
  await runTask(task.id, { conversation: { model: model({ summary: '仅待确认的提议。', requirements: [{ content, sourceKind: 'assistant_suggestion', sourceInputIds: [] }], questions: [] }) } });
  const done = await getTask(owner, p.id, task.id), requirement = done.conversation!.brief!.requirements[0];
  const next = await appendConversationInput(owner, p.id, task.id, { kind: 'confirm_requirement', operationId: randomUUID(), expectedRevision: 1,
    expectedIntentVersion: 1, requirementId: requirement.id, requirementRevision: requirement.revision }, producer);
  await runTask(task.id, { conversation: { model: model(undefined, { kind: 'move', userAct: 'explicit_request', evidenceQuote: next.conversation!.input.message,
    direction: 'right', distanceText: '20', unit: 'cm' }) } });
  assert.equal((await getProject(owner, p.id)).revision, 1);
  assert.equal((await getTask(owner, p.id, task.id)).conversation!.outcome!.kind, 'clarification');
});

test('new input atomically fences an already persisted response without losing its settled usage or applying the old move', async () => {
  const p = await create(), task = await createTask(owner, p.id, input('把所选家具沿图纸向右移动20厘米'), producer);
  const move = { kind: 'move', userAct: 'explicit_request', evidenceQuote: task.conversation!.input.message, direction: 'right', distanceText: '20', unit: 'cm' };
  let next!: TaskView;
  await runTask(task.id, { conversation: { model: model(undefined, move), afterResponsePersisted: async () => {
    next = await appendConversationInput(owner, p.id, task.id, update(task, '不要移动，只整理照明需求'), producer);
  } } });
  assert.equal(next.usage.used, 1); assert.equal(next.conversation!.brief!.history[0].unknownUsage, false);
  assert.equal(next.status, 'queued'); assert.equal((await getProject(owner, p.id)).revision, 1);
  await runTask(task.id, { intentVersion: 2, conversation: { model: model() } });
  const final = await getTask(owner, p.id, task.id); assert.equal(final.usage.used, 2); assert.equal(final.status, 'completed');
  assert.equal((await readTaskEvents(owner, p.id, task.id, 0)).events.filter(event => event.type === 'operation').length, 0);
});

test('an interrupted unknown call is counted once across a superseding input and cannot be replayed by an old dispatch', async () => {
  const p = await create(), task = await createTask(owner, p.id, input(), producer); await claimTask(task.id);
  await pool.query("UPDATE design_tasks SET conversation=jsonb_set(conversation,'{callStarted}','true'),usage_reserved=1 WHERE id=$1", [task.id]);
  const request = update(task, '只保留办公功能'), next = await appendConversationInput(owner, p.id, task.id, request, producer);
  assert.equal(next.usage.used, 1); assert.equal(next.usage.reserved, 0); assert.equal(next.conversation!.brief!.history[0].unknownUsage, true);
  assert.deepEqual(next.conversation!.brief!.history[0].modelUsage, { inputTokens: null, outputTokens: null });
  assert.equal((await appendConversationInput(owner, p.id, task.id, request, producer)).usage.used, 1);
  assert.equal(await claimTask(task.id, 1), null);
  await runTask(task.id, { intentVersion: 2, conversation: { model: model() } });
  assert.equal((await getTask(owner, p.id, task.id)).usage.used, 2);
});

test('failed dispatch transaction rolls back answer, intent, generation and idempotency entry; cancellation and stale input stay fenced', async () => {
  const p = await create(), task = await createTask(owner, p.id, input(), producer);
  await runTask(task.id, { conversation: { model: model(proposal(task)) } });
  const waiting = await getTask(owner, p.id, task.id), request = { ...update(waiting), questionId: waiting.conversation!.brief!.questions[0].id };
  await assert.rejects(appendConversationInput(owner, p.id, task.id, request, createQueueClient(`${schema}_none`)));
  const unchanged = await getTask(owner, p.id, task.id); assert.deepEqual(unchanged, waiting);
  assert.equal((await pool.query('SELECT 1 FROM operations WHERE actor_id=$1 AND id=$2', [owner.userId, request.operationId])).rowCount, 0);
  await assert.rejects(appendConversationInput(owner, p.id, task.id, { ...request, expectedIntentVersion: 99 }, producer), { code: 'INTENT_CONFLICT' });
  await assert.rejects(appendConversationInput(owner, p.id, task.id, { ...request, expectedRevision: 99 }, producer), { code: 'REVISION_CONFLICT' });
  await cancelTask(owner, p.id, task.id);
  await assert.rejects(appendConversationInput(owner, p.id, task.id, request, producer), { code: 'TASK_NOT_CONTINUABLE' });
});

test('pending question does not block an independent exact move; waiting preserves its committed result', async () => {
  const p = await create(), task = await createTask(owner, p.id, input('把所选家具沿图纸向右移动20厘米'), producer);
  const move = { kind: 'move', userAct: 'explicit_request', evidenceQuote: task.conversation!.input.message, direction: 'right', distanceText: '20', unit: 'cm' };
  await runTask(task.id, { conversation: { model: model(proposal(task), move) } });
  const saved = await getTask(owner, p.id, task.id); assert.equal(saved.status, 'waiting_input'); assert.equal(saved.conversation!.outcome!.kind, 'applied');
  assert.equal((await getProject(owner, p.id)).revision, 2); assert.ok(saved.conversation!.brief!.workCompleted.includes('已提交精确局部修改'));
});

test('normal resumed rounds do not consume recovery retries or reset the bounded task call allowance', async () => {
  const p = await create(); let task = await createTask(owner, p.id, input(), producer);
  for (let round = 1; round <= 8; round++) {
    await runTask(task.id, { conversation: { model: model() } }); task = await getTask(owner, p.id, task.id);
    assert.equal(task.usage.used, round); assert.equal(task.status, 'completed');
    if (round < 8) task = await appendConversationInput(owner, p.id, task.id, update(task, `第${round}次补充：保留已有信息`), producer);
  }
  await assert.rejects(appendConversationInput(owner, p.id, task.id, update(task), producer), { code: 'USAGE_LIMIT' });
  assert.equal((await getTask(owner, p.id, task.id)).usage.used, 8);
});

test('claim recovery exhaustion still counts an interrupted unknown model call instead of dropping its reservation', async () => {
  const p = await create(), task = await createTask(owner, p.id, input(), producer);
  await claimTask(task.id);
  await pool.query("UPDATE design_tasks SET conversation=jsonb_set(conversation,'{callStarted}','true'),usage_reserved=1 WHERE id=$1", [task.id]);
  for (let retry = 0; retry < 2; retry++) {
    await pool.query("UPDATE design_tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [task.id]);
    assert.ok(await claimTask(task.id));
  }
  await pool.query("UPDATE design_tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [task.id]);
  assert.equal(await claimTask(task.id), null);
  const saved = await getTask(owner, p.id, task.id);
  assert.equal(saved.status, 'failed'); assert.equal(saved.error?.code, 'RETRY_LIMIT');
  assert.equal(saved.usage.used, 1); assert.equal(saved.usage.reserved, 0);
  assert.deepEqual(saved.conversation!.modelUsage, { inputTokens: null, outputTokens: null });
  assert.match(saved.error!.message, /用量待核对/u);
});
