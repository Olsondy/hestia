import { and, eq, sql } from 'drizzle-orm';
import { generateText, streamText, tool } from 'ai';
import type { PgBoss } from 'pg-boss';
import { db, transaction } from '../../persistence/src/client';
import { modelChecks, models, modelServices } from '../../persistence/src/schema';
import { DomainError } from '../../contracts/src/project';
import type { ModelParams } from '../../contracts/src/models';
import { editCandidateSchema, inspectRestrictedTurn } from '../../model-validation/src/restricted-turn';
import { recordAudit } from '../../platform-admin/src/service';
import type { PlatformAdmin } from '../../platform-admin/src/guard';
import { modelFor } from './adapters';
import { serviceCredentials } from './service';
import { MODEL_CHECK_QUEUE } from '../../tasks/src/queue';

// Access check (ADR-0018): real calls to the registered model with synthetic samples, run by the Worker, never by the
// request. Admission needs connectivity, streaming, tool calls and the Hestia protocol samples; streamed tool arguments
// and usage may be reported as unsupported (usage then counts at the reserved amount as unverified).

export const checkItems = ['connect', 'stream', 'tools', 'toolStream', 'protocol', 'usage'] as const;
type Item = (typeof checkItems)[number];
type Outcome = 'ok' | 'fail' | 'unsupported' | 'todo';
const required: Item[] = ['connect', 'stream', 'tools', 'protocol'];

// Same synthetic policy and cases as the T01 protocol evaluation (scripts/validation/model-evaluation.ts), text only.
const policy = 'This is an isolated validation. Tools propose edits only; no executor exists. Never claim edits have happened. Only propose an edit explicitly requested by the user for a unique target.';
const unitEdit = 'In synthetic-candidate, the uniquely selected synthetic-chair is at x=2,z=1 metres. Image-right is world +x. Explain whether 20 centimetres equals 0.2 metres, and propose moving only that chair 20 centimetres to the right.';
const ambiguity = 'Move it a bit over there. Nothing is selected and there is no direction or distance. Ask the necessary question, without guessing or changing the candidate.';
const truncated = 'Propose moving synthetic-chair in synthetic-candidate to x=2,z=1. Give a full explanation and the complete tool request.';

/** What the result depends on; a change while the check runs voids it. */
const fingerprint = (service: typeof modelServices.$inferSelect, model: typeof models.$inferSelect) =>
  JSON.stringify([service.protocol, service.baseUrl, service.compat, service.keyCiphertext, model.modelId, model.params]);

type Producer = Pick<PgBoss, 'send'>;
export async function startCheck(actor: Pick<PlatformAdmin, 'userId' | 'email'>, modelId: string, producer: Producer) {
  if (!/^[0-9a-f-]{36}$/i.test(modelId)) throw new DomainError('NOT_FOUND', '模型不存在。', 404);
  return transaction(async (client, tx) => {
    const [model] = await tx.select().from(models).where(eq(models.id, modelId)).for('update');
    if (!model) throw new DomainError('NOT_FOUND', '模型不存在。', 404);
    if (model.state === 'checking') throw new DomainError('CHECK_RUNNING', '接入检查已经在进行。', 409);
    if (model.state === 'disabled') throw new DomainError('MODEL_DISABLED', '模型已停用，重新启用后再检查。', 409);
    const [service] = await tx.select().from(modelServices).where(eq(modelServices.id, model.serviceId));
    const [check] = await tx.insert(modelChecks).values({ modelId, status: 'running', startedBy: actor.email,
      results: { items: Object.fromEntries(checkItems.map(item => [item, 'todo'])), fingerprint: fingerprint(service, model) } }).returning();
    await tx.update(models).set({ state: 'checking', updatedAt: sql`now()` }).where(eq(models.id, modelId));
    await recordAudit({ actorUserId: actor.userId, actor: actor.email, action: 'start_check', target: model.modelId }, tx);
    const jobId = await producer.send(MODEL_CHECK_QUEUE, { checkId: check.id }, { id: check.id, db: { executeSql: (text: string, values?: unknown[]) => client.query(text, values) } } as never);
    if (!jobId) throw new Error('Model check job was not enqueued');
    return { checkId: check.id };
  });
}

export async function latestCheck(modelId: string) {
  const [row] = await db.select().from(modelChecks).where(eq(modelChecks.modelId, modelId)).orderBy(sql`${modelChecks.startedAt} DESC`).limit(1);
  return row ? { id: row.id, status: row.status, startedAt: row.startedAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null,
    startedBy: row.startedBy, items: (row.results as { items: Record<Item, Outcome> }).items, evidence: (row.results as { evidence?: unknown }).evidence ?? null,
    failure: row.failure } : null;
}

const reason = (error: unknown) => {
  const status = (error as { statusCode?: number })?.statusCode, name = error instanceof Error ? error.name : '';
  return status === 401 || status === 403 ? '鉴权失败：密钥无效或没有权限。' : name === 'TimeoutError' || name === 'AbortError' ? '没有在超时时间内响应。'
    : status ? `服务返回 HTTP ${status}。` : '连接不上接口地址。';
};

