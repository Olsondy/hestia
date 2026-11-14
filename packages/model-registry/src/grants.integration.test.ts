import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { pool } from '../../persistence/src/client';
import { auth } from '../../identity/src/auth';
import { acceptInvitation, createInvitation } from '../../identity/src/service';
import { createWorkspace, setMember } from '../../workspaces/src/service';
import { addWorkspaceDomain } from '../../workspaces/src/domains';
import { grantPlatformAdmin } from '../../platform-admin/src/service';
import { createService, enableModel, updateModel } from './service';
import { reserveCall, settleCall, updateEnterprise } from './grants';
import * as adminWorkspaces from '../../../apps/web/app/api/admin/workspaces/route';
import * as adminWorkspace from '../../../apps/web/app/api/admin/workspaces/[slug]/route';
import * as modelsRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/models/route';
import * as modelRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/models/[modelId]/route';

// AM03 (ADR-0018): grants, monthly quota and concurrency per enterprise; enterprise enable/default; per-call
// reservation and settlement. HTTP route handlers + real PostgreSQL. No model is called.
const run = randomUUID().slice(0, 8), admin = `admin.am03-${run}.example.test`, slugA = `am03a-${run}`, slugB = `am03b-${run}`;
const hostA = `${slugA}.am03-${run}.example.test`, hostB = `${slugB}.am03-${run}.example.test`, password = 'synthetic-am03-password-905!';
const emails = { ops: `am03-ops-${run}@example.test`, adminA: `am03-a-${run}@example.test`, memberA: `am03-m-${run}@example.test`, adminB: `am03-b-${run}@example.test` };
const cookies = {} as Record<keyof typeof emails, string>, saved: Record<string, string | undefined> = {}, actor = { userId: null as unknown as string, email: `am03-actor-${run}@example.test` };
let idA = '', idB = '', serviceId = '', m1 = '', m2 = '', m3 = '';
type Handler = (request: Request, context: never) => Promise<Response>;
async function call(handler: Handler, host: string, cookie: string, params: Record<string, string>, json?: unknown, method = json === undefined ? 'GET' : 'PATCH') {
  const headers: Record<string, string> = { Host: host, Cookie: cookie };
  if (json !== undefined) Object.assign(headers, { 'Content-Type': 'application/json', Origin: `http://${host}` });
  const response = await handler(new Request(`http://${host}/api/x`, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) }), { params: Promise.resolve(params) } as never);
  return { status: response.status, body: await response.json() };
}

before(async () => {
  for (const key of ['HESTIA_ADMIN_HOST', 'HESTIA_SECRET_KEY']) saved[key] = process.env[key];
  process.env.HESTIA_ADMIN_HOST = admin; process.env.HESTIA_SECRET_KEY ||= randomBytes(32).toString('base64');
  for (const key of Object.keys(emails) as (keyof typeof emails)[]) {
    const invitation = await createInvitation(emails[key]);
    await acceptInvitation(invitation.token, `合成${key}`, password);
    cookies[key] = (await auth.api.signInEmail({ body: { email: emails[key], password }, asResponse: true })).headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  }
  await grantPlatformAdmin(emails.ops, 'platform');
  idA = (await createWorkspace({ kind: 'enterprise', slug: slugA, name: `分配企业甲-${run}`, adminEmail: emails.adminA })).workspace.id;
  idB = (await createWorkspace({ kind: 'enterprise', slug: slugB, name: `分配企业乙-${run}`, adminEmail: emails.adminB })).workspace.id;
  const userA = (await pool.query('SELECT id FROM hestia_auth_user WHERE email=$1', [emails.adminA])).rows[0].id;
  await setMember({ userId: userA, workspaceId: idA }, idA, { email: emails.memberA, role: 'member' });
  await addWorkspaceDomain(slugA, hostA); await addWorkspaceDomain(slugB, hostB);
  serviceId = (await createService(actor, { name: `分配服务-${run}`, protocol: 'chat', baseUrl: 'https://api.vendor.example.test/v1', apiKey: 'sk-am03-synthetic', timeoutSeconds: 60, concurrency: 3 })).id;
  for (const [index, modelId] of ['design-large', 'edit-fast', 'draft-only'].entries()) {
    const model = await enableModel(actor, serviceId, { modelId: `${modelId}-${run}`, manual: true });
    if (index < 2) { await updateModel(actor, model.id, { maxOutput: 4000, price: { input: 400, output: 1600 } }); await pool.query("UPDATE models SET state='admitted' WHERE id=$1", [model.id]); }
    if (index === 0) m1 = model.id; else if (index === 1) m2 = model.id; else m3 = model.id;
  }
});
after(async () => {
  for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  try {
    await pool.query('DELETE FROM workspaces WHERE slug=ANY($1)', [[slugA, slugB]]);
    await pool.query('DELETE FROM models WHERE service_id=$1', [serviceId]); await pool.query('DELETE FROM model_services WHERE id=$1', [serviceId]);
    const users = (await pool.query('SELECT id FROM hestia_auth_user WHERE email=ANY($1)', [Object.values(emails)])).rows.map(row => row.id);
    await pool.query('DELETE FROM platform_audit WHERE actor=ANY($1) OR target=ANY($1) OR target LIKE $2', [[...Object.values(emails), actor.email], `%${run}%`]);
    await pool.query('DELETE FROM workspaces WHERE personal_user_id=ANY($1)', [users]);
    await pool.query('DELETE FROM hestia_invitation WHERE email=ANY($1)', [Object.values(emails)]);
    await pool.query('DELETE FROM hestia_auth_user WHERE id=ANY($1)', [users]);
  } finally { await pool.end(); }
});

