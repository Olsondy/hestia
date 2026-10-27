import { z } from 'zod';
import { commandSchema } from './commands';
import { idSchema } from './project';
import type { LayoutPlan } from '../../layout-planner/src/contract';

export const taskStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ type: z.literal('command'), command: commandSchema }).strict(),
]);
export const createDeterministicTaskSchema = z.object({
  operationId: idSchema, expectedRevision: z.number().int().positive(),
  protocol: z.literal('deterministic-v1'), steps: z.array(taskStepSchema).min(1).max(12),
}).strict();
export const createConversationTaskSchema = z.object({
  operationId: idSchema, expectedRevision: z.number().int().positive(),
  protocol: z.literal('conversation-v1'), message: z.string().trim().min(1).max(4000),
  selectedObjectId: z.string().min(1).max(120).optional(), referenceFrame: z.literal('plan'),
}).strict();
export const createTaskSchema = z.discriminatedUnion('protocol', [createDeterministicTaskSchema, createConversationTaskSchema]);
export type TaskStep = z.infer<typeof taskStepSchema>;
/** Retained name for the T07 protocol UI. New clients use CreateConversationTask. */
export type CreateTask = z.infer<typeof createDeterministicTaskSchema>;
export type CreateConversationTask = z.infer<typeof createConversationTaskSchema>;
export type ConversationOutcome = { kind: 'answer' | 'clarification' | 'applied' | 'no_change' | 'candidate'; message: string;
  operationId?: string; projectRevision?: number; objectId?: string; candidateId?: string; candidateRevision?: number; checkId?: string; planReport?: LayoutPlan };
export const conversationInputSchema = z.discriminatedUnion('kind', [
  z.object({ operationId: idSchema, expectedIntentVersion: z.number().int().positive(), expectedRevision: z.number().int().positive(),
    kind: z.literal('message'), message: z.string().trim().min(1).max(4000), questionId: idSchema.optional(),
    selectedObjectId: z.string().min(1).max(120).optional() }).strict(),
  z.object({ operationId: idSchema, expectedIntentVersion: z.number().int().positive(), expectedRevision: z.number().int().positive(),
    kind: z.literal('confirm_requirement'), requirementId: idSchema, requirementRevision: z.number().int().positive() }).strict(),
]);
export type AppendConversationInput = z.infer<typeof conversationInputSchema>;
export type ConversationInputRecord = { id: string; intentVersion: number; kind: 'message' | 'confirmation'; text: string;
  author: 'user'; questionId: string | null; requirementId: string | null; createdAt: string };
export type RequirementRecord = { id: string; revision: number; content: string;
  sourceKind: 'user_explicit' | 'user_confirmed' | 'assistant_suggestion'; sourceInputIds: string[];
  createdAtIntentVersion: number; confirmedByInputId: string | null };
export type ConversationQuestion = { id: string; key: string; prompt: string; status: 'open' | 'answered';
  createdAtIntentVersion: number; answerInputId: string | null };
export type ConversationTurn = { intentVersion: number; input: ConversationState['input']; reply: string | null;
  outcome: ConversationOutcome | null; modelUsage: ConversationState['modelUsage']; status: 'finished' | 'superseded'; unknownUsage: boolean };
export type ConversationBrief = { intentVersion: number; inputs: ConversationInputRecord[]; requirements: RequirementRecord[];
  questions: ConversationQuestion[]; history: ConversationTurn[]; scope: 'requirements_and_local_changes' | 'single_room_candidate';
  summary: string | null; workCompleted: string[] };
export type ModelProfile = 'edit_fast' | 'design_quality';
export type ModelAttempt = { id: string; intentVersion: number; generation: number; profile: ModelProfile; configurationId: string;
  reason: 'initial' | 'retry' | 'fallback'; status: 'in_flight' | 'settled' | 'usage_unknown'; outcome: 'pending' | 'complete' | 'rejected' | 'unknown';
  inputTokens: number | null; outputTokens: number | null; reservedTokens: number; providerStatus: number | null;
  failureCode: string | null; startedAt: string; finishedAt: string | null };
export type ExecutionBudget = { profile: ModelProfile; callLimit: number; tokenLimit: number; knownInputTokens: number; knownOutputTokens: number;
  reservedTokens: number; unresolvedAttempts: number; attempts: ModelAttempt[]; stopReason: string | null };
export type ConversationState = {
  input: { message: string; selectedObjectId: string | null; referenceFrame: 'plan' };
  phase: 'accepted' | 'calling_model' | 'validating' | 'committing' | 'finished';
  outcome: ConversationOutcome | null;
  modelUsage: { inputTokens: number | null; outputTokens: number | null };
  brief?: ConversationBrief;
  execution?: ExecutionBudget;
  retained?: { answerCount: number; requirementCount: number; candidateIds: string[] };
};
export type TaskStatus = 'queued' | 'running' | 'retry_wait' | 'waiting_input' | 'waiting_selection' | 'completed' | 'partial' | 'failed' | 'cancelled';
export const terminalTaskStatuses: ReadonlySet<TaskStatus> = new Set(['completed', 'partial', 'failed', 'cancelled']);
export type TaskError = { code: string; message: string };
export type TaskView = {
  id: string; projectId: string; protocol: 'deterministic-v1' | 'conversation-v1'; label: string; status: TaskStatus;
  checkpoint: { nextStep: number; totalSteps: number; expectedRevision: number };
  generation: number; usage: { limit: number; used: number; reserved: number; unit: 'protocol-step' | 'model-call' };
  conversation?: ConversationState;
  eventsCursor: number; error: TaskError | null; createdAt: string; updatedAt: string;
};
export type TaskEvent = {
  seq: number; taskId: string; type: 'status' | 'text' | 'operation' | 'usage';
  data: Record<string, unknown>; createdAt: string;
};
