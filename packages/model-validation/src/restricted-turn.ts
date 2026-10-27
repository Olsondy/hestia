import { streamText, tool, type LanguageModel, type ModelMessage } from 'ai';
import { z } from 'zod';

// Validation-only subset of edit_candidate. T04 must define the production domain contract.
export const editCandidateSchema = z.object({
  candidateId: z.literal('synthetic-candidate'),
  operation: z.object({
    type: z.literal('move_furniture'), objectId: z.literal('synthetic-chair'),
    position: z.object({ x: z.number().finite().min(0).max(6), z: z.number().finite().min(0).max(4) }).strict(),
  }).strict(),
}).strict();

export type ValidatedRequest = { toolCallId: string; toolName: 'edit_candidate'; input: z.infer<typeof editCandidateSchema> };
export type TurnProbe = {
  status: 'validated-request' | 'text-only' | 'rejected';
  text: string;
  requests: ValidatedRequest[];
  failure: string | null;
  finishReason: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null };
  elapsedMs: number;
  firstTextMs: number | null;
};

/** No execute functions, database or project mutation. Valid requests remain proposals. */
export async function inspectRestrictedTurn(options: {
  model: LanguageModel; messages: ModelMessage[]; signal?: AbortSignal; requireTool?: boolean;
  onText?: (delta: string) => void;
  maxOutputTokens?: number;
  instructions?: string;
}): Promise<TurnProbe> {
  const start = performance.now();
  let text = '', failure: string | null = null, finishReason: string | null = null;
  let firstTextMs: number | null = null;
  const requests = new Map<string, ValidatedRequest>();
  let usage: TurnProbe['usage'] = { inputTokens: null, outputTokens: null };
  try {
    const result = streamText({
      model: options.model, messages: options.messages, instructions: options.instructions,
      tools: { edit_candidate: tool({ description: 'Propose moving the synthetic chair inside the synthetic candidate.', inputSchema: editCandidateSchema }) },
      maxRetries: 0, maxOutputTokens: options.maxOutputTokens ?? 1024, abortSignal: options.signal,
      // SDK errors may contain HTTP request headers; never emit their raw text here.
      onError: () => {},
    });
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') { if (part.text && firstTextMs === null) firstTextMs = performance.now() - start; text += part.text; options.onText?.(part.text); }
      if (part.type === 'error' || part.type === 'tool-error') failure = 'PROVIDER_OR_STREAM_ERROR';
      if (part.type === 'abort') failure = 'ABORTED';
      if (part.type === 'tool-call') {
        const parsed = editCandidateSchema.safeParse(part.input);
        if (part.invalid || part.toolName !== 'edit_candidate' || !parsed.success || !part.toolCallId) {
          failure = 'INVALID_TOOL_REQUEST'; continue;
        }
        const request: ValidatedRequest = { toolCallId: part.toolCallId, toolName: 'edit_candidate', input: parsed.data };
        const previous = requests.get(part.toolCallId);
        if (previous && JSON.stringify(previous) !== JSON.stringify(request)) failure = 'CONFLICTING_TOOL_CALL_ID';
        else requests.set(part.toolCallId, request);
      }
      if (part.type === 'finish') {
        finishReason = part.finishReason;
        usage = { inputTokens: part.totalUsage.inputTokens ?? null, outputTokens: part.totalUsage.outputTokens ?? null };
      }
    }
    if (!failure && finishReason !== 'stop' && finishReason !== 'tool-calls') failure = 'INCOMPLETE_OR_REFUSED';
    if (!failure && requests.size && finishReason !== 'tool-calls') failure = 'INCONSISTENT_TOOL_FINISH';
    if (!failure && !requests.size && (options.requireTool || finishReason === 'tool-calls')) failure = 'MISSING_TOOL_REQUEST';
    if (!failure && !requests.size && !text.trim()) failure = 'EMPTY_RESPONSE';
  } catch {
    failure = options.signal?.aborted ? 'ABORTED' : 'PROVIDER_OR_STREAM_ERROR';
  }
  if (options.signal?.aborted) failure = 'ABORTED';
  return { status: failure ? 'rejected' : requests.size ? 'validated-request' : 'text-only', text,
    requests: failure ? [] : [...requests.values()], failure, finishReason, usage, elapsedMs: performance.now() - start, firstTextMs };
}