/** Worker entry. Idempotent per check: a check that already finished is left alone. */
export async function runCheck(checkId: string, fetchImpl: typeof fetch = fetch) {
  const [check] = await db.select().from(modelChecks).where(eq(modelChecks.id, checkId));
  if (!check || check.status !== 'running') return;
  const [model] = await db.select().from(models).where(eq(models.id, check.modelId));
  const credentials = await serviceCredentials(model.serviceId);
  const { model: lm, providerOptions } = modelFor(credentials, model.modelId, model.params as ModelParams, fetchImpl);
  const signal = () => AbortSignal.timeout(credentials.timeoutSeconds * 1000);
  const items: Record<Item, Outcome> = Object.fromEntries(checkItems.map(item => [item, 'todo'])) as Record<Item, Outcome>;
  const evidence: Record<string, unknown> = {}, usage: { input: number | null; output: number | null }[] = [];
  let failure: string | null = null;
  const fail = (item: Item, why: string) => { items[item] = 'fail'; failure ??= `${({ connect: '连通与鉴权', stream: '流式输出', tools: '工具调用', toolStream: '工具参数流式返回', protocol: 'Hestia 协议样本', usage: '返回用量' })[item]}：${why}`; };

  try {
    const result = await generateText({ model: lm, providerOptions, prompt: '只回复“好”。', maxOutputTokens: 64, maxRetries: 0, abortSignal: signal() });
    items.connect = 'ok'; usage.push({ input: result.usage.inputTokens ?? null, output: result.usage.outputTokens ?? null });
  } catch (error) { fail('connect', reason(error)); }

  if (items.connect === 'ok') {
    try {
      const stream = streamText({ model: lm, providerOptions, prompt: '用一句话介绍你自己。', maxOutputTokens: 256, maxRetries: 0, abortSignal: signal(), onError: () => {} });
      let deltas = 0, text = '';
      for await (const part of stream.fullStream) if (part.type === 'text-delta' && part.text) { deltas++; text += part.text; }
      if (deltas && text.trim()) items.stream = 'ok'; else fail('stream', '没有收到流式文本。');
      evidence.streamDeltas = deltas;
    } catch (error) { fail('stream', reason(error)); }

    const turn = await inspectRestrictedTurn({ model: lm, messages: [{ role: 'user', content: unitEdit }], instructions: policy, requireTool: true, maxOutputTokens: 1024, signal: signal() });
    const position = turn.requests[0]?.input.operation.position;
    evidence.unitEdit = { status: turn.status, failure: turn.failure, finishReason: turn.finishReason, position: position ?? null };
    usage.push({ input: turn.usage.inputTokens, output: turn.usage.outputTokens });
    if (turn.status === 'validated-request' && turn.requests.length === 1 && Math.abs(position!.x - 2.2) < 1e-6 && position!.z === 1) items.tools = 'ok';
    else fail('tools', turn.status === 'validated-request' ? '工具调用的参数不正确。' : `模型没有按要求调用工具（${turn.failure ?? turn.status}）。`);

    try {
      const stream = streamText({ model: lm, providerOptions, instructions: policy, messages: [{ role: 'user', content: unitEdit }], maxOutputTokens: 1024, maxRetries: 0,
        tools: { edit_candidate: tool({ description: 'Propose moving the synthetic chair inside the synthetic candidate.', inputSchema: editCandidateSchema }) },
        toolChoice: 'required', abortSignal: signal(), onError: () => {} });
      let deltas = 0, called = false;
      for await (const part of stream.fullStream) { if (part.type === 'tool-input-delta') deltas++; if (part.type === 'tool-call') called = true; }
      items.toolStream = deltas > 1 ? 'ok' : called ? 'unsupported' : 'fail';
      if (items.toolStream === 'fail') fail('toolStream', '没有收到工具调用。');
      evidence.toolInputDeltas = deltas;
    } catch (error) { fail('toolStream', reason(error)); }

    const ask = await inspectRestrictedTurn({ model: lm, messages: [{ role: 'user', content: ambiguity }], instructions: policy, maxOutputTokens: 512, signal: signal() });
    const cut = await inspectRestrictedTurn({ model: lm, messages: [{ role: 'user', content: truncated }], instructions: policy, requireTool: true, maxOutputTokens: 1, signal: signal() });
    usage.push({ input: ask.usage.inputTokens, output: ask.usage.outputTokens });
    evidence.ambiguity = { status: ask.status, failure: ask.failure }; evidence.truncated = { status: cut.status, failure: cut.failure };
    const samples = [items.tools === 'ok', ask.status === 'text-only', cut.status === 'rejected' && cut.requests.length === 0];
    evidence.protocolSamples = `${samples.filter(Boolean).length}/3`;
    if (samples.every(Boolean)) items.protocol = 'ok';
    else fail('protocol', ask.status !== 'text-only' ? '在指令不明确时没有先澄清。' : !samples[2] ? '截断的回复没有被拒绝。' : '单位换算与移动提案不正确。');

    items.usage = usage.length && usage.every(u => typeof u.input === 'number' && typeof u.output === 'number') ? 'ok' : 'unsupported';
  }
  evidence.usage = usage;
  const passed = required.every(item => items[item] === 'ok');

  await transaction(async (_client, tx) => {
    const [service] = await tx.select().from(modelServices).where(eq(modelServices.id, model.serviceId));
    const [now] = await tx.select().from(models).where(eq(models.id, model.id)).for('update');
    const changed = fingerprint(service, now) !== (check.results as { fingerprint: string }).fingerprint;
    const final = changed ? '检查期间服务或模型设置被修改，结果作废，请重新检查。' : failure;
    await tx.update(modelChecks).set({ status: passed && !changed ? 'passed' : 'failed', finishedAt: sql`now()`, failure: passed && !changed ? null : final,
      results: { items, evidence, fingerprint: (check.results as { fingerprint: string }).fingerprint } }).where(and(eq(modelChecks.id, checkId), eq(modelChecks.status, 'running')));
    if (now.state === 'checking') await tx.update(models).set({ state: changed ? 'stale' : passed ? 'admitted' : 'failed', updatedAt: sql`now()` }).where(eq(models.id, model.id));
    await recordAudit({ actor: 'access check', action: 'finish_check', target: model.modelId, detail: { passed: passed && !changed, items } }, tx);
  });
}
