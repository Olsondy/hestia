import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectRestrictedTurn } from './restricted-turn.ts';
import { chunk, fixtureModel, toolChunks, validInput } from './protocol-fixture.ts';

const messages = [{ role: 'user' as const, content: 'Move the synthetic chair to (2,1).' }];
test('actual SDK assembles fragmented tool arguments and streams text before returning a validated proposal', async () => {
  let body: Record<string, unknown> | undefined, streamed = '';
  const result = await inspectRestrictedTurn({ model: fixtureModel(toolChunks(), value => { body = value; }), messages,
    requireTool: true, instructions: 'Propose only; never claim an edit was executed.', onText: value => { streamed += value; } });
  assert.equal(result.status, 'validated-request'); assert.equal(result.requests.length, 1);
  assert.deepEqual(result.requests[0].input, validInput); assert.equal(streamed, result.text);
  assert.equal(result.usage.inputTokens, 100); assert.equal(result.usage.outputTokens, 30);
  assert.equal(body?.stream, true); assert.equal((body?.tools as unknown[]).length, 1);
  assert.deepEqual((body?.messages as unknown[])[0], { role: 'system', content: 'Propose only; never claim an edit was executed.' });
  assert.ok(result.firstTextMs !== null && result.firstTextMs <= result.elapsedMs);
});
for (const finish of ['length', 'content_filter', 'error']) {
  test(`complete-looking request followed by ${finish} releases no proposal`, async () => {
    const result = await inspectRestrictedTurn({ model: fixtureModel(toolChunks(validInput, 'edit_candidate', finish)), messages });
    assert.equal(result.status, 'rejected'); assert.deepEqual(result.requests, []);
  });
}
test('missing finish event cannot approve a tool request', async () => {
  const result = await inspectRestrictedTurn({ model: fixtureModel(toolChunks().slice(0, 3)), messages });
  assert.equal(result.status, 'rejected'); assert.deepEqual(result.requests, []);
});
test('truncated JSON, unknown tools, extra fields and out-of-range values are rejected', async () => {
  const cases = [toolChunks(validInput, 'run_shell'), toolChunks({ ...validInput, confirmed: true }),
    toolChunks({ ...validInput, operation: { ...validInput.operation, position: { x: 1e309, z: 1 } } }),
    [chunk({ tool_calls: [{ index: 0, id: 'broken', type: 'function', function: { name: 'edit_candidate', arguments: '{"candidateId":' } }] }), chunk({}, 'tool_calls')]];
  for (const chunks of cases) {
    const result = await inspectRestrictedTurn({ model: fixtureModel(chunks), messages });
    assert.equal(result.status, 'rejected'); assert.deepEqual(result.requests, []);
  }
});
test('text-only is valid for Q&A, but does not establish tool capability', async () => {
  const model = fixtureModel([chunk({ content: 'Synthetic answer.' }), chunk({}, 'stop')]);
  const qa = await inspectRestrictedTurn({ model, messages });
  assert.equal(qa.status, 'text-only'); assert.equal(qa.usage.inputTokens, null);
  const capability = await inspectRestrictedTurn({ model, messages, requireTool: true });
  assert.equal(capability.failure, 'MISSING_TOOL_REQUEST');
});
test('HTTP failure and cancellation return sanitized failures and no proposals', async () => {
  const failed = await inspectRestrictedTurn({ model: fixtureModel([], undefined, 401), messages });
  assert.equal(failed.status, 'rejected'); assert.deepEqual(failed.requests, []);
  const controller = new AbortController(); controller.abort();
  const aborted = await inspectRestrictedTurn({ model: fixtureModel(toolChunks()), messages, signal: controller.signal });
  assert.equal(aborted.failure, 'ABORTED'); assert.deepEqual(aborted.requests, []);
});
test('image content is serialized as inline data without URL fetching', async () => {
  let body: Record<string, unknown> | undefined;
  await inspectRestrictedTurn({ model: fixtureModel([chunk({ content: 'Synthetic image.' }), chunk({}, 'stop')], v => { body = v; }),
    messages: [{ role: 'user', content: [{ type: 'file', data: new Uint8Array([137, 80, 78, 71]), mediaType: 'image/png' }] }] });
  assert.match(JSON.stringify(body?.messages), /data:image\/png;base64,iVBORw==/);
});
test('SDK normalizes duplicate provider IDs; they cannot serve as domain idempotency keys', async () => {
  for (const conflicting of [false, true]) {
    const first = toolChunks().slice(0, 3);
    const secondInput = conflicting ? { ...validInput, operation: { ...validInput.operation, position: { x: 3, z: 1 } } } : validInput;
    const second = chunk({ tool_calls: [{ index: 1, id: 'synthetic-call', type: 'function',
      function: { name: 'edit_candidate', arguments: JSON.stringify(secondInput) } }] });
    const result = await inspectRestrictedTurn({ model: fixtureModel([...first, second, chunk({}, 'tool_calls')]), messages });
    assert.equal(result.status, 'validated-request');
    assert.equal(result.requests.length, 2);
    assert.notEqual(result.requests[0].toolCallId, result.requests[1].toolCallId);
  }
});
test('an empty or refusal-only completion is not reported as a successful answer', async () => {
  const result = await inspectRestrictedTurn({ model: fixtureModel([chunk({ refusal: 'Synthetic refusal.' }), chunk({}, 'stop')]), messages });
  assert.equal(result.status, 'rejected'); assert.deepEqual(result.requests, []);
});
