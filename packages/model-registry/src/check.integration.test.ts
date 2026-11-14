import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { pool } from '../../persistence/src/client';
import { initializeQueue, MODEL_CHECK_QUEUE } from '../../tasks/src/queue';
import { createService, enableModel, getModel, updateService } from './service';
import { latestCheck, runCheck, startCheck } from './check';

// AM02 access check: the Worker's real-call sequence against local fake services (one that behaves, one that never
// calls tools). This proves the check logic and bookkeeping only; real models are verified separately with real keys.
const run = randomUUID().slice(0, 8), queueSchema = `am02_check_${run}`, actor = { userId: null as unknown as string, email: `am02-check-${run}@example.test` };
const key = 'sk-fake-check-key-0001', saved = process.env.HESTIA_SECRET_KEY;
let server: Server, base = '', producer: Awaited<ReturnType<typeof initializeQueue>>;

const sse = (res: ServerResponse, events: unknown[]) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n'); };
const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] });
const usage = { id: 'c', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [], usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } };

before(async () => {
  process.env.HESTIA_SECRET_KEY ||= randomBytes(32).toString('base64');
  producer = await initializeQueue(queueSchema);
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}'), good = req.url!.startsWith('/good/');
    const text = JSON.stringify(body.messages?.at(-1)?.content ?? '');
    if (req.headers.authorization !== `Bearer ${key}`) { res.writeHead(401); return res.end('{}'); }
    if (!body.stream) { res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id: 'c', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: '好' }, finish_reason: 'stop' }], usage: usage.usage })); }
    if (text.includes('Move it a bit')) return sse(res, [chunk({ role: 'assistant', content: '请问要移动哪件家具、往哪个方向、移动多少？' }), chunk({}, 'stop'), usage]);
    if (text.includes('20 centimetres') || text.includes('complete tool request')) {
      if ((body.max_tokens ?? 0) <= 1) return sse(res, [chunk({ role: 'assistant', content: 'I' }), chunk({}, 'length'), usage]);
      if (!good) return sse(res, [chunk({ role: 'assistant', content: '20 厘米就是 0.2 米，可以向右移动。' }), chunk({}, 'stop'), usage]);
      const args = JSON.stringify({ candidateId: 'synthetic-candidate', operation: { type: 'move_furniture', objectId: 'synthetic-chair', position: { x: 2.2, z: 1 } } });
      return sse(res, [chunk({ role: 'assistant', content: '20 厘米等于 0.2 米。' }),
        chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'edit_candidate', arguments: args.slice(0, 30) } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(30) } }] }), chunk({}, 'tool_calls'), usage]);
    }
    return sse(res, [chunk({ role: 'assistant', content: '我是' }), chunk({ content: '测试模型。' }), chunk({}, 'stop'), usage]);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  if (saved === undefined) delete process.env.HESTIA_SECRET_KEY; else process.env.HESTIA_SECRET_KEY = saved;
  await new Promise<void>(resolve => server.close(() => resolve()));
  try {
    await pool.query('DELETE FROM models WHERE service_id IN (SELECT id FROM model_services WHERE name LIKE $1)', [`%${run}%`]);
    await pool.query('DELETE FROM model_services WHERE name LIKE $1', [`%${run}%`]);
    await pool.query("DELETE FROM platform_audit WHERE actor=$1 OR (actor='access check' AND target LIKE $2)", [actor.email, `%${run}%`]);
    await pool.query(`DROP SCHEMA IF EXISTS ${queueSchema} CASCADE`);
  } finally { await pool.end(); }
});

async function registered(path: string) {
  const service = await createService(actor, { name: `检查-${path}-${run}`, protocol: 'chat', baseUrl: `${base}/${path}/v1`, apiKey: key, timeoutSeconds: 10, concurrency: 2 });
  return { service, model: await enableModel(actor, service.id, { modelId: `fake-${path}-${run}`, manual: true }) };
}

test('a model that streams, calls tools and follows the protocol samples is admitted, with evidence', async () => {
  const { model } = await registered('good');
  const { checkId } = await startCheck(actor, model.id, producer);
  assert.equal((await getModel(model.id)).model.state, 'checking');
  await assert.rejects(startCheck(actor, model.id, producer), { code: 'CHECK_RUNNING' });
  const job = (await pool.query(`SELECT name, data FROM ${queueSchema}.job WHERE id=$1`, [checkId])).rows[0];
  assert.deepEqual([job.name, job.data], [MODEL_CHECK_QUEUE, { checkId }], 'enqueued in the same transaction');

  await runCheck(checkId);
  const check = await latestCheck(model.id);
  assert.equal(check?.status, 'passed', check?.failure ?? '');
  assert.deepEqual(check?.items, { connect: 'ok', stream: 'ok', tools: 'ok', toolStream: 'ok', protocol: 'ok', usage: 'ok' });
  assert.equal((check?.evidence as { protocolSamples: string }).protocolSamples, '3/3');
  assert.equal((await getModel(model.id)).model.state, 'admitted');
  await runCheck(checkId);
  assert.equal((await latestCheck(model.id))?.status, 'passed', 'running a finished check again changes nothing');
});

test('a model that never calls tools fails with the reason; a change during the check voids the result', async () => {
  const { service, model } = await registered('bad');
  const { checkId } = await startCheck(actor, model.id, producer);
  await runCheck(checkId);
  const check = await latestCheck(model.id);
  assert.equal(check?.status, 'failed');
  assert.equal(check?.items.tools, 'fail'); assert.equal(check?.items.connect, 'ok');
  assert.match(check?.failure ?? '', /^工具调用：/);
  assert.equal((await getModel(model.id)).model.state, 'failed');

  const good = await registered('good');
  const second = await startCheck(actor, good.model.id, producer);
  await updateService(actor, good.service.id, { baseUrl: `${base}/good/v2` });
  await runCheck(second.checkId);
  const voided = await latestCheck(good.model.id);
  assert.equal(voided?.status, 'failed'); assert.match(voided?.failure ?? '', /结果作废/);
  assert.equal((await getModel(good.model.id)).model.state, 'stale');
  void service;
});
