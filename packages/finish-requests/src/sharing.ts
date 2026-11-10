import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { and, count, desc, eq, getTableColumns, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { DomainError, idSchema } from '../../contracts/src/project';
import { applyBindingSchema, bindShareSchema, createShareSchema, decideApplicationSchema, memberOperationSchema,
  type CreatedShareView, type LeadView, type SharePreviewView } from '../../contracts/src/finish-requests';
import { formatShareCode, normalizeShareCode, shareMessage, SHARE_CODE_ALPHABET, SHARE_CODE_LENGTH } from '../../contracts/src/share-code';
import { advisoryXactLock, db, transaction, type Database } from '../../persistence/src/client';
import { bindingApplications, bindingEvents, finishRequestOperations, finishRequests, finishSchemes, hestiaAuthUser, requestShares,
  shareCodeFailures, workspaces } from '../../persistence/src/schema';
import { actorOf, type Principal } from '../../workspaces/src/access';
import { keyedHash, normalizePhone, requestSource } from '../../identity/src/phone';
import { readRenderImage } from '../../renders/src/service';
import { customer, listLeads, lockedRequest, memberOf, renderScene, view, type RequestRow } from './service';

// D08 + ADR-0012: a share code grants preview only. Binding a request to its one primary customer needs a verified phone
// that matches a targeted share, being the first to sign in on an open share, or member approval. Every step is recorded.
// Binding uses the code up; the request's other codes stop opening while it is bound.

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const codeHash = (code: string) => keyedHash('share-code', code);
type ShareRow = typeof requestShares.$inferSelect;
// RequestRow (service.ts) keeps the column (snake_case) names.
const requestColumns = Object.fromEntries(Object.values(getTableColumns(finishRequests)).map(column => [column.name, column]));
type Reason = 'revoked' | 'expired' | 'used' | 'unavailable';
const messages: Record<Reason, string> = {
  revoked: '这个分享码已被企业撤销。', expired: '这个分享码已过期。', used: '这个分享码已使用，方案已绑定到客户的账号。',
  unavailable: '分享码不正确或已失效，请核对后重试。',
};
const unavailable = (reason: Reason = 'unavailable') => new DomainError('SHARE_UNAVAILABLE', messages[reason], 404, { reason });
const positive = (name: string, fallback: number) => { const value = Number(process.env[name]); return Number.isInteger(value) && value > 0 ? value : fallback; };
/** Source of a request for the share code guessing limit (trusted proxy header, as for phone codes). */
export const shareSource = (headers: Headers | null | undefined) => requestSource(headers, 'share-code');

async function record(tx: Database, requestId: string, shareId: string | null, kind: string, actorId: string, extra: { method?: string; subjectId?: string } = {}) {
  await tx.insert(bindingEvents).values({ id: randomUUID(), requestId, shareId, kind, method: extra.method ?? null, actorId, subjectId: extra.subjectId ?? null });
}
/** Idempotent per actor + operation; results never hold secrets. */
async function once<T>(tx: Database, actor: string, operationId: string, requestId: string, hash: string, work: () => Promise<T>): Promise<T | null> {
  await advisoryXactLock(tx, `binding:${actor}:${operationId}`);
  const [previous] = await tx.select({ requestHash: finishRequestOperations.requestHash }).from(finishRequestOperations)
    .where(and(eq(finishRequestOperations.actorId, actor), eq(finishRequestOperations.id, operationId)));
  if (previous) { if (previous.requestHash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409); return null; }
  const result = await work();
  await tx.insert(finishRequestOperations).values({ actorId: actor, id: operationId, requestId, requestHash: hash, result: result ?? {} });
  return result;
}
async function memberRequest(client: PoolClient, principal: Principal, workspaceId: string, requestId: string) {
  const userId = actorOf(principal), row = await lockedRequest(client, requestId);
  if (row.workspace_id !== idSchema.parse(workspaceId)) throw new DomainError('NOT_FOUND', '方案需求不存在。', 404);
  await memberOf(client, userId, row.workspace_id);
  return { row, userId };
}

/**
 * Share ID for a code. Wrong codes count per source outside any transaction, so they stay counted when the caller
 * fails; once the limit is reached every lookup from that source waits out the window. Known codes never count.
 */
async function shareIdOf(input: string, source: string): Promise<string> {
  const max = positive('HESTIA_SHARE_CODE_MAX_FAILURES', 10), windowSeconds = positive('HESTIA_SHARE_CODE_WINDOW_SECONDS', 900);
  const since = sql`now() - make_interval(secs => ${windowSeconds})`;
  const [{ n }] = await db.select({ n: count() }).from(shareCodeFailures).where(and(eq(shareCodeFailures.sourceHash, source), gt(shareCodeFailures.createdAt, since)));
  if (n >= max) throw new DomainError('SHARE_CODE_RATE_LIMITED', '分享码错误次数过多，请稍后再试。', 429, { retryAfterSeconds: windowSeconds });
  const code = normalizeShareCode(input);
  const [share] = code ? await db.select({ id: requestShares.id }).from(requestShares).where(eq(requestShares.tokenHash, codeHash(code))) : [];
  if (share) return share.id;
  await db.delete(shareCodeFailures).where(and(eq(shareCodeFailures.sourceHash, source), lt(shareCodeFailures.createdAt, since)));
  await db.insert(shareCodeFailures).values({ id: randomUUID(), sourceHash: source });
  throw unavailable();
}
/**
 * A live share: not revoked or expired, request published, and neither this code used nor the request bound — except
 * for the customer it is bound to (`viewerId`), who may still open it. Locks share and request rows when asked.
 */
async function liveShare(client: PoolClient, tx: Database, shareId: string, { lock = false, viewerId = null as string | null } = {}) {
  const query = tx.select().from(requestShares).where(eq(requestShares.id, shareId));
  const [share] = await (lock ? query.for('update') : query);
  if (!share) throw unavailable();
  // The code proves possession, so telling revoked, expired and used apart leaks nothing new.
  if (share.revokedAt) throw unavailable('revoked');
  if (share.expiresAt && share.expiresAt < new Date()) throw unavailable('expired');
  const row = lock ? await lockedRequest(client, share.requestId)
    : (await tx.select(requestColumns).from(finishRequests).where(eq(finishRequests.id, share.requestId)))[0] as RequestRow | undefined;
  if (!row || row.status !== 'published') throw unavailable();
  const mine = !!viewerId && row.customer_id === viewerId;
  if (!mine && (share.codeUsedAt || row.customer_id)) throw unavailable('used');
  return { share, row };
}
const lead = async (principal: Principal, workspaceId: string, requestId: string): Promise<LeadView> =>
  (await listLeads(principal, workspaceId)).find(item => item.id === requestId)!;
const newCode = () => Array.from({ length: SHARE_CODE_LENGTH }, () => SHARE_CODE_ALPHABET[randomInt(SHARE_CODE_ALPHABET.length)]).join('');

/** Member shares a published request. The share code is returned once; only its keyed hash is stored. */
export async function createShare(principal: Principal, workspaceId: string, requestId: string, input: unknown): Promise<CreatedShareView> {
  const value = createShareSchema.parse(input);
  const created = await transaction(async (client, tx) => {
    const { row, userId } = await memberRequest(client, principal, workspaceId, requestId);
    return once(tx, userId, value.operationId, row.id, sha(JSON.stringify({ kind: 'share', requestId, ...value })), async () => {
      if (row.status !== 'published') throw new DomainError('NOT_PUBLISHED', '方案发布后才能分享。', 409);
      if (row.origin === 'customer') throw new DomainError('CUSTOMER_OWNED', '客户自己提交的方案已属于客户本人，无须分享绑定。', 409);
      if (row.customer_id) throw new DomainError('ALREADY_BOUND', '这个方案已绑定客户；如需改给其他客户，请先解绑。', 409);
      const id = randomUUID(), phone = value.phone ? normalizePhone(value.phone) : null;
      let code = newCode();
      // 31^8 codes: a collision is practically impossible, but a code must never open two shares.
      for (let tries = 0; (await tx.select({ one: sql`1` }).from(requestShares).where(eq(requestShares.tokenHash, codeHash(code)))).length; tries++) {
        if (tries > 4) throw new DomainError('SHARE_CODE_UNAVAILABLE', '暂时无法生成分享码，请重试。', 503);
        code = newCode();
      }
      await tx.insert(requestShares).values({ id, requestId: row.id, tokenHash: codeHash(code), targetPhone: phone,
        expiresAt: sql`now()+make_interval(days=>${value.expiresInDays})`, createdBy: userId });
      await record(tx, row.id, id, 'share', userId, { method: phone ? 'phone' : 'code' });
      const [workspace] = await tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, row.workspace_id));
      return { id, code, name: workspace.name, phone: !!phone };
    });
  });
  const current = await lead(principal, workspaceId, requestId);
  if (!created) return { share: current.sharing.shares.at(-1)!, code: null, message: null,
    note: '该操作已执行过；分享码只在首次返回，如已遗失请撤销后重新分享。' };
  return { share: current.sharing.shares.find(s => s.id === created.id)!, code: formatShareCode(created.code), message: shareMessage(created.name, created.code),
    note: `${created.phone ? '客户用该手机号登录后自动绑定；用其他号码登录需要提交绑定申请。' : '第一位登录的客户会绑定这个方案，请只发给客户本人。'}分享码 ${value.expiresInDays} 天内有效，绑定后失效。` };
}
export async function revokeShare(principal: Principal, workspaceId: string, requestId: string, shareId: string, input: unknown) {
  const value = memberOperationSchema.parse(input);
  await transaction(async (client, tx) => {
    const { row, userId } = await memberRequest(client, principal, workspaceId, requestId);
    await once(tx, userId, value.operationId, row.id, sha(JSON.stringify({ kind: 'revoke', shareId })), async () => {
      const updated = await tx.update(requestShares).set({ revokedAt: sql`now()`, revokedBy: userId })
        .where(and(eq(requestShares.id, idSchema.parse(shareId)), eq(requestShares.requestId, row.id), isNull(requestShares.revokedAt)));
      if (!updated.rowCount) throw new DomainError('NOT_FOUND', '分享不存在或已撤销。', 404);
      await tx.update(bindingApplications).set({ status: 'rejected', decidedBy: userId, decidedAt: sql`now()` })
        .where(and(eq(bindingApplications.shareId, shareId), eq(bindingApplications.status, 'pending')));
      await record(tx, row.id, shareId, 'revoke', userId);
    });
  });
  return lead(principal, workspaceId, requestId);
}
export async function unbindCustomer(principal: Principal, workspaceId: string, requestId: string, input: unknown) {
  const value = memberOperationSchema.parse(input);
  await transaction(async (client, tx) => {
    const { row, userId } = await memberRequest(client, principal, workspaceId, requestId);
    await once(tx, userId, value.operationId, row.id, sha(JSON.stringify({ kind: 'unbind', requestId })), async () => {
      if (row.origin === 'customer') throw new DomainError('CUSTOMER_OWNED', '客户自己提交的方案属于客户本人，不能解绑。', 409);
      if (!row.customer_id) throw new DomainError('NOT_BOUND', '该方案尚未绑定客户。', 409);
      await tx.update(finishRequests).set({ customerId: null, updatedAt: sql`now()` }).where(eq(finishRequests.id, row.id));
      await record(tx, row.id, null, 'unbind', userId, { subjectId: row.customer_id });
    });
  });
  return lead(principal, workspaceId, requestId);
}
async function bind(tx: Database, row: RequestRow, share: ShareRow, customerId: string, method: string, actorId: string) {
  if (row.customer_id && row.customer_id !== customerId) throw new DomainError('ALREADY_BOUND', '这个方案已绑定其他客户，你仍可以预览。', 409);
  if (row.customer_id === customerId) return;
  await tx.update(finishRequests).set({ customerId, updatedAt: sql`now()` }).where(eq(finishRequests.id, row.id));
  await tx.update(requestShares).set({ codeUsedAt: sql`now()` }).where(eq(requestShares.id, share.id));
  await tx.update(bindingApplications).set({ status: 'superseded', decidedAt: sql`now()` })
    .where(and(eq(bindingApplications.requestId, row.id), eq(bindingApplications.status, 'pending'), ne(bindingApplications.applicantId, customerId)));
  await record(tx, row.id, share.id, 'bind', actorId, { method, subjectId: customerId });
}
export async function decideApplication(principal: Principal, workspaceId: string, requestId: string, applicationId: string, input: unknown) {
  const value = decideApplicationSchema.parse(input);
  await transaction(async (client, tx) => {
    const { row, userId } = await memberRequest(client, principal, workspaceId, requestId);
    await once(tx, userId, value.operationId, row.id, sha(JSON.stringify({ kind: 'decide', applicationId, decision: value.decision })), async () => {
      const [application] = await tx.select().from(bindingApplications)
        .where(and(eq(bindingApplications.id, idSchema.parse(applicationId)), eq(bindingApplications.requestId, row.id))).for('update');
      if (!application || application.status !== 'pending') throw new DomainError('NOT_FOUND', '绑定申请不存在或已处理。', 404);
      const [share] = await tx.select().from(requestShares).where(eq(requestShares.id, application.shareId));
      if (value.decision === 'approve') await bind(tx, row, share, application.applicantId, 'approval', userId);
      await tx.update(bindingApplications).set({ status: value.decision === 'approve' ? 'approved' : 'rejected', decidedBy: userId, decidedAt: sql`now()` })
        .where(eq(bindingApplications.id, application.id));
      await record(tx, row.id, share.id, value.decision === 'approve' ? 'approve' : 'reject', userId, { subjectId: application.applicantId });
    });
  });
  return lead(principal, workspaceId, requestId);
}