test('the platform admin grants admitted, priced models with a quota and a concurrency cap', async () => {
  assert.equal((await call(adminWorkspace.PATCH, admin, cookies.adminA, { slug: slugA }, { grants: [m1] })).status, 403, 'an enterprise admin is not a platform admin');
  const refused = await call(adminWorkspace.PATCH, admin, cookies.ops, { slug: slugA }, { grants: [m1, m3] });
  assert.equal(refused.body.error.code, 'NOT_GRANTABLE');
  const saved = await call(adminWorkspace.PATCH, admin, cookies.ops, { slug: slugA }, { grants: [m1, m2], quota: 100_000, concurrency: 2 });
  assert.equal(saved.status, 200);
  assert.deepEqual([saved.body.enterprise.quota, saved.body.enterprise.concurrency, saved.body.enterprise.grants.map((g: { id: string }) => g.id)], [100_000, 2, [m1, m2]]);
  assert.deepEqual(saved.body.enterprise.domains, [hostA]);
  const list = (await call(adminWorkspaces.GET, admin, cookies.ops, {})).body.enterprises.filter((e: { slug: string }) => [slugA, slugB].includes(e.slug));
  assert.deepEqual(list.map((e: { slug: string; quota: number; grants: unknown[] }) => [e.slug, e.quota, e.grants.length]), [[slugA, 100_000, 2], [slugB, 0, 0]]);
  const audit = (await pool.query("SELECT action, detail FROM platform_audit WHERE target=$1 ORDER BY at", [`分配企业甲-${run}`])).rows;
  assert.deepEqual(audit.map(r => r.action), ['set_quota', 'grant_models'], 'concurrency 2 is the default: nothing changed, nothing audited');
  assert.deepEqual(audit[0].detail, { from: '0.00', to: '1000.00' });
});

test('the enterprise admin enables granted models and picks a default; members only see usable ones', async () => {
  assert.deepEqual((await call(modelsRoute.GET, hostA, cookies.memberA, { workspaceId: idA })).body.models, [], 'granted but not enabled');
  assert.equal((await call(modelRoute.PATCH, hostA, cookies.memberA, { workspaceId: idA, modelId: m1 }, { enabled: true })).status, 403);
  await call(modelRoute.PATCH, hostA, cookies.adminA, { workspaceId: idA, modelId: m2 }, { enabled: true });
  const set = await call(modelRoute.PATCH, hostA, cookies.adminA, { workspaceId: idA, modelId: m1 }, { isDefault: true });
  assert.equal(set.body.defaultModel, m1);
  assert.equal((await call(modelRoute.PATCH, hostA, cookies.adminA, { workspaceId: idA, modelId: m1 }, { enabled: false })).body.error.code, 'DEFAULT_MODEL');
  assert.equal((await call(modelRoute.PATCH, hostA, cookies.adminA, { workspaceId: idA, modelId: m3 }, { enabled: true })).status, 404, 'not granted');
  const member = (await call(modelsRoute.GET, hostA, cookies.memberA, { workspaceId: idA })).body;
  assert.deepEqual([member.models.map((m: { id: string }) => m.id), member.defaultModel, member.quota.concurrency], [[m1, m2], m1, undefined]);
  assert.equal('availability' in member.models[0], false);
  assert.equal((await call(modelsRoute.GET, hostB, cookies.adminB, { workspaceId: idA })).status, 404, 'another enterprise');

  await pool.query("UPDATE models SET state='disabled' WHERE id=$1", [m2]);
  const adminView = (await call(modelsRoute.GET, hostA, cookies.adminA, { workspaceId: idA })).body;
  assert.equal(adminView.models.find((m: { id: string }) => m.id === m2).availability, 'platform_disabled');
  assert.deepEqual((await call(modelsRoute.GET, hostA, cookies.memberA, { workspaceId: idA })).body.models.map((m: { id: string }) => m.id), [m1]);
  await assert.rejects(reserveCall({ workspaceId: idA, modelId: m2, inputTokens: 10 }), { code: 'MODEL_UNAVAILABLE' });
  await pool.query("UPDATE models SET state='admitted' WHERE id=$1", [m2]);
});

