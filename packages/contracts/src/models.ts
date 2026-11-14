import { z } from 'zod';

// Model registry contract (ADR-0018). Only protocol adapters live in code; no vendor, address or model is built in.

export const protocolSchema = z.enum(['chat', 'responses', 'anthropic']);
export type Protocol = z.infer<typeof protocolSchema>;

// Service-level compatibility switches: a fixed, finite set per protocol, never an arbitrary request body.
export const compatSchemas = {
  chat: z.object({ usageInStream: z.boolean(), maxTokensField: z.enum(['max_tokens', 'max_completion_tokens']),
    thinkingParam: z.enum(['enable_thinking', 'thinking.type', 'reasoning_effort']) }).strict(),
  responses: z.object({ store: z.boolean() }).strict(),
  anthropic: z.object({ apiVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
} as const;
export const compatDefaults = {
  chat: { usageInStream: true, maxTokensField: 'max_tokens', thinkingParam: 'enable_thinking' },
  responses: { store: false },
  anthropic: { apiVersion: '2023-06-01' },
} as const satisfies { [P in Protocol]: z.infer<(typeof compatSchemas)[P]> };

// Model-level call parameters.
export const paramSchemas = {
  chat: z.object({ thinking: z.enum(['unset', 'on', 'off']) }).strict(),
  responses: z.object({ reasoning: z.enum(['unset', 'low', 'medium', 'high']) }).strict(),
  anthropic: z.object({ thinking: z.boolean(), thinkingBudget: z.number().int().min(1024).max(64000) }).strict(),
} as const;
export const paramDefaults = {
  chat: { thinking: 'unset' },
  responses: { reasoning: 'unset' },
  anthropic: { thinking: false, thinkingBudget: 4000 },
} as const satisfies { [P in Protocol]: z.infer<(typeof paramSchemas)[P]> };

export type Compat = z.infer<(typeof compatSchemas)[Protocol]>;
export type ModelParams = z.infer<(typeof paramSchemas)[Protocol]>;

export const modelStateSchema = z.enum(['draft', 'checking', 'admitted', 'failed', 'stale', 'disabled']);
export type ModelState = z.infer<typeof modelStateSchema>;

const baseUrl = z.string().trim().url().max(500);
const serviceFields = {
  name: z.string().trim().min(1).max(80),
  baseUrl,
  timeoutSeconds: z.number().int().min(5).max(600),
  concurrency: z.number().int().min(1).max(1000),
};
export const createServiceSchema = z.object({ ...serviceFields, protocol: protocolSchema, apiKey: z.string().trim().min(8).max(500), compat: z.unknown().optional() }).strict();
export const updateServiceSchema = z.object({ ...serviceFields, protocol: protocolSchema, compat: z.unknown() }).partial().strict();
export const replaceKeySchema = z.object({ apiKey: z.string().trim().min(8).max(500) }).strict();

export const modelIdSchema = z.string().trim().min(1).max(200).regex(/^[\x21-\x7e]+$/, '模型 ID 只能包含可见的 ASCII 字符。');
export const enableModelSchema = z.object({ modelId: modelIdSchema, manual: z.boolean().optional() }).strict();
// Prices are integer fen per million tokens (元 / 百万 token × 100).
export const priceSchema = z.object({ input: z.number().int().min(0).max(10_000_000), output: z.number().int().min(0).max(10_000_000) }).strict();
export const updateModelSchema = z.object({
  name: z.string().trim().min(1).max(80), description: z.string().trim().max(400), maxOutput: z.number().int().min(256).max(200_000),
  params: z.unknown(), price: priceSchema,
}).partial().strict();

export type ServiceView = {
  id: string; name: string; protocol: Protocol; baseUrl: string; keyTail: string; compat: Compat; timeoutSeconds: number; concurrency: number;
  ping: { at: string; ok: boolean; ms: number | null; code?: string; reason?: string } | null;
  catalog: { at: string; ids: string[]; added: string[]; unsupported?: boolean; code?: string } | null;
  createdAt: string; updatedAt: string;
};
export type ModelView = {
  id: string; serviceId: string; modelId: string; manual: boolean; name: string; description: string; maxOutput: number; params: ModelParams;
  state: ModelState; prices: { from: string; input: number; output: number }[]; missingFromCatalog: boolean;
};
