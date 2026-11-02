import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { and, desc, eq, getTableColumns, inArray, isNull, ne, sql } from 'drizzle-orm';
import { DomainError, idSchema } from '../../contracts/src/project';
import { applyBindingSchema, bindShareSchema, createShareSchema, decideApplicationSchema, memberOperationSchema,
  type CreatedShareView, type LeadView, type SharePreviewView } from '../../contracts/src/finish-requests';
import { advisoryXactLock, transaction, type Database } from '../../persistence/src/client';
import { bindingApplications, bindingEvents, finishRequestOperations, finishRequests, finishSchemes, hestiaAuthUser, requestShares,
  workspaces } from '../../persistence/src/schema';
import { actorOf, type Principal } from '../../workspaces/src/access';
import { normalizePhone } from '../../identity/src/phone';
import { readRenderImage } from '../../renders/src/service';
import { customer, listLeads, lockedRequest, memberOf, renderScene, view, type RequestRow } from './service';

// D08: a share link grants preview only. Binding a request to its one primary customer needs a verified phone that
// matches a targeted share, a one-time binding code told separately, or member approval. Every step is recorded.

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', CODE_TTL_HOURS = 48, CODE_ATTEMPTS = 5;
type ShareRow = typeof requestShares.$inferSelect;
// RequestRow (service.ts) keeps the column (snake_case) names.
const requestColumns = Object.fromEntries(Object.values(getTableColumns(finishRequests)).map(column => [column.name, column]));
const unavailable = (reason: 'revoked' | 'expired' | 'unavailable' = 'unavailable') =>
  new DomainError('SHARE_UNAVAILABLE', reason === 'revoked' ? '这个分享链接已被企业撤销。' : reason === 'expired' ? '这个分享链接已过期。' : '这个分享链接已失效，请联系企业重新分享。', 404, { reason });
const codeHash = (shareId: string, code: string) => sha(`${shareId}:${code.toUpperCase()}`);
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
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
/** A live share: not revoked, not expired, request published. Locks share and request rows when asked. */
async function liveShare(client: PoolClient, tx: Database, token: string, lock = false) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) throw unavailable();
  const query = tx.select().from(requestShares).where(eq(requestShares.tokenHash, sha(token)));
  const [share] = await (lock ? query.for('update') : query);
  if (!share) throw unavailable();
  // The token proves possession of the link, so telling revoked from expired leaks nothing new.
  if (share.revokedAt) throw unavailable('revoked');
  if (share.expiresAt && share.expiresAt < new Date()) throw unavailable('expired');
  const row = lock ? await lockedRequest(client, share.requestId)
    : (await tx.select(requestColumns).from(finishRequests).where(eq(finishRequests.id, share.requestId)))[0] as RequestRow | undefined;
  if (!row || row.status !== 'published') throw unavailable();
  return { share, row };
}
const lead = async (principal: Principal, workspaceId: string, requestId: string): Promise<LeadView> =>
  (await listLeads(principal, workspaceId)).find(item => item.id === requestId)!;