/** On a registered entry domain (ADR-0017) a share code of another enterprise reads as unavailable. */
async function inScope(tx: Database, workspaceId: string, scope: string | null) {
  if (!scope) return;
  const [row] = await tx.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, workspaceId));
  if (row?.slug !== scope) throw unavailable();
}

/** Public preview: published schemes only; no customer, phone or other request data. */
export async function sharePreview(code: string, viewerId: string | null = null, source = shareSource(null), scope: string | null = null): Promise<SharePreviewView> {
  const shareId = await shareIdOf(code, source), canonical = normalizeShareCode(code)!;
  return transaction(async (client, tx) => {
    const { share, row } = await liveShare(client, tx, shareId, { viewerId });
    await inScope(tx, row.workspace_id, scope);
    const application = viewerId ? ((await tx.select({ status: bindingApplications.status }).from(bindingApplications)
      .where(and(eq(bindingApplications.requestId, row.id), eq(bindingApplications.applicantId, viewerId), inArray(bindingApplications.status, ['pending', 'rejected'])))
      .orderBy(desc(bindingApplications.createdAt)).limit(1))[0]?.status as 'pending' | 'rejected' | undefined) ?? null : null;
    const [workspace] = await tx.select({ slug: workspaces.slug, name: workspaces.name }).from(workspaces).where(eq(workspaces.id, row.workspace_id)) as { slug: string; name: string }[];
    const request = await view(client, row, 'customer', workspace.slug);
    request.schemes = request.schemes.map(s => ({ ...s, render: s.render && { ...s.render, imageHref: s.render.status === 'completed' ? `/api/share/${canonical}/schemes/${s.id}/image` : null } }));
    return { workspace, request: { ...request, note: null, preferences: null, confirmation: null }, bound: !!row.customer_id, binding: share.targetPhone ? 'phone' : 'open',
      viewer: viewerId ? { boundToMe: row.customer_id === viewerId, application } : null };
  });
}
export async function shareScene(code: string, schemeId: string, source = shareSource(null), viewerId: string | null = null, scope: string | null = null) {
  const shareId = await shareIdOf(code, source);
  return transaction(async (client, tx) => {
    const { row } = await liveShare(client, tx, shareId, { viewerId });
    await inScope(tx, row.workspace_id, scope);
    return renderScene(client, row, schemeId);
  });
}
export async function shareImage(code: string, schemeId: string, source = shareSource(null), viewerId: string | null = null, scope: string | null = null) {
  const shareId = await shareIdOf(code, source);
  const { row, renderId } = await transaction(async (client, tx) => {
    const { row } = await liveShare(client, tx, shareId, { viewerId });
    await inScope(tx, row.workspace_id, scope);
    const [scheme] = await tx.select({ renderId: finishSchemes.renderId }).from(finishSchemes)
      .where(and(eq(finishSchemes.id, idSchema.parse(schemeId)), eq(finishSchemes.requestId, row.id)));
    if (!scheme?.renderId) throw new DomainError('NOT_FOUND', '方案不存在。', 404);
    return { row, renderId: scheme.renderId };
  });
  return readRenderImage(row.project_id, renderId);
}

