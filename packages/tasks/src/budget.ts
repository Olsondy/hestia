import { randomUUID } from 'node:crypto';
import { DomainError } from '../../contracts/src/project';
import type { ConversationState, ExecutionBudget, ModelProfile } from '../../contracts/src/tasks';
import type { TaskRow } from './service';

export const TASK_TOKEN_LIMIT = 128000, MAX_CONTEXT_BYTES = 32000, OUTPUT_TOKENS = 1600;
export function initialExecution(profile: ModelProfile = 'edit_fast'): ExecutionBudget {
  return { profile, callLimit: 8, tokenLimit: TASK_TOKEN_LIMIT, knownInputTokens: 0, knownOutputTokens: 0,
    reservedTokens: 0, unresolvedAttempts: 0, attempts: [], stopReason: null };
}
export function execution(row: TaskRow) {
  const conversation = row.conversation!;
  if (!conversation.execution) {
    const budget = initialExecution(); budget.callLimit = row.usage_limit;
    // Old accepted tasks retain conservative usage rather than silently acquiring a fresh budget.
    const records = [...(conversation.brief?.history ?? []).map(turn => turn.modelUsage), conversation.modelUsage];
    budget.knownInputTokens = records.reduce((sum, usage) => sum + (usage.inputTokens ?? 0), 0);
    budget.knownOutputTokens = records.reduce((sum, usage) => sum + (usage.outputTokens ?? 0), 0);
    const history = conversation.brief?.history ?? [];
    const unknownHistory = history.filter(turn => turn.unknownUsage || !!turn.reply && (turn.modelUsage.inputTokens === null || turn.modelUsage.outputTokens === null)).length;
    const unknownCurrent = !!conversation.response && (conversation.modelUsage.inputTokens === null || conversation.modelUsage.outputTokens === null);
    const unknown = unknownHistory + (unknownCurrent ? 1 : 0);
    budget.unresolvedAttempts = unknown; budget.reservedTokens = unknown * (MAX_CONTEXT_BYTES + OUTPUT_TOKENS);
    conversation.execution = budget;
  }
  return conversation.execution;
}
export function retained(conversation: ConversationState) {
  const history = conversation.brief?.history ?? [];
  const outcomes = [...history.map(turn => turn.outcome), conversation.outcome];
  return { answerCount: history.filter(turn => turn.status === 'finished' && turn.reply).length + (conversation.outcome ? 1 : 0),
    requirementCount: conversation.brief?.requirements.length ?? 0,
    candidateIds: [...new Set(outcomes.flatMap(outcome => outcome?.candidateId ? [outcome.candidateId] : []))] };
}
export function hasRetainedWork(row: TaskRow) {
  if (!row.conversation) return row.next_step > 0;
  const work = retained(row.conversation);
  return work.answerCount > 0 || work.requirementCount > 0 || work.candidateIds.length > 0;
}
export function reserveAttempt(row: TaskRow, options: { configurationId: string; reason: 'initial' | 'retry' | 'fallback'; profile: ModelProfile; contextBytes: number }) {
  const budget = execution(row), reservation = options.contextBytes + OUTPUT_TOKENS;
  if (row.usage_used + row.usage_reserved >= row.usage_limit || budget.attempts.length >= budget.callLimit)
    throw new DomainError('USAGE_LIMIT', '本任务已达到调用上限，已完成的成果仍可查看。');
  if (options.contextBytes > MAX_CONTEXT_BYTES) throw new DomainError('CONTEXT_LIMIT', '本轮资料超出当前处理上限，已有需求和成果已保留。');
  if (budget.knownInputTokens + budget.knownOutputTokens + budget.reservedTokens + reservation > budget.tokenLimit)
    throw new DomainError('TOKEN_LIMIT', '本任务已达到处理额度或含待核对用量，已完成的成果仍可查看。');
  const attempt = { id: randomUUID(), intentVersion: row.conversation!.brief?.intentVersion ?? 1, generation: row.generation,
    profile: options.profile, configurationId: options.configurationId, reason: options.reason,
    status: 'in_flight' as const, outcome: 'pending' as const, inputTokens: null, outputTokens: null,
    reservedTokens: reservation, providerStatus: null, failureCode: null, startedAt: new Date().toISOString(), finishedAt: null };
  budget.profile = options.profile; budget.reservedTokens += reservation; budget.attempts.push(attempt); budget.stopReason = null;
  return attempt;
}
export function settleAttempt(row: TaskRow, response?: { usage: ConversationState['modelUsage']; failure: string | null; providerStatus: number | null; finishReason: string | null; text: string; streamedReply: string }) {
  const budget = execution(row);
  let attempt = [...budget.attempts].reverse().find(item => item.status === 'in_flight');
  const currentIntent = row.conversation!.brief?.intentVersion ?? 1;
  const alreadyRecorded = budget.attempts.some(item => item.intentVersion === currentIntent);
  if (!attempt && !alreadyRecorded && row.usage_reserved && row.conversation!.callStarted && !row.conversation!.response) {
    // An in-flight pre-ledger task cannot be silently upgraded to zero external usage.
    attempt = { id: randomUUID(), intentVersion: row.conversation!.brief?.intentVersion ?? 1, generation: row.generation,
      profile: budget.profile, configurationId: 'legacy-unresolved', reason: 'initial', status: 'in_flight', outcome: 'pending',
      inputTokens: null, outputTokens: null, reservedTokens: MAX_CONTEXT_BYTES + OUTPUT_TOKENS,
      providerStatus: null, failureCode: null, startedAt: new Date().toISOString(), finishedAt: null };
    budget.attempts.push(attempt); budget.reservedTokens += attempt.reservedTokens;
  }
  if (!attempt) return;
  const input = response?.usage.inputTokens ?? null, output = response?.usage.outputTokens ?? null;
  attempt.inputTokens = input; attempt.outputTokens = output; attempt.providerStatus = response?.providerStatus ?? null;
  attempt.failureCode = response?.failure ?? 'MODEL_OUTCOME_UNKNOWN'; attempt.finishedAt = new Date().toISOString();
  const rejected = !!response && response.providerStatus === 429 && !response.text && !response.streamedReply && (!response.finishReason || response.finishReason === 'error');
  attempt.outcome = rejected ? 'rejected' : response?.finishReason && response.finishReason !== 'error' ? 'complete' : 'unknown';
  if (input !== null) budget.knownInputTokens += input;
  if (output !== null) budget.knownOutputTokens += output;
  if (input !== null && output !== null) {
    attempt.status = 'settled'; budget.reservedTokens -= attempt.reservedTokens; attempt.reservedTokens = 0;
  } else { attempt.status = 'usage_unknown'; budget.unresolvedAttempts++; }
  if (!response?.failure) attempt.failureCode = response ? null : 'MODEL_OUTCOME_UNKNOWN';
  // Missing usage keeps the original conservative reservation, not an invented zero bill.
  // Known provider values are never clamped to the estimate, including values above the cap.
}
