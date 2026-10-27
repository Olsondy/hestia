import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { PgBoss } from 'pg-boss';
import { pool } from '../../persistence/src/client';
import { createProject, getProject } from '../../projects/src/service';
import { createTask, getTask, appendConversationInput, cancelTask } from '../../tasks/src/service';
import { initializeQueue } from '../../tasks/src/queue';
import { claimTask, runTask } from '../../tasks/src/runner';
import { fixtureModel, toolChunks } from '../../model-validation/src/protocol-fixture';
import { productionConfigurations, admittedConfigurations, type ModelConfiguration } from './configurations';
import { syntheticPlanningInput } from '../../layout-planner/src/fixtures';
import { listCandidates } from '../../candidates/src/service';

const owner = { userId: `budget-${randomUUID()}` }, schema = `budget_${randomUUID().replaceAll('-', '')}`;
let producer: PgBoss;
const create = () => createProject(owner, { name: '合成故障预算验收', template: 'courtyard', operationId: randomUUID() });
const input = () => ({ protocol: 'conversation-v1', operationId: randomUUID(), expectedRevision: 1, message: '只解释这个合成空间，不做修改', referenceFrame: 'plan' });
const answer = { reply: '这是合成空间示意，尚未改变任何物体。', decision: { kind: 'answer', message: '合成说明' } };
const good = () => fixtureModel(toolChunks(answer, 'resolve_turn'));
const config = (id: string, model: ReturnType<typeof good>, accepted = true): ModelConfiguration => ({ id, modelId: `synthetic-${id}`,
  profiles: ['edit_fast', 'design_quality'], admission: { accepted, evidence: 'controlled protocol fixture only', kind: 'protocol-fixture' }, createModel: () => model });
