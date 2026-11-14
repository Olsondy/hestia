import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { streamText, generateText, tool } from 'ai';
import { z } from 'zod';
import { fetchModelIds, modelFor, pingService, type Credentials } from './adapters';

// AM02 adapters against a local fake service: request format, streaming and tool-call parsing, usage, list endpoints,
// error and timeout mapping. This checks only the adapter layer; it is not evidence that any real model works.
const key = 'sk-fake-adapter-key-0001';
let server: Server, base = '';
const seen: { path: string; headers: IncomingMessage['headers']; body: Record<string, unknown> | null }[] = [];
const last = (path: string) => [...seen].reverse().find(r => r.path === path)!;
const sse = (events: unknown[]) => events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';

before(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const path = req.url!.split('?')[0], raw = Buffer.concat(chunks).toString();
    seen.push({ path, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const bearer = req.headers.authorization === `Bearer ${key}`, anthropicKey = req.headers['x-api-key'] === key;
    if (path.startsWith('/slow/')) return setTimeout(() => json(200, { data: [] }), 7000);
    if (path === '/chat/v1/models' || path === '/resp/v1/models') return bearer ? json(200, { object: 'list', data: [{ id: 'edit-fast' }, { id: 'design-large' }, { id: 'design-large' }] }) : json(401, { error: { message: 'bad key' } });
    if (path === '/nolist/v1/models') return json(404, { error: 'not found' });
    if (path === '/nolist/v1/chat/completions') return bearer ? json(200, { id: 'c1', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'p' }, finish_reason: 'length' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) : json(401, {});
    if (path === '/anth/v1/models') {
      if (!anthropicKey || req.headers['anthropic-version'] !== '2023-06-01') return json(401, { type: 'error' });
      return req.url!.includes('after_id=') ? json(200, { data: [{ id: 'context-lite' }], has_more: false }) : json(200, { data: [{ id: 'context-pro' }], has_more: true, last_id: 'context-pro' });
    }
    if (path === '/chat/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      return res.end(sse([
        { id: 'c', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: '好的' }, finish_reason: null }] },
        { id: 'c', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'resolve_turn', arguments: '{"reply":' } }] }, finish_reason: null }] },
        { id: 'c', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"ok"}' } }] }, finish_reason: null }] },
        { id: 'c', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
        { id: 'c', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [], usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 } },
      ]));
    }
    if (path === '/resp/v1/responses') return json(200, { id: 'resp_1', object: 'response', created_at: 1, model: 'm', status: 'completed', error: null, incomplete_details: null,
      output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'resolve_turn', arguments: '{"reply":"ok"}', status: 'completed' }],
      usage: { input_tokens: 90, output_tokens: 12, total_tokens: 102, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } });
    if (path === '/anth/v1/messages') return json(200, { id: 'msg_1', type: 'message', role: 'assistant', model: 'm', stop_reason: 'tool_use', stop_sequence: null,
      content: [{ type: 'tool_use', id: 'tu_1', name: 'resolve_turn', input: { reply: 'ok' } }], usage: { input_tokens: 70, output_tokens: 9 } });
    json(404, {});
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => new Promise<void>(resolve => server.close(() => resolve())));

const creds = (path: string, protocol: Credentials['protocol'], compat: Record<string, unknown>, apiKey = key): Credentials =>
  ({ protocol, baseUrl: `${base}${path}`, apiKey, compat: compat as Credentials['compat'], timeoutSeconds: 5 });
const chatCompat = { usageInStream: true, maxTokensField: 'max_completion_tokens', thinkingParam: 'thinking.type' };
const resolveTool = { resolve_turn: tool({ description: 'final', inputSchema: z.object({ reply: z.string() }) }) };

test('chat completions: compat switches shape the request; streamed tool arguments and usage are parsed', async () => {
  const { model, providerOptions } = modelFor(creds('/chat/v1', 'chat', chatCompat), 'design-large', { thinking: 'on' });
  const result = streamText({ model, providerOptions, prompt: '你好', tools: resolveTool, maxOutputTokens: 500, maxRetries: 0 });
  const deltas: string[] = [];
  for await (const part of result.fullStream) if (part.type === 'tool-input-delta') deltas.push(part.delta);
  assert.deepEqual(deltas, ['{"reply":', '"ok"}'], 'tool arguments arrive as they stream');
  assert.deepEqual((await result.toolCalls).map(c => [c.toolName, c.input]), [['resolve_turn', { reply: 'ok' }]]);
  assert.equal(await result.finishReason, 'tool-calls');
  const usage = await result.usage;
  assert.deepEqual([usage.inputTokens, usage.outputTokens], [120, 30]);
  const body = last('/chat/v1/chat/completions').body!;
  assert.equal(body.model, 'design-large'); assert.equal(body.max_completion_tokens, 500); assert.equal(body.max_tokens, undefined);
  assert.deepEqual(body.thinking, { type: 'enabled' }); assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(last('/chat/v1/chat/completions').headers.authorization, `Bearer ${key}`);

  const off = modelFor(creds('/chat/v1', 'chat', { usageInStream: false, maxTokensField: 'max_tokens', thinkingParam: 'enable_thinking' }), 'edit-fast', { thinking: 'off' });
  await streamText({ ...off, prompt: 'x', maxOutputTokens: 100, maxRetries: 0 }).consumeStream();
  const second = last('/chat/v1/chat/completions').body!;
  assert.deepEqual([second.max_tokens, second.enable_thinking, second.stream_options], [100, false, undefined]);
});

