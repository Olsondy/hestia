import { generateText, type LanguageModel } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { Compat, ModelParams, Protocol } from '../../contracts/src/models';

// Protocol adapters (ADR-0018): the only model code in Hestia. One instance per call from the registered address and
// key; no vendor list, no default address. What a protocol or model cannot do is reported by the access check, not
// faked here. The runner above sees the same thing for every protocol: streamed text, tool calls, finish reason, usage.

export type Credentials = { protocol: Protocol; baseUrl: string; apiKey: string; compat: Compat; timeoutSeconds: number };
type Fetch = typeof fetch;
export type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]['providerOptions']>;
type ChatCompat = { usageInStream: boolean; maxTokensField: 'max_tokens' | 'max_completion_tokens'; thinkingParam: 'enable_thinking' | 'thinking.type' | 'reasoning_effort' };

// Anthropic is registered at its root (https://host); the API lives under /v1. Accept a root given with /v1 too.
const anthropicRoot = (baseUrl: string) => baseUrl.replace(/\/v1\/?$/, '');
const anthropicVersion = (compat: Compat) => (compat as { apiVersion: string }).apiVersion;

/** Chat Completions thinking switch in the written form the service documents (compat.thinkingParam). */
function chatBody(compat: ChatCompat, params: ModelParams) {
  const thinking = (params as { thinking: 'unset' | 'on' | 'off' }).thinking;
  return (body: Record<string, unknown>) => {
    const next = { ...body };
    if (compat.maxTokensField === 'max_completion_tokens' && 'max_tokens' in next) { next.max_completion_tokens = next.max_tokens; delete next.max_tokens; }
    if (thinking !== 'unset') {
      const on = thinking === 'on';
      if (compat.thinkingParam === 'enable_thinking') next.enable_thinking = on;
      else if (compat.thinkingParam === 'thinking.type') next.thinking = { type: on ? 'enabled' : 'disabled' };
      else next.reasoning_effort = on ? 'medium' : 'none';
    }
    return next;
  };
}

export function modelFor(credentials: Credentials, modelId: string, params: ModelParams, fetchImpl: Fetch = fetch): { model: LanguageModel; providerOptions: ProviderOptions } {
  const { protocol, baseUrl, apiKey, compat } = credentials;
  if (protocol === 'chat') {
    const chat = compat as ChatCompat;
    return { model: createOpenAICompatible({ name: 'hestia', baseURL: baseUrl, apiKey, includeUsage: chat.usageInStream, fetch: fetchImpl,
      transformRequestBody: chatBody(chat, params) })(modelId), providerOptions: {} };
  }
  if (protocol === 'responses') {
    const reasoning = (params as { reasoning: 'unset' | 'low' | 'medium' | 'high' }).reasoning;
    return { model: createOpenAI({ baseURL: baseUrl, apiKey, fetch: fetchImpl }).responses(modelId),
      providerOptions: { openai: { store: (compat as { store: boolean }).store, ...(reasoning !== 'unset' ? { reasoningEffort: reasoning, forceReasoning: true } : {}) } } };
    // Model IDs are whatever the admin registered, unknown to the SDK's own list: reasoning is forced when asked for.
  }
  const { thinking, thinkingBudget } = params as { thinking: boolean; thinkingBudget: number };
  return { model: createAnthropic({ baseURL: `${anthropicRoot(baseUrl)}/v1`, apiKey, headers: { 'anthropic-version': anthropicVersion(compat) }, fetch: fetchImpl })(modelId),
    providerOptions: thinking ? { anthropic: { thinking: { type: 'enabled', budgetTokens: thinkingBudget } } } : {} };
}

function listRequest({ protocol, baseUrl, apiKey, compat }: Credentials): { url: string; headers: Record<string, string> } {
  return protocol === 'anthropic'
    ? { url: `${anthropicRoot(baseUrl)}/v1/models`, headers: { 'x-api-key': apiKey, 'anthropic-version': anthropicVersion(compat) } }
    : { url: `${baseUrl}/models`, headers: { Authorization: `Bearer ${apiKey}` } };
}

