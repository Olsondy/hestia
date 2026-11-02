import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DomainError, idSchema } from '../../contracts/src/project';
import { applyBindingSchema, bindShareSchema, createShareSchema, decideApplicationSchema, memberOperationSchema,
  type CreatedShareView, type LeadView, type SharePreviewView } from '../../contracts/src/finish-requests';
import { transaction } from '../../persistence/src/client';
import { actorOf, type Principal } from '../../workspaces/src/access';
import { normalizePhone } from '../../identity/src/phone';
import { readRenderImage } from '../../renders/src/service';
import { customer, listLeads, lockedRequest, memberOf, view, type RequestRow } from './service';

// D08: a share link grants preview only. Binding a request to its one primary customer needs a verified phone that
// matches a targeted share, a one-time binding code told separately, or member approval. Every step is recorded.

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', CODE_TTL_HOURS = 48, CODE_ATTEMPTS = 5;
type ShareRow = { id: string; request_id: string; token_hash: string; target_phone: string | null; code_hash: string | null; code_expires_at: Date | null;
  code_attempts: number; code_used_at: Date | null; expires_at: Date | null; revoked_at: Date | null; created_by: string; created_at: Date };
const unavailable = () => new DomainError('SHARE_UNAVAILABLE', '这个分享链接已失效，请联系企业重新分享。', 404);
const codeHash = (shareId: string, code: string) => sha(`${shareId}:${code.toUpperCase()}`);
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function record(client: PoolClient, requestId: string, shareId: string | null, kind: string, actorId: string, extra: { method?: string; subjectId?: string } = {}) {
  await client.query('INSERT INTO binding_events(id,request_id,share_id,kind,method,actor_id,subject_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(), requestId, shareId, kind, extra.method ?? null, actorId, extra.subjectId ?? null]);
}
/** Idempotent per actor + operation; results never hold secrets. */
async function once<T>(client: PoolClient, actor: string, operationId: string, requestId: string, hash: string, work: () => Promise<T>): Promise<T | null> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`binding:${actor}:${operationId}`]);
  const previous = (await client.query('SELECT request_hash,result FROM finish_request_operations WHERE actor_id=$1 AND id=$2', [actor, operationId])).rows[0];
  if (previous) { if (previous.request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409); return null; }
  const result = await work();
  await client.query('INSERT INTO finish_request_operations(actor_id,id,request_id,request_hash,result) VALUES($1,$2,$3,$4,$5)', [actor, operationId, requestId, hash, result ?? {}]);
  return result;
}
async function memberRequest(client: PoolClient, principal: Principal, workspaceId: string, requestId: string) {
  const userId = actorOf(principal), row = await lockedRequest(client, requestId);
  if (row.workspace_id !== idSchema.parse(workspaceId)) throw new DomainError('NOT_FOUND', '方案需求不存在。', 404);
  await memberOf(client, userId, row.workspace_id);
  return { row, userId };
}
/** A live share: not revoked, not expired, request published. Locks share and request rows when asked. */
async function liveShare(client: PoolClient, token: string, lock = false) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) throw unavailable();
  const share = (await client.query<ShareRow>(`SELECT * FROM request_shares WHERE token_hash=$1${lock ? ' FOR UPDATE' : ''}`, [sha(token)])).rows[0];
  if (!share || share.revoked_at || (share.expires_at && share.expires_at < new Date())) throw unavailable();
  const row = lock ? await lockedRequest(client, share.request_id) : (await client.query<RequestRow>('SELECT * FROM finish_requests WHERE id=$1', [share.request_id])).rows[0];
  if (!row || row.status !== 'published') throw unavailable();
  return { share, row };
}
const lead = async (principal: Principal, workspaceId: string, requestId: string): Promise<LeadView> =>
  (await listLeads(principal, workspaceId)).find(item => item.id === requestId)!;

