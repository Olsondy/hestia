import test from 'node:test';
import assert from 'node:assert/strict';
import { execution, initialExecution, reserveAttempt, settleAttempt, MAX_CONTEXT_BYTES, OUTPUT_TOKENS } from './budget';
import type { TaskRow } from './service';

// Pure persisted-state transitions: no database, environment variables or model connection.
function task(): TaskRow {
  return { generation: 1, usage_limit: 8, usage_used: 0, usage_reserved: 0,
    conversation: { callStarted: false, response: null, modelUsage: { inputTokens: null, outputTokens: null },
      brief: { intentVersion: 1, history: [] }, execution: initialExecution() } } as unknown as TaskRow;
}
const reserve = (row: TaskRow, profile: 'edit_fast' | 'design_quality' = 'edit_fast') => reserveAttempt(row,
  { configurationId: 'synthetic-primary', reason: 'initial', profile, contextBytes: 1000 });
const response = (providerStatus: number | null, inputTokens: number | null = null, outputTokens: number | null = null) => ({
  usage: { inputTokens, outputTokens }, failure: 'MODEL_STREAM_ERROR', providerStatus, finishReason: null, text: '', streamedReply: '',
});

test('unknown settlement is idempotent before the surrounding transaction clears its call reservation', () => {
  const row = task(); reserve(row); row.usage_reserved = 1; row.conversation!.callStarted = true;
  settleAttempt(row); const first = structuredClone(row.conversation!.execution);
  settleAttempt(row);
  assert.deepEqual(row.conversation!.execution, first);
  assert.equal(first!.attempts.length, 1); assert.equal(first!.unresolvedAttempts, 1);
  assert.equal(first!.reservedTokens, 1000 + OUTPUT_TOKENS);
});

test('only a 429 with no generated output qualifies as a safely rejected result', () => {
  for (const [status, output, expected] of [[429, '', 'rejected'], [503, '', 'unknown'], [429, 'partial', 'unknown']] as const) {
    const row = task(); reserve(row);
    settleAttempt(row, { ...response(status), streamedReply: output });
    const budget = execution(row); assert.equal(budget.attempts[0].outcome, expected);
    assert.equal(budget.attempts[0].inputTokens, null); assert.equal(budget.attempts[0].outputTokens, null);
    assert.equal(budget.unresolvedAttempts, 1); assert.ok(budget.reservedTokens > 0);
  }
});

test('a partial usage report retains its reservation while complete actual usage is recorded above the estimate', () => {
  const partial = task(); reserve(partial); settleAttempt(partial, response(null, 300, null));
  assert.equal(execution(partial).knownInputTokens, 300); assert.equal(execution(partial).knownOutputTokens, 0);
  assert.equal(execution(partial).reservedTokens, 1000 + OUTPUT_TOKENS);
  const complete = task(); reserve(complete); settleAttempt(complete, response(null, 140000, 7000));
  assert.equal(execution(complete).knownInputTokens, 140000); assert.equal(execution(complete).knownOutputTokens, 7000);
  assert.equal(execution(complete).reservedTokens, 0); assert.equal(execution(complete).unresolvedAttempts, 0);
  assert.throws(() => reserve(complete, 'design_quality'), { code: 'TOKEN_LIMIT' });
});

test('legacy current and historical missing usage survive migration without charging untouched queued input', () => {
  const row = task(); delete row.conversation!.execution;
  row.conversation!.response = { reply: 'saved' }; row.conversation!.modelUsage = { inputTokens: 100, outputTokens: null };
  row.conversation!.brief!.history = [{ reply: 'earlier', unknownUsage: true, modelUsage: { inputTokens: null, outputTokens: null } }] as never;
  const first = execution(row);
  assert.equal(first.unresolvedAttempts, 2); assert.equal(first.reservedTokens, 2 * (MAX_CONTEXT_BYTES + OUTPUT_TOKENS));
  assert.equal(first.knownInputTokens, 100); assert.deepEqual(execution(row), first);
  const untouched = task(); delete untouched.conversation!.execution;
  assert.equal(execution(untouched).unresolvedAttempts, 0); assert.equal(execution(untouched).reservedTokens, 0);
});

test('an in-flight legacy call is migrated once even across repeated recovery settlement', () => {
  const row = task(); delete row.conversation!.execution;
  row.usage_reserved = 1; row.conversation!.callStarted = true;
  settleAttempt(row); const first = structuredClone(execution(row));
  row.generation++;
  settleAttempt(row); assert.deepEqual(execution(row), first);
  assert.equal(first.unresolvedAttempts, 1); assert.equal(first.attempts.length, 1);
});

test('serialized task budget persists across a new intent and execution profile', () => {
  const row = task(); reserve(row); settleAttempt(row, response(429)); row.usage_used = 1;
  const resumed = JSON.parse(JSON.stringify(row)) as TaskRow;
  resumed.generation++; resumed.conversation!.brief!.intentVersion++;
  reserve(resumed, 'design_quality');
  const budget = execution(resumed);
  assert.equal(budget.attempts.length, 2); assert.equal(budget.unresolvedAttempts, 1);
  assert.equal(budget.reservedTokens, 2 * (1000 + OUTPUT_TOKENS));
  assert.deepEqual(budget.attempts.map(attempt => attempt.intentVersion), [1, 2]);
  resumed.usage_used = 8;
  assert.throws(() => reserve(resumed), { code: 'USAGE_LIMIT' });
});