test('a call reserves input estimate + max output at the current price and settles on actual usage, or as unverified', async () => {
  // 10 000 input × 4.00 + 4 000 output × 16.00 元 / 百万 token = 0.104 元 → 11 分 (rounded up).
  const first = await reserveCall({ workspaceId: idA, modelId: m1, inputTokens: 10_000, taskId: randomUUID() });
  assert.deepEqual([first.reservedFen, first.maxOutput], [11, 4000]);
  assert.deepEqual(await settleCall(first.callId, { inputTokens: 9_000, outputTokens: 1_000, outcome: 'ok' }), { costFen: 6, unverified: false });
  assert.deepEqual(await settleCall(first.callId, { inputTokens: 1, outputTokens: 1, outcome: 'ok' }), { costFen: 6, unverified: false }, 'idempotent');
  const unknown = await reserveCall({ workspaceId: idA, modelId: m1, inputTokens: 10_000 });
  assert.deepEqual(await settleCall(unknown.callId, { inputTokens: 9_000, outputTokens: null, outcome: 'ok' }), { costFen: 11, unverified: true });
  await assert.rejects(reserveCall({ workspaceId: idB, modelId: m1, inputTokens: 10 }), { code: 'MODEL_NOT_GRANTED' });
  const quota = (await call(modelsRoute.GET, hostA, cookies.adminA, { workspaceId: idA })).body.quota;
  assert.deepEqual([quota.used, quota.reserved, quota.exhausted], [17, 0, false]);
});

test('parallel reservations never exceed the quota; the concurrency caps queue new tasks; no limit means no limit', async () => {
  // 17 分 used; a 40 分 quota leaves room for two 11 分 reservations, not three.
  await updateEnterprise(actor, slugA, { quota: 40, concurrency: 10 });
  const attempts = await Promise.allSettled(Array.from({ length: 6 }, () => reserveCall({ workspaceId: idA, modelId: m1, inputTokens: 10_000, taskId: randomUUID() })));
  const ok = attempts.filter(a => a.status === 'fulfilled') as PromiseFulfilledResult<{ callId: string }>[];
  assert.equal(ok.length, 2);
  assert.ok(attempts.filter(a => a.status === 'rejected').every(a => (a as PromiseRejectedResult).reason.code === 'QUOTA_EXCEEDED'));
  for (const a of ok) await settleCall(a.value.callId, { inputTokens: 10_000, outputTokens: 4_000, outcome: 'ok' });

  await updateEnterprise(actor, slugA, { quota: null, concurrency: 2 });
  const [taskX, taskY] = [randomUUID(), randomUUID()];
  const open = [await reserveCall({ workspaceId: idA, modelId: m1, inputTokens: 1_000_000, taskId: taskX }), await reserveCall({ workspaceId: idA, modelId: m2, inputTokens: 10, taskId: taskY })];
  await assert.rejects(reserveCall({ workspaceId: idA, modelId: m1, inputTokens: 10, taskId: randomUUID() }), { code: 'ENTERPRISE_BUSY' });
  open.push(await reserveCall({ workspaceId: idA, modelId: m1, inputTokens: 10, taskId: taskX }));

  // The service's total concurrency (3) is shared across enterprises.
  await updateEnterprise(actor, slugB, { grants: [m1], quota: null, concurrency: 5 });
  await pool.query('UPDATE workspace_models SET enabled=true WHERE workspace_id=$1', [idB]);
  await assert.rejects(reserveCall({ workspaceId: idB, modelId: m1, inputTokens: 10 }), { code: 'SERVICE_BUSY' });
  await settleCall(open[0].callId, { inputTokens: 10, outputTokens: 10, outcome: 'ok' });
  const b = await reserveCall({ workspaceId: idB, modelId: m1, inputTokens: 10 });
  for (const c of [open[1], open[2], b]) await settleCall(c.callId, { inputTokens: 10, outputTokens: 10, outcome: 'ok' });

  await updateEnterprise(actor, slugB, { quota: 0 });
  await assert.rejects(reserveCall({ workspaceId: idB, modelId: m1, inputTokens: 10 }), { code: 'QUOTA_EXCEEDED', message: '本企业还没有设置本月额度。' });
});
