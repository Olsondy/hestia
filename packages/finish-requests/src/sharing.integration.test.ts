import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { pool, transaction } from '../../persistence/src/client';
import { auth, authOrigin } from '../../identity/src/auth';
import { acceptInvitation, createInvitation } from '../../identity/src/service';
import { mockSmsSender, setSmsSender } from '../../identity/src/sms';
import { createWorkspace } from '../../workspaces/src/service';
import { addStones } from '../../finishes/src/catalog';
import { demoStones } from '../../finishes/src/demo-stones';
import { initializeRenderQueue } from '../../renders/src/queue';
import { runRender } from '../../renders/src/runner';
import * as authRoute from '../../../apps/web/app/api/auth/[...all]/route';
import * as leadsRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/leads/route';
import * as sharesRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/leads/[requestId]/shares/route';
import * as revokeRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/leads/[requestId]/shares/[shareId]/revoke/route';
import * as unbindRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/leads/[requestId]/unbind/route';
import * as decisionRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/leads/[requestId]/applications/[applicationId]/decision/route';
import * as previewRoute from '../../../apps/web/app/api/share/[token]/route';
import * as shareImageRoute from '../../../apps/web/app/api/share/[token]/schemes/[schemeId]/image/route';
import * as bindRoute from '../../../apps/web/app/api/client/[entry]/shares/[token]/bind/route';
import * as applyRoute from '../../../apps/web/app/api/client/[entry]/shares/[token]/apply/route';
import * as requestRoute from '../../../apps/web/app/api/client/[entry]/requests/[requestId]/route';
import * as adjustRoute from '../../../apps/web/app/api/client/[entry]/requests/[requestId]/schemes/[schemeId]/adjust/route';

