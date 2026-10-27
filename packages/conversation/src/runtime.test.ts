import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { PgBoss } from 'pg-boss';
import { pool } from '../../persistence/src/client';
import { createProject, getProject } from '../../projects/src/service';
import { executeCommand } from '../../commands/src/service';
import { createTask, getTask, cancelTask, readTaskEvents } from '../../tasks/src/service';
import { claimTask, runTask } from '../../tasks/src/runner';
import { initializeQueue } from '../../tasks/src/queue';
import { fixtureModel, toolChunks, chunk } from '../../model-validation/src/protocol-fixture';

const owner = { userId: `conversation-${randomUUID()}` }, other = { userId: `conversation-${randomUUID()}` };
const schema = `conversation_test_${randomUUID().replaceAll('-', '')}`; let producer: PgBoss;
const message = '把所选家具沿图纸向右移动20厘米';
const move = (quote = message) => ({ kind: 'move', userAct: 'explicit_request', evidenceQuote: quote, direction: 'right', distanceText: '20', unit: 'cm' });
const input = (text = message, selectedObjectId: string | undefined = 'sofa-a') => ({ protocol: 'conversation-v1', operationId: randomUUID(), expectedRevision: 1,
  message: text, selectedObjectId, referenceFrame: 'plan' });
const create = () => createProject(owner, { name: '合成对话验证', template: 'courtyard', operationId: randomUUID() });
const envelope = (decision: unknown, reply = typeof decision === 'object' && decision !== null && 'message' in decision && typeof decision.message === 'string' ? decision.message : '这是待校验的局部修改提案，实际结果以应用记录为准。') => ({ reply, decision });
const model = (decision: unknown, finish = 'tool_calls') => fixtureModel(toolChunks(envelope(decision), 'resolve_turn', finish));
const expire = (id: string) => pool.query("UPDATE design_tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [id]);
function delayedModel(delayMs: number, started: () => void) {
  return createOpenAICompatible({ name: 'bounded-delay-substitute', baseURL: 'https://offline.invalid/v1', apiKey: 'synthetic-not-secret',
    fetch: async (_url, init) => {
      started();
      await new Promise<void>((resolve, reject) => {
        const signal = init?.signal, finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
        const timer = setTimeout(finish, delayMs), abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('Synthetic abort')); };
        signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      });
      return new Response(toolChunks(envelope(move()), 'resolve_turn').map(value => `data: ${JSON.stringify(value)}\n\n`).join('') + 'data: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } });
    } })('injected-delay-model');
}
before(async () => { producer = await initializeQueue(schema); });
after(async () => {
  await pool.query('DELETE FROM operations WHERE actor_id=$1', [owner.userId]);
  await pool.query('DELETE FROM project_revisions WHERE project_id IN (SELECT id FROM projects WHERE created_by=$1)', [owner.userId]);
  await pool.query('DELETE FROM projects WHERE created_by=$1', [owner.userId]);
  assert.match(schema, /^conversation_test_[a-f0-9]{32}$/); await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end();
});