test('responses: store and reasoning effort are sent; tool calls and usage are read', async () => {
  const { model, providerOptions } = modelFor(creds('/resp/v1', 'responses', { store: false }), 'design-large', { reasoning: 'high' });
  const result = await generateText({ model, providerOptions, prompt: '你好', tools: resolveTool, maxRetries: 0 });
  assert.deepEqual(result.toolCalls.map(c => [c.toolName, c.input]), [['resolve_turn', { reply: 'ok' }]]);
  assert.deepEqual([result.usage.inputTokens, result.usage.outputTokens], [90, 12]);
  const body = last('/resp/v1/responses').body!;
  assert.equal(body.store, false); assert.equal((body.reasoning as { effort: string }).effort, 'high');
});

test('anthropic messages: root address, version header, x-api-key and thinking budget', async () => {
  const { model, providerOptions } = modelFor(creds('/anth', 'anthropic', { apiVersion: '2023-06-01' }), 'context-pro', { thinking: true, thinkingBudget: 2048 });
  const result = await generateText({ model, providerOptions, prompt: '你好', tools: resolveTool, maxOutputTokens: 4000, maxRetries: 0 });
  assert.deepEqual(result.toolCalls.map(c => [c.toolName, c.input]), [['resolve_turn', { reply: 'ok' }]]);
  assert.equal(result.finishReason, 'tool-calls');
  assert.deepEqual([result.usage.inputTokens, result.usage.outputTokens], [70, 9]);
  const request = last('/anth/v1/messages');
  assert.equal(request.headers['x-api-key'], key); assert.equal(request.headers['anthropic-version'], '2023-06-01');
  assert.deepEqual(request.body!.thinking, { type: 'enabled', budget_tokens: 2048 });
});

test('model lists: /models, Anthropic /v1/models with paging, unsupported and unauthorized', async () => {
  assert.deepEqual(await fetchModelIds(creds('/chat/v1', 'chat', chatCompat)), { ids: ['design-large', 'edit-fast'] });
  assert.deepEqual(await fetchModelIds(creds('/anth/v1', 'anthropic', { apiVersion: '2023-06-01' })), { ids: ['context-lite', 'context-pro'] });
  assert.deepEqual(await fetchModelIds(creds('/nolist/v1', 'chat', chatCompat)), { unsupported: true, code: 'HTTP 404' });
  await assert.rejects(fetchModelIds(creds('/chat/v1', 'chat', chatCompat, 'sk-wrong-key')), { statusCode: 401 });
});

test('connectivity: list read, one-token probe when there is no list, auth failure and timeout', async () => {
  const ok = await pingService(creds('/chat/v1', 'chat', chatCompat), null);
  assert.equal(ok.ok, true); assert.equal(typeof ok.ms, 'number');
  assert.deepEqual(await pingService(creds('/chat/v1', 'chat', chatCompat, 'sk-wrong-key'), null), { ok: false, ms: null, code: 'HTTP 401', reason: '鉴权失败：密钥无效或没有权限。' });
  assert.equal((await pingService(creds('/nolist/v1', 'chat', chatCompat), null)).code, 'HTTP 404');
  assert.equal((await pingService(creds('/nolist/v1', 'chat', chatCompat), 'edit-fast')).ok, true, 'probe with an enabled model ID');
  assert.equal(last('/nolist/v1/chat/completions').body!.max_completion_tokens, 1);
  assert.equal((await pingService(creds('/nolist/v1', 'chat', chatCompat, 'sk-wrong-key'), 'edit-fast')).code, 'HTTP 401');
  const slow = await pingService({ ...creds('/slow/v1', 'chat', chatCompat) }, null);
  assert.deepEqual([slow.ok, slow.code], [false, '超时']);
});