/** Member shares a published request. The link and code are returned once; only their hashes are stored. */
export async function createShare(principal: Principal, workspaceId: string, requestId: string, input: unknown): Promise<CreatedShareView> {
  const value = createShareSchema.parse(input);
  const created = await transaction(async client => {
    const { row, userId } = await memberRequest(client, principal, workspaceId, requestId);
    return once(client, userId, value.operationId, row.id, sha(JSON.stringify({ kind: 'share', requestId, ...value })), async () => {
      if (row.status !== 'published') throw new DomainError('NOT_PUBLISHED', '方案发布后才能分享。', 409);
      if (row.origin === 'customer') throw new DomainError('CUSTOMER_OWNED', '客户自己提交的方案已属于客户本人，无须分享绑定。', 409);
      const id = randomUUID(), token = randomBytes(24).toString('base64url'), phone = value.phone ? normalizePhone(value.phone) : null;
      const code = phone ? null : Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      await client.query(`INSERT INTO request_shares(id,request_id,token_hash,target_phone,code_hash,code_expires_at,expires_at,created_by)
        VALUES($1,$2,$3,$4,$5,$6,now()+make_interval(days=>$7),$8)`, [id, row.id, sha(token), phone, code ? codeHash(id, code) : null,
        code ? new Date(Date.now() + CODE_TTL_HOURS * 3600_000) : null, value.expiresInDays, userId]);
      await record(client, row.id, id, 'share', userId, { method: phone ? 'phone' : 'code' });
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
  await transaction(async client => {
    const { row, userId } = await memberRequest(client, principal, workspaceId, requestId);
    await once(client, userId, value.operationId, row.id, sha(JSON.stringify({ kind: 'revoke', shareId })), async () => {
      const updated = await client.query('UPDATE request_shares SET revoked_at=now(),revoked_by=$3 WHERE id=$1 AND request_id=$2 AND revoked_at IS NULL', [idSchema.parse(shareId), row.id, userId]);
      if (!updated.rowCount) throw new DomainError('NOT_FOUND', '分享不存在或已撤销。', 404);
      await client.query("UPDATE binding_applications SET status='rejected',decided_by=$2,decided_at=now() WHERE share_id=$1 AND status='pending'", [shareId, userId]);
      await record(client, row.id, shareId, 'revoke', userId);
    });
  });
  return lead(principal, workspaceId, requestId);
}
export async function unbindCustomer(principal: Principal, workspaceId: string, requestId: string, input: unknown) {
  const value = memberOperationSchema.parse(input);
  await transaction(async client => {
    const { row, userId } = await memberRequest(client, principal, workspaceId, requestId);
    await once(client, userId, value.operationId, row.id, sha(JSON.stringify({ kind: 'unbind', requestId })), async () => {
      if (row.origin === 'customer') throw new DomainError('CUSTOMER_OWNED', '客户自己提交的方案属于客户本人，不能解绑。', 409);
      if (!row.customer_id) throw new DomainError('NOT_BOUND', '该方案尚未绑定客户。', 409);
      await client.query('UPDATE finish_requests SET customer_id=NULL,updated_at=now() WHERE id=$1', [row.id]);
      await record(client, row.id, null, 'unbind', userId, { subjectId: row.customer_id });
    });
  });
  return lead(principal, workspaceId, requestId);
}
async function bind(client: PoolClient, row: RequestRow, share: ShareRow, customerId: string, method: string, actorId: string) {
  if (row.customer_id && row.customer_id !== customerId) throw new DomainError('ALREADY_BOUND', '这个方案已绑定其他客户，你仍可以预览。', 409);
  if (row.customer_id === customerId) return;
  await client.query('UPDATE finish_requests SET customer_id=$2,updated_at=now() WHERE id=$1', [row.id, customerId]);
  await client.query("UPDATE binding_applications SET status='superseded',decided_at=now() WHERE request_id=$1 AND status='pending' AND applicant_id<>$2", [row.id, customerId]);
  await record(client, row.id, share.id, 'bind', actorId, { method, subjectId: customerId });
}
export async function decideApplication(principal: Principal, workspaceId: string, requestId: string, applicationId: string, input: unknown) {
  const value = decideApplicationSchema.parse(input);
  await transaction(async client => {
    const { row, userId } = await memberRequest(client, principal, workspaceId, requestId);
    await once(client, userId, value.operationId, row.id, sha(JSON.stringify({ kind: 'decide', applicationId, decision: value.decision })), async () => {
      const application = (await client.query('SELECT * FROM binding_applications WHERE id=$1 AND request_id=$2 FOR UPDATE', [idSchema.parse(applicationId), row.id])).rows[0];
      if (!application || application.status !== 'pending') throw new DomainError('NOT_FOUND', '绑定申请不存在或已处理。', 404);
      const share = (await client.query<ShareRow>('SELECT * FROM request_shares WHERE id=$1', [application.share_id])).rows[0];
      if (value.decision === 'approve') await bind(client, row, share, application.applicant_id, 'approval', userId);
      await client.query('UPDATE binding_applications SET status=$2,decided_by=$3,decided_at=now() WHERE id=$1', [application.id, value.decision === 'approve' ? 'approved' : 'rejected', userId]);
      await record(client, row.id, share.id, value.decision === 'approve' ? 'approve' : 'reject', userId, { subjectId: application.applicant_id });
    });
  });
  return lead(principal, workspaceId, requestId);
}

/** Public preview: published schemes only; no customer, phone or other request data. */
export async function sharePreview(token: string): Promise<SharePreviewView> {
  return transaction(async client => {
    const { share, row } = await liveShare(client, token);
    const workspace = (await client.query('SELECT slug,name FROM workspaces WHERE id=$1', [row.workspace_id])).rows[0];
    const request = await view(client, row, 'customer', workspace.slug);
    request.schemes = request.schemes.map(s => ({ ...s, render: s.render && { ...s.render, imageHref: s.render.status === 'completed' ? `/api/share/${token}/schemes/${s.id}/image` : null } }));
    return { workspace, request: { ...request, note: null, confirmation: null }, bound: !!row.customer_id, binding: share.target_phone ? 'phone' : 'code' };
  });
}
export async function shareImage(token: string, schemeId: string) {
  const { row, renderId } = await transaction(async client => {
    const { row } = await liveShare(client, token);
    const scheme = (await client.query('SELECT render_id FROM finish_schemes WHERE id=$1 AND request_id=$2', [idSchema.parse(schemeId), row.id])).rows[0];
    if (!scheme?.render_id) throw new DomainError('NOT_FOUND', '方案不存在。', 404);
    return { row, renderId: scheme.render_id as string };
  });
  return readRenderImage(row.project_id, renderId);
}

/**
 * Logged-in customer at the enterprise entry binds a shared request. Targeted share: the verified phone must match.
 * Code share: the one-time code must be right (limited attempts). Otherwise the customer can apply for approval.
 */
export async function bindShare(principal: Principal, slug: string, token: string, input: unknown) {
  const value = bindShareSchema.parse(input);
  return transaction(async client => {
    const { userId, entry } = await customer(client, principal, slug), { share, row } = await liveShare(client, token, true);
    if (row.workspace_id !== entry.id) throw unavailable();
    const done = await once(client, userId, value.operationId, row.id, sha(JSON.stringify({ kind: 'bind', token: sha(token), code: value.code ? sha(value.code) : null })), async () => {
      if (row.customer_id === userId) return { bound: true };
      if (row.customer_id) throw new DomainError('ALREADY_BOUND', '这个方案已绑定其他客户，你仍可以预览。', 409);
      if (share.target_phone) {
        const phone = (await client.query<{ phone_number: string | null }>('SELECT phone_number FROM hestia_auth_user WHERE id=$1', [userId])).rows[0]?.phone_number;
        if (phone !== share.target_phone) throw new DomainError('PHONE_MISMATCH', '登录手机号与企业分享时填写的不一致。可换用该手机号登录，或提交绑定申请。', 403);
        await bind(client, row, share, userId, 'phone', userId); return { bound: true };
      }
      if (!value.code) throw new DomainError('BINDING_CODE_REQUIRED', '请输入企业告知你的绑定码。', 403);
      if (share.code_used_at || !share.code_hash || !share.code_expires_at || share.code_expires_at < new Date())
        throw new DomainError('BINDING_CODE_EXPIRED', '绑定码已失效，请联系企业重新分享或提交绑定申请。', 403);
      if (share.code_attempts >= CODE_ATTEMPTS) throw new DomainError('BINDING_CODE_LOCKED', '绑定码错误次数过多，请联系企业重新分享或提交绑定申请。', 403);
      if (!same(codeHash(share.id, value.code), share.code_hash)) {
        await client.query('UPDATE request_shares SET code_attempts=code_attempts+1 WHERE id=$1', [share.id]);
        // Committed despite the error below: attempts must count.
        throw Object.assign(new DomainError('BINDING_CODE_INVALID', '绑定码不正确。', 403, { remaining: CODE_ATTEMPTS - share.code_attempts - 1 }), { commit: true });
      }
      await client.query('UPDATE request_shares SET code_used_at=now() WHERE id=$1', [share.id]);
      await bind(client, row, share, userId, 'code', userId); return { bound: true };
    }).catch(async error => { if ((error as { commit?: boolean }).commit) return error as DomainError; throw error; });
    if (done instanceof DomainError) return done;
    return view(client, await lockedRequest(client, row.id), 'customer', slug);
  }).then(result => { if (result instanceof DomainError) throw result; return result; });
}
export async function applyBinding(principal: Principal, slug: string, token: string, input: unknown) {
  const value = applyBindingSchema.parse(input);
  return transaction(async client => {
    const { userId, entry } = await customer(client, principal, slug), { share, row } = await liveShare(client, token, true);
    if (row.workspace_id !== entry.id) throw unavailable();
    if (row.customer_id === userId) throw new DomainError('ALREADY_BOUND_TO_YOU', '这个方案已绑定到你的账号。', 409);
    if (row.customer_id) throw new DomainError('ALREADY_BOUND', '这个方案已绑定其他客户，你仍可以预览。', 409);
    await once(client, userId, value.operationId, row.id, sha(JSON.stringify({ kind: 'apply', token: sha(token), note: value.note ?? null })), async () => {
      const existing = (await client.query("SELECT id FROM binding_applications WHERE request_id=$1 AND applicant_id=$2 AND status='pending'", [row.id, userId])).rows[0];
      if (existing) return { applicationId: existing.id };
      const id = randomUUID();
      await client.query('INSERT INTO binding_applications(id,share_id,request_id,applicant_id,note) VALUES($1,$2,$3,$4,$5)', [id, share.id, row.id, userId, value.note ?? null]);
      await record(client, row.id, share.id, 'apply', userId, { subjectId: userId });
      return { applicationId: id };
    });
    return { status: 'pending' as const, message: '已提交绑定申请，企业确认后即可调整和确认方案。' };
  });
}