export type PingResult = { ok: boolean; ms: number | null; code?: string; reason?: string };
const failure = (error: unknown, seconds: number): PingResult => {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') return { ok: false, ms: null, code: '超时', reason: `${seconds} 秒内没有响应，服务商可能在限流或故障。` };
  const status = (error as { statusCode?: number })?.statusCode;
  if (status === 401 || status === 403) return { ok: false, ms: null, code: `HTTP ${status}`, reason: '鉴权失败：密钥无效或没有权限。' };
  if (status) return { ok: false, ms: null, code: `HTTP ${status}`, reason: '服务返回错误。' };
  return { ok: false, ms: null, code: '网络错误', reason: '连接不上接口地址，请检查地址与网络。' };
};

/**
 * Connectivity test: one minimal request with the stored key. Reads the model list (no tokens); when the service
 * has no list and a model ID is enabled, sends a one-token request instead. Never touches quota or admission.
 */
export async function pingService(credentials: Credentials, probeModelId: string | null, fetchImpl: Fetch = fetch): Promise<PingResult> {
  const seconds = Math.min(credentials.timeoutSeconds, 20), started = performance.now(), { url, headers } = listRequest(credentials);
  try {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(seconds * 1000) });
    await response.body?.cancel().catch(() => {});
    if (response.ok) return { ok: true, ms: Math.round(performance.now() - started) };
    if (response.status === 401 || response.status === 403) return failure({ statusCode: response.status }, seconds);
    if (![404, 405].includes(response.status)) return failure({ statusCode: response.status }, seconds);
    if (!probeModelId) return { ok: false, ms: null, code: `HTTP ${response.status}`, reason: '服务不提供模型列表；启用一个模型 ID 后再测试连通。' };
  } catch (error) { return failure(error, seconds); }
  try {
    const { model } = modelFor(credentials, probeModelId, { thinking: 'unset', reasoning: 'unset', thinkingBudget: 1024 } as unknown as ModelParams, fetchImpl);
    await generateText({ model, prompt: 'ping', maxOutputTokens: 1, maxRetries: 0, abortSignal: AbortSignal.timeout(seconds * 1000) });
    return { ok: true, ms: Math.round(performance.now() - started) };
  } catch (error) { return failure(error, seconds); }
}

export type CatalogResult = { ids: string[] } | { unsupported: true; code: string };
/** GET /models (Chat Completions, Responses) or /v1/models (Anthropic, paged). Reading the list costs no tokens. */
export async function fetchModelIds(credentials: Credentials, fetchImpl: Fetch = fetch): Promise<CatalogResult> {
  const { url, headers } = listRequest(credentials), ids: string[] = [], seconds = Math.min(credentials.timeoutSeconds, 30);
  let next: string | null = url;
  for (let page = 0; next && page < 20; page++) {
    const response: Response = await fetchImpl(next, { headers, signal: AbortSignal.timeout(seconds * 1000) });
    if (response.status === 401 || response.status === 403) throw Object.assign(new Error('MODEL_LIST_UNAUTHORIZED'), { statusCode: response.status });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); return { unsupported: true, code: `HTTP ${response.status}` }; }
    const data = await response.json().catch(() => null) as { data?: { id?: unknown }[]; has_more?: boolean; last_id?: string } | null;
    if (!data || !Array.isArray(data.data)) return { unsupported: true, code: '格式无法识别' };
    for (const item of data.data) if (typeof item?.id === 'string' && item.id.length <= 200 && !ids.includes(item.id)) ids.push(item.id);
    next = credentials.protocol === 'anthropic' && data.has_more && data.last_id ? `${url}?after_id=${encodeURIComponent(data.last_id)}` : null;
  }
  return { ids: ids.sort() };
}
