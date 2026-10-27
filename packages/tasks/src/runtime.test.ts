import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { PgBoss } from 'pg-boss';
import { pool } from '../../persistence/src/client';
import { createProject, getProject } from '../../projects/src/service';
import { executeCommand } from '../../commands/src/service';
import { createTask, getTask, cancelTask, listTasks, readTaskEvents } from './service';
import { claimTask, reserveStep, executeStep, runTask } from './runner';
import { initializeQueue, createQueueClient, TASK_QUEUE } from './queue';
import { taskEventStream } from './events';
import type { TaskStep } from '../../contracts/src/tasks';

const owner = { userId: `tasks-${randomUUID()}` }, other = { userId: `tasks-${randomUUID()}` };
const queueSchema = `task_test_${randomUUID().replaceAll('-', '')}`;
let boss: PgBoss;
const create = () => createProject(owner, { name: '合成后台协议测试', template: 'courtyard', operationId: randomUUID() });
const text = (value = '这是确定性协议测试，不是真实模型回答。'): TaskStep => ({ type: 'text', text: value });
const lock: TaskStep = { type: 'command', command: { type: 'set-lock', objectId: 'sofa-a', locked: true } };
const input = (steps: TaskStep[] = [text(), lock], expectedRevision = 1) => ({ operationId: randomUUID(), expectedRevision, protocol: 'deterministic-v1', steps });
async function expire(id: string) { await pool.query("UPDATE design_tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [id]); }
before(async () => { boss = await initializeQueue(queueSchema); });
after(async () => {
  await pool.query('DELETE FROM operations WHERE owner_id=$1', [owner.userId]);
  await pool.query('DELETE FROM project_revisions WHERE project_id IN (SELECT id FROM projects WHERE owner_id=$1)', [owner.userId]);
  await pool.query('DELETE FROM projects WHERE owner_id=$1', [owner.userId]);
  // The identifier is generated above, never derived from a user or an existing schema.
  assert.match(queueSchema, /^task_test_[a-f0-9]{32}$/);
  await pool.query(`DROP SCHEMA ${queueSchema} CASCADE`);
  await pool.end();
});

test('task + first event + pg-boss job commit together, duplicate acceptance returns one task', async () => {
  const p = await create(), request = input();
  const [a, b] = await Promise.all([createTask(owner, p.id, request, boss), createTask(owner, p.id, request, boss)]);
  assert.equal(a.id, b.id); assert.equal(a.status, 'queued'); assert.equal(a.eventsCursor, 1);
  const jobs = await boss.fetch<{ taskId: string }>(TASK_QUEUE, { batchSize: 100 });
  assert.equal(jobs.filter(j => j.data.taskId === a.id).length, 1);
  await assert.rejects(createTask(owner, p.id, { ...request, steps: [text('different')] }, boss), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(createTask(owner, p.id, input(), boss), { code: 'TASK_ACTIVE' });
  const failedProject = await create(), failedRequest = input();
  await assert.rejects(createTask(owner, failedProject.id, failedRequest, createQueueClient(`${queueSchema}_none`)));
  assert.equal((await listTasks(owner, failedProject.id)).length, 0);
  assert.equal((await pool.query('SELECT 1 FROM operations WHERE owner_id=$1 AND id=$2', [owner.userId, failedRequest.operationId])).rowCount, 0);
});

test('ownership, project binding, strict input and bounded event cursors cannot be bypassed', async () => {
  const p = await create(), p2 = await create(), task = await createTask(owner, p.id, input(), boss);
  for (const work of [() => getTask(other, p.id, task.id), () => cancelTask(other, p.id, task.id),
    () => readTaskEvents(other, p.id, task.id, 0), () => getTask(owner, p2.id, task.id), () => listTasks(other, p.id),
    () => createTask(other, p.id, input(), boss)]) await assert.rejects(work(), { code: 'NOT_FOUND' });
  await assert.rejects(createTask(owner, p2.id, { ...input(), ownerId: owner.userId }, boss));
  await assert.rejects(createTask(owner, p2.id, { ...input(), protocol: 'model' }, boss));
  await assert.rejects(readTaskEvents(owner, p.id, task.id, 99), { code: 'INVALID_CURSOR' });
  await assert.rejects(readTaskEvents(owner, p.id, task.id, -.5), { code: 'INVALID_CURSOR' });
  assert.equal((await getTask(owner, p.id, task.id)).status, 'queued');
});

test('domain commit + checkpoint survive lost reply, expired generations cannot write, recovery does not repeat effects', async () => {
  const p = await create(), task = await createTask(owner, p.id, input([lock, text()]), boss);
  const first = (await claimTask(task.id))!;
  const reserved = (await reserveStep(first))!;
  await executeStep(first, reserved.index); // Simulate losing the reply after this commit.
  await executeStep(first, reserved.index);
  assert.equal((await getProject(owner, p.id)).revision, 2);
  await expire(task.id);
  const second = (await claimTask(task.id))!;
  assert.equal(second.generation, first.generation + 1);
  await assert.rejects(reserveStep(first), { code: 'TASK_FENCE_LOST' });
  await assert.rejects(executeStep(first, 1), { code: 'TASK_FENCE_LOST' });
  const next = (await reserveStep(second))!; assert.equal(next.index, 1);
  await executeStep(second, next.index); assert.equal(await reserveStep(second), null);
  await runTask(task.id); // Redelivery after completion is a no-op.
  const recovered = await getTask(owner, p.id, task.id);
  assert.equal(recovered.status, 'completed'); assert.equal(recovered.usage.used, 2);
  assert.equal((await getProject(owner, p.id)).revision, 2);
  assert.equal((await pool.query('SELECT 1 FROM project_commands WHERE project_id=$1', [p.id])).rowCount, 1);
  const events = (await readTaskEvents(owner, p.id, task.id, 0)).events;
  assert.equal(events.filter(e => e.type === 'operation').length, 1);
  assert.deepEqual(events.map(e => e.seq), events.map((_, i) => i + 1));
});

test('cancellation fences uncommitted work and preserves an already committed revision', async () => {
  for (const commitFirst of [false, true]) {
    const p = await create(), task = await createTask(owner, p.id, input([lock, text()]), boss);
    const claim = (await claimTask(task.id))!; await reserveStep(claim);
    if (commitFirst) await executeStep(claim, 0);
    const cancelled = await cancelTask(owner, p.id, task.id);
    await assert.rejects(executeStep(claim, commitFirst ? 1 : 0), { code: 'TASK_FENCE_LOST' });
    await runTask(task.id);
    assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.usage.reserved, 0);
    assert.equal((await getProject(owner, p.id)).revision, commitFirst ? 2 : 1);
    assert.equal((await cancelTask(owner, p.id, task.id)).eventsCursor, cancelled.eventsCursor);
  }
});

test('cancel versus commit is serialized at the task row, with no hidden project write', async () => {
  const p = await create(), task = await createTask(owner, p.id, input([lock, text()]), boss);
  const claim = (await claimTask(task.id))!; await reserveStep(claim);
  await Promise.allSettled([executeStep(claim, 0), cancelTask(owner, p.id, task.id)]);
  const result = await getTask(owner, p.id, task.id), project = await getProject(owner, p.id);
  assert.equal(result.status, 'cancelled');
  assert.equal(project.revision, 1 + result.checkpoint.nextStep);
  assert.equal(result.usage.used, result.checkpoint.nextStep);
});

test('reservations survive interrupted attempts and the original task budget never resets', async () => {
  const p = await create(), task = await createTask(owner, p.id, input(Array.from({ length: 9 }, () => text())), boss);
  const first = (await claimTask(task.id))!; await reserveStep(first);
  assert.equal((await getTask(owner, p.id, task.id)).usage.reserved, 1);
  await expire(task.id); await runTask(task.id);
  const result = await getTask(owner, p.id, task.id);
  assert.equal(result.status, 'partial'); assert.equal(result.error?.code, 'USAGE_LIMIT');
  assert.deepEqual(result.usage, { used: 8, reserved: 0, limit: 8, unit: 'protocol-step' });
  await runTask(task.id); assert.equal((await getTask(owner, p.id, task.id)).usage.used, 8);
});

test('transient interruption retries from the reserved checkpoint, with a bounded attempt count', async () => {
  const p = await create(), task = await createTask(owner, p.id, input([lock]), boss);
  await assert.rejects(runTask(task.id, { betweenSteps: async () => { throw new Error('injected interruption'); } }));
  assert.equal((await getTask(owner, p.id, task.id)).status, 'retry_wait');
  await runTask(task.id);
  assert.equal((await getTask(owner, p.id, task.id)).status, 'completed');
  assert.equal((await getProject(owner, p.id)).revision, 2);
  const p2 = await create(), exhausted = await createTask(owner, p2.id, input([text()]), boss);
  for (let i = 0; i < 3; i++) await runTask(exhausted.id, { betweenSteps: async () => { throw new Error('injected failure'); } }).catch(() => {});
  assert.equal((await getTask(owner, p2.id, exhausted.id)).error?.code, 'RETRY_LIMIT');
});

test('concurrent manual revision changes reject the queued command without overwriting new state', async () => {
  const p = await create(), task = await createTask(owner, p.id, input([lock]), boss);
  await executeCommand(owner, p.id, { operationId: randomUUID(), expectedRevision: 1,
    command: { type: 'set-lock', objectId: 'table-a', locked: true } });
  await runTask(task.id);
  assert.equal((await getTask(owner, p.id, task.id)).error?.code, 'REVISION_CONFLICT');
  const project = await getProject(owner, p.id);
  assert.deepEqual(project.lockedObjectIds, ['table-a']); assert.equal(project.revision, 2);
});

test('an expired lease while waiting for the project lock rolls the domain write back', async () => {
  const p = await create(), task = await createTask(owner, p.id, input([lock]), boss);
  const claim = (await claimTask(task.id))!; await reserveStep(claim);
  const blocker = await pool.connect();
  try {
    await blocker.query('BEGIN'); await blocker.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [p.id]);
    await pool.query("UPDATE design_tasks SET lease_until=clock_timestamp()+interval '100 milliseconds' WHERE id=$1", [task.id]);
    const execution = executeStep(claim, 0);
    const rejection = assert.rejects(execution, { code: 'TASK_FENCE_LOST' });
    await delay(180); await blocker.query('COMMIT'); await rejection;
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  assert.equal((await getProject(owner, p.id)).revision, 1);
  assert.equal((await getTask(owner, p.id, task.id)).checkpoint.nextStep, 0);
  await runTask(task.id); assert.equal((await getProject(owner, p.id)).revision, 2);
});

test('SSE disconnect is read-only; reconnect by cursor returns only persisted missing events', async () => {
  const p = await create(), task = await createTask(owner, p.id, input([text()]), boss);
  const abort = new AbortController(), response = await taskEventStream(owner, p.id, task.id, 0, abort.signal);
  const reader = response.body!.getReader(), first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /id: 1\nevent: status/);
  abort.abort(); await reader.cancel();
  assert.equal((await getTask(owner, p.id, task.id)).status, 'queued');
  await runTask(task.id);
  const page = await readTaskEvents(owner, p.id, task.id, 1);
  assert.ok(page.events.every(e => e.seq > 1)); assert.equal(page.task.status, 'completed');
  const terminal = await taskEventStream(owner, p.id, task.id, page.task.eventsCursor, new AbortController().signal);
  assert.equal(await terminal.text(), '');
});