test('accepted conversation is isolated and idempotent; only strict input is accepted', async () => {
  const p = await create(), request = input(), task = await createTask(owner, p.id, request, producer);
  assert.equal((await createTask(owner, p.id, request, producer)).id, task.id);
  assert.equal(task.conversation?.phase, 'accepted'); assert.equal((await getProject(owner, p.id)).revision, 1);
  await assert.rejects(getTask(other, p.id, task.id), { code: 'NOT_FOUND' });
  await assert.rejects(createTask(other, p.id, input(), producer), { code: 'NOT_FOUND' });
  await assert.rejects(createTask(owner, p.id, { ...request, message: 'different' }, producer), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(createTask(owner, p.id, { ...input(), approved: true }, producer));
  const p2 = await create(); await assert.rejects(createTask(owner, p2.id, input(message, 'foreign-object'), producer), { code: 'INVALID_SELECTION' });
});
test('mixed answer and exact selected move commit once with authoritative event and reversible result', async () => {
  const p = await create(), before = p.scene, task = await createTask(owner, p.id, input('20厘米等于多少米？' + message), producer);
  const reply = '20厘米等于0.2米。我提出按原方向移动所选家具，是否应用以实际校验结果为准。';
  // No optional prose chunk: a tool-only provider must still deliver both parts of the request.
  await runTask(task.id, { conversation: { model: fixtureModel(toolChunks(envelope(move(), reply), 'resolve_turn').slice(1)) } }); await runTask(task.id);
  const saved = await getProject(owner, p.id), result = await getTask(owner, p.id, task.id);
  assert.equal(result.status, 'completed'); assert.equal(result.conversation?.outcome?.kind, 'applied'); assert.equal(saved.revision, 2);
  assert.equal(saved.scene.objects.find(o => o.id === 'sofa-a')!.position.x, 3.2);
  assert.deepEqual(saved.scene.objects.filter(o => o.id !== 'sofa-a'), before.objects.filter(o => o.id !== 'sofa-a'));
  const reopenedEvents = (await readTaskEvents(owner, p.id, task.id, 0)).events;
  assert.equal(reopenedEvents.filter(e => e.type === 'operation').length, 1);
  assert.equal(reopenedEvents.filter(e => e.type === 'text' && e.data.text === reply).length, 1);
  await executeCommand(owner, p.id, { operationId: randomUUID(), expectedRevision: 2, command: { type: 'undo', targetOperationId: result.conversation!.outcome!.operationId } });
  assert.deepEqual((await getProject(owner, p.id)).scene.objects, before.objects);
});
test('missing or empty required reply rejects an otherwise valid move and legacy saved responses never trigger another model call', async () => {
  for (const value of [{ decision: move() }, { reply: '', decision: move() }]) {
    const p = await create(), task = await createTask(owner, p.id, input(), producer);
    await runTask(task.id, { conversation: { model: fixtureModel(toolChunks(value, 'resolve_turn')) } });
    assert.equal((await getTask(owner, p.id, task.id)).status, 'failed'); assert.equal((await getProject(owner, p.id)).revision, 1);
  }
  const p = await create(), task = await createTask(owner, p.id, input(), producer); let calls = 0;
  const injected = fixtureModel(toolChunks(envelope(move()), 'resolve_turn'), () => { calls++; });
  await assert.rejects(runTask(task.id, { conversation: { model: injected, afterResponsePersisted: async () => { throw new Error('Synthetic crash'); } } }));
  await pool.query("UPDATE design_tasks SET conversation=conversation #- '{response,reply}' WHERE id=$1", [task.id]);
  await expire(task.id); await runTask(task.id, { conversation: { model: injected } });
  assert.equal(calls, 1); assert.equal((await getTask(owner, p.id, task.id)).error?.code, 'MODEL_REPLY_REQUIRED');
  assert.equal((await getProject(owner, p.id)).revision, 1);
});
test('a completed reply equal to already streamed text is not displayed twice', async () => {
  const p = await create(), task = await createTask(owner, p.id, input('这个空间是什么？'), producer), reply = '这是合成示意空间。';
  const chunks = toolChunks(envelope({ kind: 'answer', message: reply }, reply), 'resolve_turn'); chunks[0] = chunk({ content: reply });
  await runTask(task.id, { conversation: { model: fixtureModel(chunks) } });
  const events = (await readTaskEvents(owner, p.id, task.id, 0)).events;
  assert.equal(events.filter(e => e.type === 'text' && e.data.text === reply).length, 1); assert.equal((await getProject(owner, p.id)).revision, 1);
});
test('tool-only reply preserves trailing spaces and newline without a false prefix conflict or duplicate display', async () => {
  const p = await create(), task = await createTask(owner, p.id, input('20厘米等于多少米？'), producer), reply = '20厘米等于0.2米。 \n';
  await runTask(task.id, { conversation: { model: fixtureModel(toolChunks(envelope({ kind: 'answer', message: reply }, reply), 'resolve_turn').slice(1)) } });
  const taskView = await getTask(owner, p.id, task.id), events = (await readTaskEvents(owner, p.id, task.id, 0)).events;
  assert.equal(taskView.status, 'completed'); assert.equal(taskView.error, null);
  assert.equal(events.filter(event => event.type === 'text').map(event => event.data.text).join(''), reply);
  assert.equal((await getProject(owner, p.id)).revision, 1);
});
test('tool-only partial reply is durably visible before complete tool input and causes no early mutation', async () => {
  const p = await create(), task = await createTask(owner, p.id, input('20厘米等于多少米？' + message), producer);
  const reply = '20厘米等于0.2米。我会提出精确移动20厘米的修改。', raw = JSON.stringify(envelope(move(), reply));
  const split = raw.indexOf('0.2'); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), encoder = new TextEncoder();
  const frame = (value: unknown) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
  const injected = createOpenAICompatible({ name: 'partial-reply-substitute', baseURL: 'https://offline.invalid/v1', apiKey: 'synthetic-not-secret',
    fetch: async () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(frame(chunk({ tool_calls: [{ index: 0, id: 'partial-call', type: 'function', function: { name: 'resolve_turn', arguments: raw.slice(0, split) } }] })));
      void gate.then(() => {
        controller.enqueue(frame(chunk({ tool_calls: [{ index: 0, function: { arguments: raw.slice(split) } }] })));
        controller.enqueue(frame(chunk({}, 'tool_calls'))); controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close();
      });
    } }), { headers: { 'Content-Type': 'text/event-stream' } }) })('synthetic-partial-model');
  const execution = runTask(task.id, { conversation: { model: injected } });
  try {
    let received = '';
    for (let attempt = 0; attempt < 100 && !received; attempt++) {
      await delay(20); received = (await readTaskEvents(owner, p.id, task.id, 0)).events.filter(event => event.type === 'text').map(event => event.data.text).join('');
    }
    assert.equal(received, '20厘米等于'); assert.equal((await getProject(owner, p.id)).revision, 1);
    assert.equal((await getTask(owner, p.id, task.id)).status, 'running');
  } finally { release(); await execution; }
  const events = (await readTaskEvents(owner, p.id, task.id, 0)).events;
  assert.equal(events.filter(event => event.type === 'text').map(event => event.data.text).join(''), reply);
  assert.equal(events.filter(event => event.type === 'operation').length, 1); assert.equal((await getProject(owner, p.id)).revision, 2);
  const saved = (await pool.query('SELECT conversation FROM design_tasks WHERE id=$1', [task.id])).rows[0].conversation.response;
  assert.ok(saved.firstReplyMs < saved.elapsedMs);
});
test('duplicate reply keys, including escaped property names, fail closed after a visible provisional prefix', async () => {
  for (const key of ['reply', 're\\u0070ly']) {
    const p = await create(), task = await createTask(owner, p.id, input(), producer);
    const raw = `{"reply":"原答复","${key}":"被改写的答复","decision":${JSON.stringify(move())}}`;
    const split = raw.indexOf(',');
    const chunks = [chunk({ tool_calls: [{ index: 0, id: 'duplicate-key', type: 'function', function: { name: 'resolve_turn', arguments: raw.slice(0, split) } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: raw.slice(split) } }] }), chunk({}, 'tool_calls')];
    await runTask(task.id, { conversation: { model: fixtureModel(chunks) } });
    assert.equal((await getTask(owner, p.id, task.id)).error?.code, 'INVALID_TOOL_INPUT_JSON'); assert.equal((await getProject(owner, p.id)).revision, 1);
  }
});
test('answer or fabricated success prose never becomes an authoritative operation', async () => {
  const p = await create(), task = await createTask(owner, p.id, input('这个空间有什么？', undefined), producer);
  await runTask(task.id, { conversation: { model: model({ kind: 'answer', message: '已移动20厘米。' }) } });
  const result = await getTask(owner, p.id, task.id); assert.equal(result.conversation?.outcome?.message, '本轮已回复，空间未修改。');
  assert.equal((await getProject(owner, p.id)).revision, 1);
  assert.equal((await readTaskEvents(owner, p.id, task.id, 0)).events.filter(e => e.type === 'operation').length, 0);
});
test('questions, hypothetical quotation and denied examples cannot grant write authority via a substring', async () => {
  for (const text of [`如果我说“${message}”会怎样？`, `不要动，下面只是示例：${message}`, `${message}会怎样？`, `${message}会撞墙吗？`]) {
    const p = await create(), task = await createTask(owner, p.id, input(text), producer);
    await runTask(task.id, { conversation: { model: model(move()) } });
    assert.equal((await getProject(owner, p.id)).revision, 1); assert.equal((await getTask(owner, p.id, task.id)).conversation?.outcome?.kind, 'clarification');
  }
});
test('model cannot reduce requested distance or alter unit/direction evidence to avoid collision', async () => {
  for (const decision of [{ ...move(), distanceText: '10' }, { ...move(), unit: 'm' }, { ...move(), direction: 'left' }]) {
    const p = await create(), task = await createTask(owner, p.id, input(), producer);
    await runTask(task.id, { conversation: { model: model(decision) } });
    assert.equal((await getProject(owner, p.id)).revision, 1); assert.equal((await getTask(owner, p.id, task.id)).conversation?.outcome?.kind, 'clarification');
  }
});
test('a model proposal cannot redirect an explicit other-object request onto the selected sofa', async () => {
  for (const text of ['把未选中的茶几沿图纸向右移动20厘米', '把茶几沿图纸向右移动20厘米', '把另一个家具沿图纸向右移动20厘米']) {
    const p = await create(), task = await createTask(owner, p.id, input(text), producer);
    await runTask(task.id, { conversation: { model: model(move(text)) } });
    assert.equal((await getTask(owner, p.id, task.id)).conversation?.outcome?.kind, 'clarification');
    assert.deepEqual((await getProject(owner, p.id)).scene, p.scene);
  }
});
test('a true collision fails without shortening movement or changing other objects', async () => {
  const p = await create(), text = '把所选家具沿图纸向右移动20米', task = await createTask(owner, p.id, input(text), producer);
  await runTask(task.id, { conversation: { model: model({ ...move(text), unit: 'm' }) } });
  assert.equal((await getTask(owner, p.id, task.id)).error?.code, 'PLACEMENT_REJECTED'); assert.deepEqual((await getProject(owner, p.id)).scene, p.scene);
});
test('fixed/locked objects may be discussed but cannot be mutated; rotations preserve location and size', async () => {
  for (const id of ['fixed-a', 'sofa-a']) {
    const p = await create(); if (id === 'sofa-a') await executeCommand(owner, p.id, { operationId: randomUUID(), expectedRevision: 1, command: { type: 'set-lock', objectId: id, locked: true } });
    const task = await createTask(owner, p.id, { ...input(message, id), expectedRevision: id === 'sofa-a' ? 2 : 1 }, producer);
    await runTask(task.id, { conversation: { model: model(move()) } }); assert.equal((await getTask(owner, p.id, task.id)).conversation?.outcome?.kind, 'clarification');
  }
  const p = await create(), text = '把所选家具顺时针旋转10度', task = await createTask(owner, p.id, input(text), producer);
  await runTask(task.id, { conversation: { model: model({ kind: 'rotate', userAct: 'explicit_request', evidenceQuote: text, direction: 'clockwise', degreesText: '10' }) } });
  const before = p.scene.objects.find(o => o.id === 'sofa-a')!, after = (await getProject(owner, p.id)).scene.objects.find(o => o.id === 'sofa-a')!;
  assert.equal(after.yaw, -Math.PI / 18); assert.deepEqual(after.position, before.position); assert.deepEqual(after.size, before.size);
});
test('truncated, extra-field, unknown-tool and duplicate complete proposals fail closed', async () => {
  const duplicate = [chunk({ tool_calls: [0, 1].map(index => ({ index, id: `proposal-${index}`, type: 'function', function: { name: 'resolve_turn', arguments: JSON.stringify(envelope(move())) } })) }), chunk({}, 'tool_calls')];
  for (const chunks of [toolChunks(envelope(move()), 'resolve_turn', 'length'), toolChunks(envelope({ ...move(), approved: true }), 'resolve_turn'), toolChunks(envelope(move()), 'fake_tool'), duplicate]) {
    const p = await create(), task = await createTask(owner, p.id, input(), producer);
    await runTask(task.id, { conversation: { model: fixtureModel(chunks) } });
    assert.equal((await getTask(owner, p.id, task.id)).status, 'failed'); assert.equal((await getProject(owner, p.id)).revision, 1);
  }
});
test('durable complete response resumes without a second model call and commits once', async () => {
  const p = await create(), task = await createTask(owner, p.id, input(), producer); let calls = 0;
  const injected = fixtureModel(toolChunks(envelope(move()), 'resolve_turn'), body => {
    calls++;
    const tools = body.tools as { function: { parameters: { type: string; properties: unknown } } }[];
    assert.equal(tools[0].function.parameters.type, 'object'); assert.ok(tools[0].function.parameters.properties);
  });
  await assert.rejects(runTask(task.id, { conversation: { model: injected, afterResponsePersisted: async () => { throw new Error('synthetic process loss'); } } }));
  await expire(task.id); await runTask(task.id, { conversation: { model: injected } }); await runTask(task.id, { conversation: { model: injected } });
  const restored = await getTask(owner, p.id, task.id), events = (await readTaskEvents(owner, p.id, task.id, 0)).events;
  assert.equal(calls, 1); assert.equal((await getProject(owner, p.id)).revision, 2); assert.equal(restored.status, 'completed');
  assert.equal(events.filter(event => event.type === 'text' && event.data.generation === restored.generation).map(event => event.data.text).join(''), envelope(move()).reply);
  assert.equal(events.filter(event => event.type === 'operation').length, 1);
});
test('unknown interrupted model call is not silently recalled or reported as zero token usage', async () => {
  const p = await create(), task = await createTask(owner, p.id, input(), producer); await claimTask(task.id);
  await pool.query("UPDATE design_tasks SET conversation=jsonb_set(conversation,'{callStarted}','true'),usage_reserved=1 WHERE id=$1", [task.id]);
  await expire(task.id); let calls = 0;
  await runTask(task.id, { conversation: { model: fixtureModel(toolChunks(envelope(move()), 'resolve_turn'), () => { calls++; }) } });
  const result = await getTask(owner, p.id, task.id); assert.equal(calls, 0); assert.equal(result.error?.code, 'MODEL_OUTCOME_UNKNOWN');
  assert.deepEqual(result.conversation?.modelUsage, { inputTokens: null, outputTokens: null }); assert.equal((await getProject(owner, p.id)).revision, 1);
});
test('cancelled, expired and concurrently revised responses cannot cross the commit fence', async () => {
  for (const mode of ['cancel', 'expire', 'revision']) {
    const p = await create(), task = await createTask(owner, p.id, input(), producer);
    const execution = runTask(task.id, { conversation: { model: model(move()), beforeCommit: async () => {
      if (mode === 'cancel') await cancelTask(owner, p.id, task.id);
      if (mode === 'expire') await expire(task.id);
      if (mode === 'revision') await executeCommand(owner, p.id, { operationId: randomUUID(), expectedRevision: 1, command: { type: 'set-lock', objectId: 'table-a', locked: true } });
    } } });
    if (mode === 'expire') await assert.rejects(execution, { code: 'TASK_FENCE_LOST' }); else await execution;
    assert.equal((await getProject(owner, p.id)).scene.objects.find(o => o.id === 'sofa-a')!.position.x, 3);
    assert.equal((await readTaskEvents(owner, p.id, task.id, 0)).events.filter(e => e.type === 'operation').length, 0);
    if (mode === 'expire') {
      let recalled = 0; await runTask(task.id, { conversation: { model: fixtureModel(toolChunks(envelope(move()), 'resolve_turn'), () => { recalled++; }) } });
      assert.equal(recalled, 0); assert.equal((await getProject(owner, p.id)).revision, 2);
    }
  }
});
test('the existing task lease is renewed while a bounded provider request is outside the database transaction', async () => {
  const p = await create(), task = await createTask(owner, p.id, input(), producer);
  await runTask(task.id, { conversation: { model: delayedModel(5000, () => {}), beforeCommit: async () => {
    const row = (await pool.query('SELECT extract(epoch FROM lease_until-clock_timestamp()) AS remaining FROM design_tasks WHERE id=$1', [task.id])).rows[0];
    assert.ok(Number(row.remaining) > 11, 'the 4s heartbeat renewed the original 15s lease during the 5s call');
  } } });
  assert.equal((await getTask(owner, p.id, task.id)).status, 'completed');
});
test('cancelling during a provider request aborts on heartbeat and never commits a late response', async () => {
  const p = await create(), task = await createTask(owner, p.id, input(), producer);
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  const execution = runTask(task.id, { conversation: { model: delayedModel(6000, started) } });
  await ready; await cancelTask(owner, p.id, task.id); await execution;
  assert.equal((await getTask(owner, p.id, task.id)).status, 'cancelled'); assert.equal((await getProject(owner, p.id)).revision, 1);
});