/** Member shares a published request. The link and code are returned once; only their hashes are stored. */
export async function createShare(principal: Principal, workspaceId: string, requestId: string, input: unknown): Promise<CreatedShareView> {
  const value = createShareSchema.parse(input);
  const created = await transaction(async (client, tx) => {
    const { row, userId } = await memberRequest(client, principal, workspaceId, requestId);
    return once(tx, userId, value.operationId, row.id, sha(JSON.stringify({ kind: 'share', requestId, ...value })), async () => {
      if (row.status !== 'published') throw new DomainError('NOT_PUBLISHED', '方案发布后才能分享。', 409);
      if (row.origin === 'customer') throw new DomainError('CUSTOMER_OWNED', '客户自己提交的方案已属于客户本人，无须分享绑定。', 409);
      const id = randomUUID(), token = randomBytes(24).toString('base64url'), phone = value.phone ? normalizePhone(value.phone) : null;
      const code = phone ? null : Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      await tx.insert(requestShares).values({ id, requestId: row.id, tokenHash: sha(token), targetPhone: phone, codeHash: code ? codeHash(id, code) : null,
        codeExpiresAt: code ? new Date(Date.now() + CODE_TTL_HOURS * 3600_000) : null, expiresAt: sql`now()+make_interval(days=>${value.expiresInDays})`, createdBy: userId });
      await record(tx, row.id, id, 'share', userId, { method: phone ? 'phone' : 'code' });
      return { id, token, code };
    });
  });
  const current = await lead(principal, workspaceId, requestId);
  if (!created) return { share: current.sharing.shares.at(-1)!, url: null, token: null, bindingCode: null,
    note: '该操作已执行过；链接与绑定码只在首次返回，如已遗失请撤销后重新分享。' };
  return { share: current.sharing.shares.find(s => s.id === created.id)!, url: `/s/${created.token}`, token: created.token, bindingCode: created.code,
    note: created.code ? `绑定码 ${CODE_TTL_HOURS} 小时内有效，只能使用一次，请通过电话或微信单独告知客户。` : '客户用该手机号登录后自动绑定。' };
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

/** Public preview: published schemes only; no customer, phone or other request data. */
export async function sharePreview(token: string, viewerId: string | null = null): Promise<SharePreviewView> {
  return transaction(async (client, tx) => {
    const { share, row } = await liveShare(client, tx, token);
    const application = viewerId ? ((await tx.select({ status: bindingApplications.status }).from(bindingApplications)
      .where(and(eq(bindingApplications.requestId, row.id), eq(bindingApplications.applicantId, viewerId), inArray(bindingApplications.status, ['pending', 'rejected'])))
      .orderBy(desc(bindingApplications.createdAt)).limit(1))[0]?.status as 'pending' | 'rejected' | undefined) ?? null : null;
    const [workspace] = await tx.select({ slug: workspaces.slug, name: workspaces.name }).from(workspaces).where(eq(workspaces.id, row.workspace_id)) as { slug: string; name: string }[];
    const request = await view(client, row, 'customer', workspace.slug);
    request.schemes = request.schemes.map(s => ({ ...s, render: s.render && { ...s.render, imageHref: s.render.status === 'completed' ? `/api/share/${token}/schemes/${s.id}/image` : null } }));
    return { workspace, request: { ...request, note: null, preferences: null, confirmation: null }, bound: !!row.customer_id, binding: share.targetPhone ? 'phone' : 'code',
      viewer: viewerId ? { boundToMe: row.customer_id === viewerId, application } : null };
  });
}
export async function shareScene(token: string, schemeId: string) {
  return transaction(async (client, tx) => renderScene(client, (await liveShare(client, tx, token)).row, schemeId));
}
export async function shareImage(token: string, schemeId: string) {
  const { row, renderId } = await transaction(async (client, tx) => {
    const { row } = await liveShare(client, tx, token);
    const [scheme] = await tx.select({ renderId: finishSchemes.renderId }).from(finishSchemes)
      .where(and(eq(finishSchemes.id, idSchema.parse(schemeId)), eq(finishSchemes.requestId, row.id)));
    if (!scheme?.renderId) throw new DomainError('NOT_FOUND', '方案不存在。', 404);
    return { row, renderId: scheme.renderId };
  });
  return readRenderImage(row.project_id, renderId);
}

/**
 * Logged-in customer at the enterprise entry binds a shared request. Targeted share: the verified phone must match.
 * Code share: the one-time code must be right (limited attempts). Otherwise the customer can apply for approval.
 */
export async function bindShare(principal: Principal, slug: string, token: string, input: unknown) {
  const value = bindShareSchema.parse(input);
  return transaction(async (client, tx) => {
    const { userId, entry } = await customer(client, principal, slug), { share, row } = await liveShare(client, tx, token, true);
    if (row.workspace_id !== entry.id) throw unavailable();
    const done = await once(tx, userId, value.operationId, row.id, sha(JSON.stringify({ kind: 'bind', token: sha(token), code: value.code ? sha(value.code) : null })), async () => {
      if (row.customer_id === userId) return { bound: true };
      if (row.customer_id) throw new DomainError('ALREADY_BOUND', '这个方案已绑定其他客户，你仍可以预览。', 409);
      if (share.targetPhone) {
        const [user] = await tx.select({ phoneNumber: hestiaAuthUser.phoneNumber }).from(hestiaAuthUser).where(eq(hestiaAuthUser.id, userId));
        if (user?.phoneNumber !== share.targetPhone) throw new DomainError('PHONE_MISMATCH', '登录手机号与企业分享时填写的不一致。可换用该手机号登录，或提交绑定申请。', 403);
        await bind(tx, row, share, userId, 'phone', userId); return { bound: true };
      }
      if (!value.code) throw new DomainError('BINDING_CODE_REQUIRED', '请输入企业告知你的绑定码。', 403);
      if (share.codeUsedAt || !share.codeHash || !share.codeExpiresAt || share.codeExpiresAt < new Date())
        throw new DomainError('BINDING_CODE_EXPIRED', '绑定码已失效，请联系企业重新分享或提交绑定申请。', 403);
      if (share.codeAttempts >= CODE_ATTEMPTS) throw new DomainError('BINDING_CODE_LOCKED', '绑定码错误次数过多，请联系企业重新分享或提交绑定申请。', 403);
      if (!same(codeHash(share.id, value.code), share.codeHash)) {
        await tx.update(requestShares).set({ codeAttempts: sql`${requestShares.codeAttempts}+1` }).where(eq(requestShares.id, share.id));
        // Committed despite the error below: attempts must count.
        throw Object.assign(new DomainError('BINDING_CODE_INVALID', '绑定码不正确。', 403, { remaining: CODE_ATTEMPTS - share.codeAttempts - 1 }), { commit: true });
      }
      await tx.update(requestShares).set({ codeUsedAt: sql`now()` }).where(eq(requestShares.id, share.id));
      await bind(tx, row, share, userId, 'code', userId); return { bound: true };
    }).catch(async error => { if ((error as { commit?: boolean }).commit) return error as DomainError; throw error; });
    if (done instanceof DomainError) return done;
    return view(client, await lockedRequest(client, row.id), 'customer', slug);
  }).then(result => { if (result instanceof DomainError) throw result; return result; });
}
export async function applyBinding(principal: Principal, slug: string, token: string, input: unknown) {
  const value = applyBindingSchema.parse(input);
  return transaction(async (client, tx) => {
    const { userId, entry } = await customer(client, principal, slug), { share, row } = await liveShare(client, tx, token, true);
    if (row.workspace_id !== entry.id) throw unavailable();
    if (row.customer_id === userId) throw new DomainError('ALREADY_BOUND_TO_YOU', '这个方案已绑定到你的账号。', 409);
    if (row.customer_id) throw new DomainError('ALREADY_BOUND', '这个方案已绑定其他客户，你仍可以预览。', 409);
    await once(tx, userId, value.operationId, row.id, sha(JSON.stringify({ kind: 'apply', token: sha(token), note: value.note ?? null })), async () => {
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