// HTTP route handlers + real PostgreSQL. Renders run through the real runner with an injected PNG.
const run = randomUUID().slice(0, 8), slug = `d08-${run}`, password = 'synthetic-d08-password-482!', adminEmail = `d08-admin-${run}@example.test`, phones: string[] = [];
let adminCookie = '', workspaceId = '';
const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
type Handler = (request: Request, context: never) => Promise<Response>;
async function call(handler: Handler, params: Record<string, string>, cookie?: string, json?: unknown) {
  const response = await handler(new Request(`${authOrigin}/api/test`, { method: json === undefined ? 'GET' : 'POST',
    headers: { Origin: authOrigin, ...(cookie ? { Cookie: cookie } : {}), ...(json === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: json === undefined ? undefined : JSON.stringify(json) }), { params: Promise.resolve(params) } as never);
  return { status: response.status, response, body: response.headers.get('content-type')?.includes('json') ? await response.json() : null };
}
async function customer() {
  const phoneNumber = `199${String(randomInt(0, 1e8)).padStart(8, '0')}`; phones.push(`+86${phoneNumber}`);
  const post = (path: string, payload: unknown) => authRoute.POST(new Request(`${authOrigin}/api/auth/${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: authOrigin, 'X-Real-IP': `10.8.${randomInt(0, 255)}.${randomInt(1, 255)}` }, body: JSON.stringify(payload) }));
  const code = (await (await post('phone/send-code', { phoneNumber, entry: slug })).json()).demoCode;
  return { cookie: cookieOf(await post('phone/sign-in', { phoneNumber, entry: slug, code })), phoneNumber };
}
async function memberRequest() {
  const created = await call(leadsRoute.POST, { workspaceId }, adminCookie, { operationId: randomUUID(), name: '临水别墅 · 企业预置方案',
    finishIds: ['finish-f1-living-floor', 'finish-f1-stair'], stones: [{ stoneId: 'demo-white-marble', stoneVersion: 1 }, { stoneId: 'demo-beige-marble', stoneVersion: 1 }] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.lead.status, 'published'); assert.equal(created.body.lead.customer, null); assert.equal(created.body.lead.origin, 'member');
  return created.body.lead;
}
const share = async (requestId: string, phone?: string) => (await call(sharesRoute.POST, { workspaceId, requestId }, adminCookie, { operationId: randomUUID(), ...(phone ? { phone } : {}) })).body;
const bind = (cookie: string, token: string, code?: string) => call(bindRoute.POST, { entry: slug, token }, cookie, { operationId: randomUUID(), ...(code ? { code } : {}) });
const lead = async (requestId: string) => (await call(leadsRoute.GET, { workspaceId }, adminCookie)).body.leads.find((l: { id: string }) => l.id === requestId);

before(async () => {
  process.env.HESTIA_OTP_SOURCE_HEADER = 'x-real-ip';
  setSmsSender(mockSmsSender);
  await initializeRenderQueue();
  const invitation = await createInvitation(adminEmail);
  await acceptInvitation(invitation.token, '合成石材企业管理员', password);
  adminCookie = cookieOf(await auth.api.signInEmail({ body: { email: adminEmail, password }, asResponse: true }));
  workspaceId = (await createWorkspace({ kind: 'enterprise', slug, name: '分享验证企业', adminEmail })).workspace.id;
  await transaction(client => addStones(client, workspaceId, demoStones));
});
after(async () => {
  try {
    const users = (await pool.query('SELECT id FROM hestia_auth_user WHERE phone_number=ANY($1) OR email=$2', [phones, adminEmail])).rows.map(row => row.id);
    const workspaces = (await pool.query('SELECT id FROM workspaces WHERE slug=$1 OR personal_user_id=ANY($2)', [slug, users])).rows.map(row => row.id);
    await pool.query('DELETE FROM finish_requests WHERE workspace_id=ANY($1::uuid[])', [workspaces]);
    for (const table of ['project_renders', 'resources', 'project_revisions', 'operations'])
      await pool.query(`DELETE FROM ${table} WHERE project_id IN (SELECT id FROM projects WHERE workspace_id=ANY($1::uuid[]))`, [workspaces]);
    await pool.query('DELETE FROM projects WHERE workspace_id=ANY($1::uuid[])', [workspaces]);
    await pool.query('DELETE FROM workspace_stones WHERE workspace_id=ANY($1::uuid[])', [workspaces]);
    await pool.query('DELETE FROM workspaces WHERE id=ANY($1::uuid[])', [workspaces]);
    await pool.query('DELETE FROM phone_otp_challenges WHERE phone_number=ANY($1)', [phones]);
    await pool.query('DELETE FROM hestia_invitation WHERE email=$1', [adminEmail]);
    await pool.query('DELETE FROM hestia_auth_user WHERE id=ANY($1)', [users]);
  } finally { await pool.end(); }
});

test('anyone with the link previews published schemes and images, but nothing else', async () => {
  const request = await memberRequest(), target = await customer(), created = await share(request.id, target.phoneNumber);
  assert.match(created.url, /^\/s\//); assert.equal(created.bindingCode, null); assert.match(created.share.targetPhone, /\*\*\*\*/);
  const preview = await call(previewRoute.GET, { token: created.token });
  assert.equal(preview.status, 200); assert.equal(preview.body.preview.bound, false); assert.equal(preview.body.preview.binding, 'phone');
  assert.equal(preview.body.preview.request.schemes.length, request.schemes.length);
  assert.ok(!JSON.stringify(preview.body).includes(target.phoneNumber.slice(-4) + '"'), 'target phone is not exposed');
  const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#ddd' } }).png().toBuffer();
  await runRender(request.schemes[0].render.id, { render: async () => png });
  const scheme = (await call(previewRoute.GET, { token: created.token })).body.preview.request.schemes[0];
  assert.match(scheme.render.imageHref, new RegExp(`^/api/share/${created.token}/`));
  assert.equal((await call(shareImageRoute.GET, { token: created.token, schemeId: scheme.id })).status, 200);
  // Preview grants no adjustment: an anonymous or unbound customer cannot read or change the request through client APIs.
  const stranger = await customer();
  assert.equal((await call(requestRoute.GET, { entry: slug, requestId: request.id }, stranger.cookie)).status, 404);
  assert.equal((await call(adjustRoute.POST, { entry: slug, requestId: request.id, schemeId: scheme.id }, stranger.cookie,
    { operationId: randomUUID(), expectedRevision: 1, finishId: 'finish-f1-stair', border: false })).status, 404);
  assert.equal((await call(previewRoute.GET, { token: 'x'.repeat(32) })).status, 404);
});

test('targeted share binds only the matching verified phone; one primary customer; unbind is recorded', async () => {
  const request = await memberRequest(), target = await customer(), other = await customer(), created = await share(request.id, `+86 ${target.phoneNumber}`);
  const mismatch = await bind(other.cookie, created.token);
  assert.equal(mismatch.body.error.code, 'PHONE_MISMATCH');
  const bound = await bind(target.cookie, created.token);
  assert.equal(bound.status, 200, JSON.stringify(bound.body));
  assert.equal((await call(requestRoute.GET, { entry: slug, requestId: request.id }, target.cookie)).status, 200, 'bound customer can open the request');
  assert.equal((await bind(target.cookie, created.token)).status, 200, 'binding again is harmless');
  assert.equal((await call(previewRoute.GET, { token: created.token })).body.preview.bound, true);
  assert.equal((await call(applyRoute.POST, { entry: slug, token: created.token }, other.cookie, { operationId: randomUUID() })).body.error.code, 'ALREADY_BOUND');
  const unbound = await call(unbindRoute.POST, { workspaceId, requestId: request.id }, adminCookie, { operationId: randomUUID() });
  assert.equal(unbound.body.lead.customer, null);
  assert.equal((await call(requestRoute.GET, { entry: slug, requestId: request.id }, target.cookie)).status, 404, 'unbinding removes access');
  assert.deepEqual(unbound.body.lead.sharing.history.map((e: { kind: string; method: string | null }) => `${e.kind}:${e.method ?? ''}`), ['share:phone', 'bind:phone', 'unbind:']);
  assert.equal((await call(unbindRoute.POST, { workspaceId, requestId: request.id }, target.cookie, { operationId: randomUUID() })).status, 404, 'customers cannot unbind');
});

test('code share: one-time code with limited attempts; concurrent binders get one primary customer', async () => {
  const request = await memberRequest(), created = await share(request.id);
  assert.match(created.bindingCode, /^[A-Z2-9]{6}$/); assert.equal(created.share.bindingCode, true);
  const first = await customer(), second = await customer();
  assert.equal((await bind(first.cookie, created.token)).body.error.code, 'BINDING_CODE_REQUIRED');
  const wrong = await bind(first.cookie, created.token, 'WRONG1');
  assert.equal(wrong.body.error.code, 'BINDING_CODE_INVALID'); assert.equal(wrong.body.error.details.remaining, 4);
  const [a, b] = await Promise.all([bind(first.cookie, created.token, created.bindingCode), bind(second.cookie, created.token, created.bindingCode)]);
  assert.equal([a, b].filter(r => r.status === 200).length, 1, 'exactly one binder wins');
  assert.ok(['BINDING_CODE_EXPIRED', 'ALREADY_BOUND'].includes((a.status === 200 ? b : a).body.error.code));
  // Locking after repeated wrong codes on a fresh share.
  const locked = await share((await memberRequest()).id), guesser = await customer();
  for (let i = 0; i < 5; i++) await bind(guesser.cookie, locked.token, 'WRONG1');
  assert.equal((await bind(guesser.cookie, locked.token, locked.bindingCode)).body.error.code, 'BINDING_CODE_LOCKED');
});

test('applications wait for a member; approval binds, rejection does not; revoked links stop working', async () => {
  const request = await memberRequest(), target = await customer(), created = await share(request.id, '13800000000');
  const applicant = await customer(), rejected = await customer();
  assert.equal((await bind(applicant.cookie, created.token)).body.error.code, 'PHONE_MISMATCH');
  assert.equal((await call(applyRoute.POST, { entry: slug, token: created.token }, applicant.cookie, { operationId: randomUUID(), note: '我是业主' })).body.application.status, 'pending');
  await call(applyRoute.POST, { entry: slug, token: created.token }, rejected.cookie, { operationId: randomUUID() });
  let current = await lead(request.id);
  const byPhone = (phone: string) => current.sharing.applications.find((a: { applicant: { phone: string } }) => a.applicant.phone === `+86${phone}`);
  const toReject = byPhone(rejected.phoneNumber);
  current = (await call(decisionRoute.POST, { workspaceId, requestId: request.id, applicationId: toReject.id }, adminCookie, { operationId: randomUUID(), decision: 'reject' })).body.lead;
  assert.equal(current.customer, null);
  const approved = await call(decisionRoute.POST, { workspaceId, requestId: request.id, applicationId: byPhone(applicant.phoneNumber).id }, adminCookie, { operationId: randomUUID(), decision: 'approve' });
  assert.equal(approved.body.lead.customer.phone, `+86${applicant.phoneNumber}`);
  assert.equal((await call(requestRoute.GET, { entry: slug, requestId: request.id }, applicant.cookie)).status, 200);
  // Revoking the link ends previews and further binding; the bound customer keeps access through their account.
  await call(revokeRoute.POST, { workspaceId, requestId: request.id, shareId: created.share.id }, adminCookie, { operationId: randomUUID() });
  assert.equal((await call(previewRoute.GET, { token: created.token })).status, 404);
  assert.equal((await bind(target.cookie, created.token)).status, 404);
  assert.equal((await call(requestRoute.GET, { entry: slug, requestId: request.id }, applicant.cookie)).status, 200);
  const history = (await lead(request.id)).sharing.history.map((e: { kind: string }) => e.kind);
  assert.deepEqual(history, ['share', 'apply', 'apply', 'reject', 'bind', 'approve', 'revoke']);
});
