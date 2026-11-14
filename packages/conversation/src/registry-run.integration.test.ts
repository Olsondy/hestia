import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { pool } from '../../persistence/src/client';
import { createProject } from '../../projects/src/service';
import { createTask, getTask, appendConversationInput } from '../../tasks/src/service';
import { initializeQueue } from '../../tasks/src/queue';
import { runTask } from '../../tasks/src/runner';
import { toolChunks } from '../../model-validation/src/protocol-fixture';
import { createService, enableModel, updateModel } from '../../model-registry/src/service';
import { updateEnterprise } from '../../model-registry/src/grants';

// AM05 (ADR-0018): the conversation runner takes its model from the registry through the task's workspace, reserves
// quota before the call and settles after; the member's pick applies from the next call; no automatic fallback.
// Real PostgreSQL + a local fake Chat Completions service (adapter-level only; no real model).
const run = randomUUID().slice(0, 8), owner = { userId: `am05-${randomUUID()}` }, schema = `am05_${randomUUID().replaceAll('-', '')}`;
const actor = { userId: null as unknown as string, email: `am05-actor-${run}@example.test` }, key = 'sk-am05-synthetic', saved = process.env.HESTIA_SECRET_KEY;
const answer = { reply: '这是合成空间示意，尚未改变任何物体。', decision: { kind: 'answer', message: '合成说明' } };
let producer: PgBoss, server: Server, base = '', serviceId = '', fast = '', deep = '', workspaceId = '';
const requests: { model: string }[] = [];
const create = () => createProject(owner, { name: '合成模型选择', template: 'courtyard', operationId: randomUUID() });
const input = (extra: Record<string, unknown> = {}) => ({ protocol: 'conversation-v1', operationId: randomUUID(), expectedRevision: 1, message: '只解释这个合成空间，不做修改', referenceFrame: 'plan', ...extra });
const calls = async () => (await pool.query('SELECT model_id, status, cost_fen, input_tokens, output_tokens, unverified, task_id FROM model_calls WHERE workspace_id=$1 ORDER BY started_at', [workspaceId])).rows;

before(async () => {
  process.env.HESTIA_SECRET_KEY ||= randomBytes(32).toString('base64');
  producer = await initializeQueue(schema);
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); requests.push({ model: body.model });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(toolChunks(answer, 'resolve_turn').map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  serviceId = (await createService(actor, { name: `选择服务-${run}`, protocol: 'chat', baseUrl: base, apiKey: key, timeoutSeconds: 20, concurrency: 5 })).id;
  for (const name of ['fast', 'deep']) {
    const model = await enableModel(actor, serviceId, { modelId: `${name}-${run}`, manual: true });
    await updateModel(actor, model.id, { maxOutput: 2000, price: { input: 100, output: 200 } });
    await pool.query("UPDATE models SET state='admitted' WHERE id=$1", [model.id]);
    if (name === 'fast') fast = model.id; else deep = model.id;
  }
  workspaceId = (await pool.query('SELECT workspace_id FROM projects WHERE id=$1', [(await create()).id])).rows[0].workspace_id;
});
after(async () => {
  if (saved === undefined) delete process.env.HESTIA_SECRET_KEY; else process.env.HESTIA_SECRET_KEY = saved;
  await new Promise<void>(resolve => server.close(() => resolve()));
  try {
    await pool.query('DELETE FROM operations WHERE actor_id=$1', [owner.userId]);
    await pool.query('DELETE FROM project_revisions WHERE project_id IN (SELECT id FROM projects WHERE created_by=$1)', [owner.userId]);
    await pool.query('DELETE FROM projects WHERE created_by=$1', [owner.userId]);
    await pool.query('DELETE FROM workspaces WHERE id=$1', [workspaceId]);
    await pool.query('DELETE FROM models WHERE service_id=$1', [serviceId]); await pool.query('DELETE FROM model_services WHERE id=$1', [serviceId]);
    await pool.query("DELETE FROM platform_audit WHERE actor=$1 OR target LIKE $2", [actor.email, `%${run}%`]);
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  } finally { await pool.end(); }
});

test('without granted models the task stops as not opened and no model is called', async () => {
  const p = await create(), task = await createTask(owner, p.id, input(), producer);
  await runTask(task.id);
  const result = await getTask(owner, p.id, task.id);
  assert.deepEqual([result.status, result.error?.code], ['failed', 'MODEL_NOT_GRANTED']);
  assert.equal(requests.length, 0);
  await assert.rejects(createTask(owner, p.id, input({ modelId: fast }), producer), { code: 'MODEL_NOT_ENABLED' });
});

test('the workspace default is used, quota is reserved before the call and settled on its usage', async () => {
  await updateEnterprise(actor, workspaceId, { grants: [fast, deep], quota: null, concurrency: 2 });
  await pool.query('UPDATE workspace_models SET enabled=true WHERE workspace_id=$1', [workspaceId]);
  await pool.query('UPDATE workspace_models SET is_default=true WHERE workspace_id=$1 AND model_id=$2', [workspaceId, deep]);
  const p = await create(), task = await createTask(owner, p.id, input(), producer);
  await runTask(task.id);
  const result = await getTask(owner, p.id, task.id);
  assert.equal(result.conversation!.outcome?.kind, 'answer', JSON.stringify(result.error));
  assert.equal(requests.at(-1)!.model, `deep-${run}`);
  const [call] = (await calls()).filter(c => c.task_id === task.id);
  // 100 input + 30 output tokens from the fixture at 1.00 / 2.00 元 per million → rounded up to 1 分.
  assert.deepEqual([call.model_id, call.status, call.input_tokens, call.output_tokens, call.unverified, Number(call.cost_fen)], [deep, 'settled', 100, 30, false, 1]);
});

test("the member's pick is used, and switching applies from the next call", async () => {
  const p = await create(), task = await createTask(owner, p.id, input({ modelId: fast }), producer);
  await runTask(task.id);
  assert.equal(requests.at(-1)!.model, `fast-${run}`);
  const first = await getTask(owner, p.id, task.id);
  await appendConversationInput(owner, p.id, task.id, { kind: 'message', operationId: randomUUID(), expectedIntentVersion: first.conversation!.brief!.intentVersion,
    expectedRevision: 1, message: '再解释一次', modelId: deep }, producer);
  await runTask(task.id, { intentVersion: first.conversation!.brief!.intentVersion + 1 });
  assert.equal(requests.at(-1)!.model, `deep-${run}`);
  assert.deepEqual((await calls()).filter(c => c.task_id === task.id).map(c => c.model_id), [fast, deep]);
});

test('a disabled pick stops without switching to another model; an exhausted quota sends nothing', async () => {
  const p = await create(), task = await createTask(owner, p.id, input({ modelId: fast }), producer);
  await pool.query("UPDATE models SET state='disabled' WHERE id=$1", [fast]);
  const before = requests.length;
  await runTask(task.id);
  const stopped = await getTask(owner, p.id, task.id);
  assert.deepEqual([stopped.status, stopped.error?.code, requests.length], ['failed', 'MODEL_UNAVAILABLE', before]);
  await pool.query("UPDATE models SET state='admitted' WHERE id=$1", [fast]);

  await updateEnterprise(actor, workspaceId, { quota: 0 });
  const q = await create(), blocked = await createTask(owner, q.id, input(), producer);
  await runTask(blocked.id);
  const result = await getTask(owner, q.id, blocked.id);
  assert.deepEqual([result.status, result.error?.code, requests.length], ['failed', 'QUOTA_EXCEEDED', before]);
  assert.equal((await calls()).filter(c => c.task_id === blocked.id).length, 0);
});