/**
 * Signed-in customer at the enterprise entry binds a shared request. Targeted share: the verified phone must match,
 * otherwise the customer can apply for approval. Open share: the first customer to sign in binds.
 */
export async function bindShare(principal: Principal, slug: string, code: string, input: unknown, source = shareSource(null)) {
  const value = bindShareSchema.parse(input), shareId = await shareIdOf(code, source);
  return transaction(async (client, tx) => {
    const { userId, entry } = await customer(client, principal, slug), { share, row } = await liveShare(client, tx, shareId, { lock: true, viewerId: principal.userId });
    if (row.workspace_id !== entry.id) throw unavailable();
    await once(tx, userId, value.operationId, row.id, sha(JSON.stringify({ kind: 'bind', share: share.id })), async () => {
      if (row.customer_id === userId) return { bound: true };
      if (share.targetPhone) {
        const [user] = await tx.select({ phoneNumber: hestiaAuthUser.phoneNumber }).from(hestiaAuthUser).where(eq(hestiaAuthUser.id, userId));
        if (user?.phoneNumber !== share.targetPhone) throw new DomainError('PHONE_MISMATCH', '登录手机号与企业分享时填写的不一致。可换用该手机号登录，或提交绑定申请。', 403);
      }
      await bind(tx, row, share, userId, share.targetPhone ? 'phone' : 'code', userId); return { bound: true };
    });
    return view(client, await lockedRequest(client, row.id), 'customer', slug);
  });
}
export async function applyBinding(principal: Principal, slug: string, code: string, input: unknown, source = shareSource(null)) {
  const value = applyBindingSchema.parse(input), shareId = await shareIdOf(code, source);
  return transaction(async (client, tx) => {
    const { userId, entry } = await customer(client, principal, slug), { share, row } = await liveShare(client, tx, shareId, { lock: true, viewerId: principal.userId });
    if (row.workspace_id !== entry.id) throw unavailable();
    if (row.customer_id === userId) throw new DomainError('ALREADY_BOUND_TO_YOU', '这个方案已绑定到你的账号。', 409);
    await once(tx, userId, value.operationId, row.id, sha(JSON.stringify({ kind: 'apply', share: share.id, note: value.note ?? null })), async () => {
      const [existing] = await tx.select({ id: bindingApplications.id }).from(bindingApplications)
        .where(and(eq(bindingApplications.requestId, row.id), eq(bindingApplications.applicantId, userId), eq(bindingApplications.status, 'pending')));
      if (existing) return { applicationId: existing.id };
      const id = randomUUID();
      await tx.insert(bindingApplications).values({ id, shareId: share.id, requestId: row.id, applicantId: userId, note: value.note ?? null });
      await record(tx, row.id, share.id, 'apply', userId, { subjectId: userId });
      return { applicationId: id };
    });
    return { status: 'pending' as const, message: '已提交绑定申请，企业确认后即可调整和确认方案。' };
  });
}