const expire = (id: string) => pool.query("UPDATE design_tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [id]);
before(async () => { producer = await initializeQueue(schema); });
after(async () => {
  await pool.query('DELETE FROM operations WHERE owner_id=$1', [owner.userId]);
  await pool.query('DELETE FROM project_revisions WHERE project_id IN (SELECT id FROM projects WHERE owner_id=$1)', [owner.userId]);
  await pool.query('DELETE FROM projects WHERE owner_id=$1', [owner.userId]);
  assert.match(schema, /^budget_[a-f0-9]{32}$/); await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end();
});

test('known provider rejection retries once then uses only an admitted fallback, preserving unknown usage reservations', async () => {
  const p = await create(), task = await createTask(owner, p.id, input(), producer); let primary = 0, fallback = 0;
  await runTask(task.id, { conversation: { configurations: [config('primary', fixtureModel([], () => { primary++; }, 429)),
    config('fallback', fixtureModel(toolChunks(answer, 'resolve_turn'), () => { fallback++; }))] } });
  const result = await getTask(owner, p.id, task.id), budget = result.conversation!.execution!;
  assert.equal(result.status, 'completed'); assert.equal(primary, 2); assert.equal(fallback, 1); assert.equal(result.usage.used, 3);
  assert.deepEqual(budget.attempts.map(item => item.reason), ['initial', 'retry', 'fallback']);
  assert.deepEqual(budget.attempts.map(item => item.configurationId), ['primary', 'primary', 'fallback']);
  assert.equal(budget.unresolvedAttempts, 2); assert.ok(budget.reservedTokens > 0);
  assert.ok(budget.attempts.slice(0, 2).every(item => item.inputTokens === null && item.outputTokens === null && item.outcome === 'rejected'));
  assert.equal(budget.knownInputTokens, 100); assert.equal(budget.knownOutputTokens, 30);
  assert.equal((await getProject(owner, p.id)).revision, 1);
  await runTask(task.id); assert.deepEqual((await getTask(owner, p.id, task.id)).conversation!.execution, budget);
});

test('unadmitted fallback is never called; previous answers remain partial rather than falsely completed', async () => {
  const p = await create(); let task = await createTask(owner, p.id, input(), producer);
  await runTask(task.id, { conversation: { model: good() } });
  task = await appendConversationInput(owner, p.id, task.id, { kind: 'message', operationId: randomUUID(), expectedIntentVersion: 1, expectedRevision: 1, message: '继续解释照明' }, producer);
  let forbidden = 0;
  await runTask(task.id, { conversation: { configurations: [config('primary', fixtureModel([], undefined, 429)),
    config('unadmitted', fixtureModel(toolChunks(answer, 'resolve_turn'), () => { forbidden++; }), false)] } });
  const result = await getTask(owner, p.id, task.id);
  assert.equal(result.status, 'partial'); assert.equal(result.error?.code, 'MODEL_NO_ADMITTED_FALLBACK'); assert.equal(forbidden, 0);
  assert.equal(result.usage.used, 3); assert.equal(result.conversation!.retained!.answerCount, 1);
  assert.equal(result.conversation!.brief!.history[0].reply, answer.reply);
  assert.equal(result.conversation!.execution!.unresolvedAttempts, 2);
});

test('unknown network outcome never triggers an automatic retry or fallback and retains reserved tokens after cancellation', async () => {
  const p = await create(), task = await createTask(owner, p.id, input(), producer); let dispatched = 0, fallback = 0;
  const unknown = createOpenAICompatible({ name: 'unknown-fixture', baseURL: 'https://offline.invalid/v1', apiKey: 'synthetic',
    fetch: async () => { dispatched++; throw new Error('Synthetic connection disappeared'); } })('synthetic');
  await runTask(task.id, { conversation: { configurations: [config('primary', unknown), config('fallback', fixtureModel(toolChunks(answer, 'resolve_turn'), () => { fallback++; }))] } });
  const result = await getTask(owner, p.id, task.id), budget = result.conversation!.execution!;
  assert.equal(result.status, 'failed'); assert.equal(dispatched, 1); assert.equal(fallback, 0); assert.equal(result.usage.used, 1);
  assert.equal(budget.attempts[0].outcome, 'unknown'); assert.equal(budget.unresolvedAttempts, 1); assert.ok(budget.reservedTokens > 0);
  await cancelTask(owner, p.id, task.id); await runTask(task.id);
  assert.deepEqual((await getTask(owner, p.id, task.id)).conversation!.execution, budget);
});

test('503 without output remains unknown and cannot trigger a retry even when a qualified fallback exists', async () => {
  const p = await create(), task = await createTask(owner, p.id, input(), producer); let primary = 0, fallback = 0;
  await runTask(task.id, { conversation: { configurations: [config('primary', fixtureModel([], () => { primary++; }, 503)),
    config('fallback', fixtureModel(toolChunks(answer, 'resolve_turn'), () => { fallback++; }))] } });
  const result = await getTask(owner, p.id, task.id), budget = result.conversation!.execution!;
  assert.equal(result.status, 'failed'); assert.equal(primary, 1); assert.equal(fallback, 0);
  assert.equal(result.usage.used, 1); assert.equal(budget.attempts[0].outcome, 'unknown');
  assert.equal(budget.unresolvedAttempts, 1); assert.ok(budget.reservedTokens > 0);
});

test('durable response recovery preserves settled usage once and does not require a currently admitted model', async () => {
  const p = await create(), task = await createTask(owner, p.id, input(), producer); let dispatched = 0;
  await assert.rejects(runTask(task.id, { conversation: { model: fixtureModel(toolChunks(answer, 'resolve_turn'), () => { dispatched++; }),
    afterResponsePersisted: async () => { throw new Error('Synthetic process disappearance'); } } }));
  const before = (await getTask(owner, p.id, task.id)).conversation!.execution!;
  await expire(task.id); await runTask(task.id, { conversation: { configurations: [] } });
  const after = await getTask(owner, p.id, task.id);
  assert.equal(after.status, 'completed'); assert.equal(dispatched, 1); assert.equal(after.usage.used, 1);
  assert.deepEqual(after.conversation!.execution, before); assert.equal(before.reservedTokens, 0);
});

test('actual usage above the estimate is recorded without clamping and later stages cannot reset the token budget', async () => {
  const p = await create(), task = await createTask(owner, p.id, input(), producer);
  const chunks = toolChunks(answer, 'resolve_turn'); chunks[chunks.length - 1] = { id: 'usage', object: 'chat.completion.chunk', choices: [],
    usage: { prompt_tokens: 140000, completion_tokens: 30, total_tokens: 140030 } } as typeof chunks[number];
  await runTask(task.id, { conversation: { model: fixtureModel(chunks) } });
  let result = await getTask(owner, p.id, task.id); assert.equal(result.conversation!.execution!.knownInputTokens, 140000);
  await appendConversationInput(owner, p.id, task.id, { kind: 'message', operationId: randomUUID(), expectedIntentVersion: 1, expectedRevision: 1, message: '继续解释' }, producer);
  let dispatched = 0; await runTask(task.id, { conversation: { model: fixtureModel(toolChunks(answer, 'resolve_turn'), () => { dispatched++; }) } });
  result = await getTask(owner, p.id, task.id);
  assert.equal(result.status, 'partial'); assert.equal(result.error?.code, 'TOKEN_LIMIT'); assert.equal(dispatched, 0);
  assert.equal(result.usage.used, 1); assert.equal(result.conversation!.execution!.knownInputTokens, 140000);
  assert.equal(result.conversation!.retained!.answerCount, 1);
});

test('retry restart resumes the durable rejected attempt and never repeats its accounting', async () => {
  const p = await create(), task = await createTask(owner, p.id, input(), producer); let calls = 0;
  await assert.rejects(runTask(task.id, { conversation: { model: fixtureModel([], () => { calls++; }, 429),
    afterResponsePersisted: async () => { throw new Error('Synthetic crash after rejection'); } } }));
  await expire(task.id);
  await runTask(task.id, { conversation: { model: fixtureModel(toolChunks(answer, 'resolve_turn'), () => { calls++; }) } });
  const result = await getTask(owner, p.id, task.id);
  assert.equal(result.status, 'completed'); assert.equal(calls, 2); assert.equal(result.usage.used, 2);
  assert.equal(result.conversation!.execution!.attempts.length, 2); assert.equal(result.conversation!.execution!.unresolvedAttempts, 1);
});

test('legacy unknown call and exhausted claims retain an unresolved token reservation without double release', async () => {
  const p = await create(), task = await createTask(owner, p.id, input(), producer); await claimTask(task.id);
  await pool.query("UPDATE design_tasks SET conversation=jsonb_set(conversation,'{callStarted}','true'),usage_reserved=1,attempts=3 WHERE id=$1", [task.id]);
  await expire(task.id); assert.equal(await claimTask(task.id), null);
  const result = await getTask(owner, p.id, task.id), budget = result.conversation!.execution!;
  assert.equal(result.usage.used, 1); assert.equal(budget.unresolvedAttempts, 1); assert.ok(budget.reservedTokens > 0);
  await cancelTask(owner, p.id, task.id); await runTask(task.id);
  assert.deepEqual((await getTask(owner, p.id, task.id)).conversation!.execution, budget);
});

test('production admission binds endpoint, model and installed adapter without exposing endpoint or accepting arbitrary alternatives', () => {
  const before = process.env.HESTIA_MODEL_BASE_URL;
  assert.equal(productionConfigurations().length, 1);
  try { process.env.HESTIA_MODEL_BASE_URL = 'https://different.invalid/v1'; assert.throws(productionConfigurations, { code: 'MODEL_NOT_ADMITTED' }); }
  finally { process.env.HESTIA_MODEL_BASE_URL = before; }
  const item = config('quality-only', good()); item.profiles = ['design_quality'];
  assert.equal(admittedConfigurations([item], 'edit_fast').length, 0);
  assert.equal(admittedConfigurations([item], 'design_quality').length, 1);
});

test('same-turn brief and layout proposal persist one checked candidate with application-created explicit references', async () => {
  const fixture = syntheticPlanningInput(), p = await createProject(owner, { name: '合成整合布局', template: 'empty', operationId: randomUUID() });
  await pool.query('UPDATE projects SET snapshot=$2 WHERE id=$1', [p.id, fixture.state]);
  const message = fixture.brief.inputs[0].text, task = await createTask(owner, p.id, { ...input(), message }, producer);
  const sourceInputId = task.conversation!.brief!.inputs[0].id;
  const proposal = { reply: '将为会客与办公生成候选，当前方案尚未改变。',
    decision: { ...fixture.decision, sourceInputIds: [sourceInputId] },
    brief: { summary: '会客与办公布局，保留现有家具。',
      requirements: [{ content: message, sourceKind: 'user_explicit', sourceInputIds: [sourceInputId] }], questions: [] } };
  const quality = config('quality-only', fixtureModel(toolChunks(proposal, 'resolve_turn'))); quality.profiles = ['design_quality'];
  await runTask(task.id, { conversation: { configurations: [quality] } });
  const result = await getTask(owner, p.id, task.id);
  assert.equal(result.status, 'waiting_selection', JSON.stringify(result.error));
  assert.equal(result.conversation!.outcome!.kind, 'candidate'); assert.equal(result.usage.used, 1);
  assert.equal(result.conversation!.execution!.attempts[0].profile, 'design_quality');
  assert.equal((await getProject(owner, p.id)).revision, 1); assert.equal((await listCandidates(owner, p.id)).candidates.length, 1);
  const stored = (await pool.query('SELECT conversation FROM design_tasks WHERE id=$1', [task.id])).rows[0].conversation;
  assert.deepEqual(stored.effectiveDecision.requirementIds, [stored.brief.requirements[0].id]);
  assert.equal(stored.brief.requirements[0].sourceKind, 'user_explicit');
  await runTask(task.id); assert.equal((await listCandidates(owner, p.id)).candidates.length, 1);
});

test('a clear selected-object move after candidate history uses fast without applying the old layout scope', async () => {
  const p = await create(); let task = await createTask(owner, p.id, input(), producer);
  await runTask(task.id, { conversation: { model: good() } });
  // A prior candidate scope is persisted history, not a classification of the next message.
  await pool.query("UPDATE design_tasks SET conversation=jsonb_set(conversation,'{brief,scope}','\"single_room_candidate\"') WHERE id=$1", [task.id]);
  const message = '把所选家具沿图纸向右移动20厘米';
  task = await appendConversationInput(owner, p.id, task.id, { kind: 'message', operationId: randomUUID(), expectedIntentVersion: 1,
    expectedRevision: 1, message, selectedObjectId: 'sofa-a' }, producer);
  const fast = config('fast-only', fixtureModel(toolChunks({ reply: '只提出所选家具的准确移动，应用负责检查。',
    decision: { kind: 'move', userAct: 'explicit_request', evidenceQuote: message, direction: 'right', distanceText: '20', unit: 'cm' } }, 'resolve_turn')));
  fast.profiles = ['edit_fast'];
  await runTask(task.id, { conversation: { configurations: [fast] } });
  const result = await getTask(owner, p.id, task.id);
  assert.equal(result.status, 'completed', JSON.stringify(result.error));
  assert.equal(result.conversation!.outcome!.kind, 'applied');
  assert.equal(result.conversation!.execution!.attempts.at(-1)!.profile, 'edit_fast');
  assert.equal(result.conversation!.execution!.attempts.length, 2); assert.equal(result.usage.used, 2);
});

test('promoting an older suggestion in the same layout turn retains its ID in the effective hard requirements', async () => {
  const fixture = syntheticPlanningInput(), p = await createProject(owner, { name: '合成建议升级布局', template: 'empty', operationId: randomUUID() });
  await pool.query('UPDATE projects SET snapshot=$2 WHERE id=$1', [p.id, fixture.state]);
  let task = await createTask(owner, p.id, { ...input(), message: '先只整理会客办公需求，暂不生成方案' }, producer);
  const message = fixture.brief.inputs[0].text;
  await runTask(task.id, { conversation: { model: fixtureModel(toolChunks({ ...answer,
    brief: { summary: '下一步可由用户明确要求生成。', requirements: [{ content: message, sourceKind: 'assistant_suggestion', sourceInputIds: [] }], questions: [] } }, 'resolve_turn')) } });
  task = await getTask(owner, p.id, task.id);
  const suggestionId = task.conversation!.brief!.requirements[0].id;
  task = await appendConversationInput(owner, p.id, task.id, { kind: 'message', operationId: randomUUID(), expectedIntentVersion: 1, expectedRevision: 1, message }, producer);
  const sourceInputId = task.conversation!.brief!.inputs.at(-1)!.id;
  await runTask(task.id, { conversation: { model: fixtureModel(toolChunks({ reply: '根据本轮明确请求生成候选，尚未采用。',
    decision: { ...fixture.decision, sourceInputIds: [sourceInputId] },
    brief: { summary: '用户明确请求生成会客办公布局。', requirements: [{ content: message, sourceKind: 'user_explicit', sourceInputIds: [sourceInputId] }], questions: [] } }, 'resolve_turn')) } });
  const result = await getTask(owner, p.id, task.id);
  assert.equal(result.status, 'waiting_selection', JSON.stringify(result.error));
  assert.equal(result.conversation!.brief!.requirements[0].id, suggestionId);
  assert.equal(result.conversation!.brief!.requirements[0].revision, 2);
  assert.equal(result.conversation!.brief!.requirements[0].sourceKind, 'user_explicit');
  const stored = (await pool.query('SELECT conversation FROM design_tasks WHERE id=$1', [task.id])).rows[0].conversation;
  assert.deepEqual(stored.effectiveDecision.requirementIds, [suggestionId]);
  assert.equal(result.usage.used, 2); assert.equal((await getProject(owner, p.id)).revision, 1);
});
