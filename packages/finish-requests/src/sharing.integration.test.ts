import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { pool, transaction } from '../../persistence/src/client';
import { auth, authOrigin } from '../../identity/src/auth';
import { acceptInvitation, createInvitation } from '../../identity/src/service';
import { mockSmsSender, setSmsSender } from '../../identity/src/sms';
import { createWorkspace } from '../../workspaces/src/service';
import { addWorkspaceDomain } from '../../workspaces/src/domains';
import { shareSource } from './sharing';
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
import * as previewRoute from '../../../apps/web/app/api/share/[code]/route';
import * as shareImageRoute from '../../../apps/web/app/api/share/[code]/schemes/[schemeId]/image/route';
import * as bindRoute from '../../../apps/web/app/api/client/[entry]/shares/[code]/bind/route';
import * as applyRoute from '../../../apps/web/app/api/client/[entry]/shares/[code]/apply/route';
import * as requestRoute from '../../../apps/web/app/api/client/[entry]/requests/[requestId]/route';
import * as adjustRoute from '../../../apps/web/app/api/client/[entry]/requests/[requestId]/schemes/[schemeId]/adjust/route';
import * as shareSceneRoute from '../../../apps/web/app/api/share/[code]/schemes/[schemeId]/scene/route';
import * as clientSceneRoute from '../../../apps/web/app/api/client/[entry]/requests/[requestId]/schemes/[schemeId]/scene/route';

// HTTP route handlers + real PostgreSQL. Renders run through the real runner with an injected PNG.
const run = randomUUID().slice(0, 8), slug = `d08-${run}`, password = 'synthetic-d08-password-482!', adminEmail = `d08-admin-${run}@example.test`, phones: string[] = [];
let adminCookie = '', workspaceId = '';
const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
type Handler = (request: Request, context: never) => Promise<Response>;
const sources = [0, 1, 2].map(n => `10.9.${n}${randomInt(10, 99)}.${randomInt(1, 255)}`);
async function call(handler: Handler, params: Record<string, string>, cookie?: string, json?: unknown, ip = sources[0]) {
  const response = await handler(new Request(`${authOrigin}/api/test`, { method: json === undefined ? 'GET' : 'POST',
    headers: { Origin: authOrigin, 'X-Real-IP': ip, ...(cookie ? { Cookie: cookie } : {}), ...(json === undefined ? {} : { 'Content-Type': 'application/json' }) },
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
const bind = (cookie: string, code: string) => call(bindRoute.POST, { entry: slug, code }, cookie, { operationId: randomUUID() });
const preview = (code: string, cookie?: string) => call(previewRoute.GET, { code }, cookie);
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
    const workspaces = (await pool.query('SELECT id FROM workspaces WHERE slug=ANY($1) OR personal_user_id=ANY($2)', [[slug, `${slug}-b`], users])).rows.map(row => row.id);
    await pool.query('DELETE FROM finish_requests WHERE workspace_id=ANY($1::uuid[])', [workspaces]);
    for (const table of ['project_renders', 'resources', 'project_revisions', 'operations'])
      await pool.query(`DELETE FROM ${table} WHERE project_id IN (SELECT id FROM projects WHERE workspace_id=ANY($1::uuid[]))`, [workspaces]);
    await pool.query('DELETE FROM projects WHERE workspace_id=ANY($1::uuid[])', [workspaces]);
    await pool.query('DELETE FROM workspace_stones WHERE workspace_id=ANY($1::uuid[])', [workspaces]);
    await pool.query('DELETE FROM workspaces WHERE id=ANY($1::uuid[])', [workspaces]);
    await pool.query('DELETE FROM phone_otp_challenges WHERE phone_number=ANY($1)', [phones]);
    await pool.query('DELETE FROM share_code_failures WHERE source_hash=ANY($1)', [sources.map(ip => shareSource(new Headers({ 'X-Real-IP': ip })))]);
    await pool.query('DELETE FROM hestia_invitation WHERE email=$1', [adminEmail]);
    await pool.query('DELETE FROM hestia_auth_user WHERE id=ANY($1)', [users]);
  } finally { await pool.end(); }
});

test('anyone with the share code previews published schemes and images, but nothing else', async () => {
  const request = await memberRequest(), target = await customer(), created = await share(request.id, target.phoneNumber);
  assert.match(created.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/); assert.match(created.share.targetPhone, /\*\*\*\*/);
  assert.equal(created.url, undefined); assert.equal(created.token, undefined);
  assert.ok(created.message.includes(`【分享验证企业】方案分享码 ${created.code}`), created.message);
  const view = await preview(created.code);
  assert.equal(view.status, 200); assert.equal(view.body.preview.bound, false); assert.equal(view.body.preview.binding, 'phone');
  assert.equal(view.body.preview.request.schemes.length, request.schemes.length);
  assert.ok(!JSON.stringify(view.body).includes(target.phoneNumber.slice(-4) + '"'), 'target phone is not exposed');
  // Case and separators do not matter.
  assert.equal((await preview(created.code.replace('-', ' ').toLowerCase())).status, 200);
  const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#ddd' } }).png().toBuffer();
  await runRender(request.schemes[0].render.id, { render: async () => png });
  const canonical = created.code.replace('-', '');
  const scheme = (await preview(created.code)).body.preview.request.schemes[0];
  assert.match(scheme.render.imageHref, new RegExp(`^/api/share/${canonical}/`));
  assert.equal((await call(shareImageRoute.GET, { code: canonical, schemeId: scheme.id })).status, 200);
  // Preview grants no adjustment: an unbound customer cannot read or change the request through client APIs.
  const stranger = await customer();
  assert.equal((await call(requestRoute.GET, { entry: slug, requestId: request.id }, stranger.cookie)).status, 404);
  assert.equal((await call(adjustRoute.POST, { entry: slug, requestId: request.id, schemeId: scheme.id }, stranger.cookie,
    { operationId: randomUUID(), expectedRevision: 1, finishId: 'finish-f1-stair', border: false })).status, 404);
  for (const wrong of ['ABCD-EFGH', 'not a code', 'x'.repeat(32)]) {
    const missing = await preview(wrong);
    assert.equal(missing.status, 404); assert.equal(missing.body.error.details.reason, 'unavailable');
  }
  // The 3D scene is the frozen snapshot the still was rendered from; public behind the code, closed through client APIs.
  const scene = await call(shareSceneRoute.GET, { code: canonical, schemeId: scheme.id });
  assert.equal(scene.status, 200); assert.equal(scene.body.scene.surfaceDesign.tilings.length > 0, true);
  assert.equal((await call(clientSceneRoute.GET, { entry: slug, requestId: request.id, schemeId: scheme.id }, stranger.cookie)).status, 404);
  assert.equal((await call(clientSceneRoute.GET, { entry: slug, requestId: request.id, schemeId: scheme.id })).status, 401);
  // Signed-in visitors learn only their own relation to the request; display data carries no customer details.
  assert.equal(view.body.preview.viewer, null);
  assert.deepEqual((await preview(created.code, stranger.cookie)).body.preview.viewer, { boundToMe: false, application: null });
  assert.equal(view.body.preview.request.title, '临水别墅 · 企业预置方案'); assert.equal(view.body.preview.request.origin, 'member');
  assert.deepEqual(view.body.preview.request.finishes.map((f: { id: string; levelName: string }) => `${f.id}@${f.levelName}`), ['finish-f1-living-floor@一层', 'finish-f1-stair@一层']);
});

test('targeted share binds only the matching verified phone; binding uses the code up; unbind is recorded', async () => {
  const request = await memberRequest(), target = await customer(), other = await customer(), created = await share(request.id, `+86 ${target.phoneNumber}`);
  assert.equal((await bind(other.cookie, created.code)).body.error.code, 'PHONE_MISMATCH');
  const bound = await bind(target.cookie, created.code);
  assert.equal(bound.status, 200, JSON.stringify(bound.body));
  assert.equal((await call(requestRoute.GET, { entry: slug, requestId: request.id }, target.cookie)).status, 200, 'bound customer can open the request');
  assert.equal((await preview(created.code, target.cookie)).body.preview.viewer.boundToMe, true, 'the bound customer may still open the code');
  assert.equal((await bind(target.cookie, created.code)).status, 200, 'binding again is harmless');
  // For everyone else the code is used up, and so are the request's other codes.
  assert.equal((await preview(created.code)).body.error.details.reason, 'used');
  assert.equal((await call(applyRoute.POST, { entry: slug, code: created.code }, other.cookie, { operationId: randomUUID() })).body.error.details.reason, 'used');
  assert.equal((await share(request.id)).error.code, 'ALREADY_BOUND', 'a bound request is not shared again');
  const unbound = await call(unbindRoute.POST, { workspaceId, requestId: request.id }, adminCookie, { operationId: randomUUID() });
  assert.equal(unbound.body.lead.customer, null); assert.ok(unbound.body.lead.sharing.shares[0].usedAt);
  assert.equal((await call(requestRoute.GET, { entry: slug, requestId: request.id }, target.cookie)).status, 404, 'unbinding removes access');
  assert.equal((await preview(created.code, target.cookie)).body.error.details.reason, 'used', 'a used code stays used after unbinding');
  const again = await share(request.id);
  assert.equal((await preview(again.code)).status, 200, 'a new share works after unbinding');
  assert.deepEqual((await lead(request.id)).sharing.history.map((e: { kind: string; method: string | null }) => `${e.kind}:${e.method ?? ''}`), ['share:phone', 'bind:phone', 'unbind:', 'share:code']);
  assert.equal((await call(unbindRoute.POST, { workspaceId, requestId: request.id }, target.cookie, { operationId: randomUUID() })).status, 404, 'customers cannot unbind');
});

test('open share: the first signed-in customer binds; concurrent binders get one primary customer', async () => {
  const request = await memberRequest(), created = await share(request.id), spare = await share(request.id);
  assert.equal(created.share.targetPhone, null); assert.equal((await preview(created.code)).body.preview.binding, 'open');
  const first = await customer(), second = await customer();
  const [a, b] = await Promise.all([bind(first.cookie, created.code), bind(second.cookie, created.code)]);
  assert.equal([a, b].filter(r => r.status === 200).length, 1, 'exactly one binder wins');
  assert.equal((a.status === 200 ? b : a).body.error.details.reason, 'used');
  assert.equal((await preview(spare.code)).body.error.details.reason, 'used', 'the request\'s other codes stop opening');
});

test('applications wait for a member; approval binds, rejection does not; revoked codes stop working', async () => {
  const request = await memberRequest(), created = await share(request.id, '13800000000');
  const applicant = await customer(), rejected = await customer(), late = await customer();
  assert.equal((await bind(applicant.cookie, created.code)).body.error.code, 'PHONE_MISMATCH');
  assert.equal((await call(applyRoute.POST, { entry: slug, code: created.code }, applicant.cookie, { operationId: randomUUID(), note: '我是业主' })).body.application.status, 'pending');
  await call(applyRoute.POST, { entry: slug, code: created.code }, rejected.cookie, { operationId: randomUUID() });
  let current = await lead(request.id);
  const byPhone = (phone: string) => current.sharing.applications.find((a: { applicant: { phone: string } }) => a.applicant.phone === `+86${phone}`);
  const toReject = byPhone(rejected.phoneNumber);
  current = (await call(decisionRoute.POST, { workspaceId, requestId: request.id, applicationId: toReject.id }, adminCookie, { operationId: randomUUID(), decision: 'reject' })).body.lead;
  assert.equal(current.customer, null);
  assert.equal((await preview(created.code, rejected.cookie)).body.preview.viewer.application, 'rejected');
  assert.equal((await preview(created.code, applicant.cookie)).body.preview.viewer.application, 'pending');
  const approved = await call(decisionRoute.POST, { workspaceId, requestId: request.id, applicationId: byPhone(applicant.phoneNumber).id }, adminCookie, { operationId: randomUUID(), decision: 'approve' });
  assert.equal(approved.body.lead.customer.phone, `+86${applicant.phoneNumber}`); assert.ok(approved.body.lead.sharing.shares[0].usedAt, 'approval uses the code up');
  assert.equal((await call(requestRoute.GET, { entry: slug, requestId: request.id }, applicant.cookie)).status, 200);
  assert.equal((await bind(late.cookie, created.code)).body.error.details.reason, 'used');
  // Revoking ends previews and further binding; the bound customer keeps access through their account.
  const other = await memberRequest(), second = await share(other.id);
  await call(revokeRoute.POST, { workspaceId, requestId: other.id, shareId: second.share.id }, adminCookie, { operationId: randomUUID() });
  const revoked = await preview(second.code);
  assert.equal(revoked.status, 404); assert.equal(revoked.body.error.details.reason, 'revoked');
  assert.equal((await bind(late.cookie, second.code)).body.error.details.reason, 'revoked');
  assert.deepEqual((await lead(request.id)).sharing.history.map((e: { kind: string }) => e.kind), ['share', 'apply', 'apply', 'reject', 'bind', 'approve']);
});

test('wrong share codes are limited per source; known codes do not count', async () => {
  process.env.HESTIA_SHARE_CODE_MAX_FAILURES = '3';
  try {
    const request = await memberRequest(), created = await share(request.id), ip = sources[1];
    const revokedRequest = await memberRequest(), revoked = await share(revokedRequest.id);
    await call(revokeRoute.POST, { workspaceId, requestId: revokedRequest.id, shareId: revoked.share.id }, adminCookie, { operationId: randomUUID() });
    for (let i = 0; i < 5; i++) assert.equal((await call(previewRoute.GET, { code: revoked.code }, undefined, undefined, ip)).status, 404, 'a revoked code is known');
    assert.equal((await call(previewRoute.GET, { code: created.code }, undefined, undefined, ip)).status, 200);
    for (let i = 0; i < 3; i++) assert.equal((await call(previewRoute.GET, { code: 'ABCD-EFGH' }, undefined, undefined, ip)).status, 404);
    const limited = await call(previewRoute.GET, { code: created.code }, undefined, undefined, ip);
    assert.equal(limited.status, 429); assert.equal(limited.body.error.code, 'SHARE_CODE_RATE_LIMITED');
    assert.equal((await call(previewRoute.GET, { code: created.code }, undefined, undefined, sources[2])).status, 200, 'other sources are not affected');
  } finally { delete process.env.HESTIA_SHARE_CODE_MAX_FAILURES; }
});

test('on a registered entry domain a share code of another enterprise reads as unavailable (ADR-0017)', async () => {
  const request = await memberRequest(), created = await share(request.id), other = `${slug}-b`;
  await createWorkspace({ kind: 'enterprise', slug: other, name: '另一家企业', adminEmail });
  await addWorkspaceDomain(slug, `${slug}.example.test`); await addWorkspaceDomain(other, `${other}.example.test`);
  const at = (host: string) => previewRoute.GET(new Request(`http://${host}/api/share/x`, { headers: { Host: host, 'X-Real-IP': sources[1] } }),
    { params: Promise.resolve({ code: created.code }) } as never);
  assert.equal((await at(`${slug}.example.test`)).status, 200);
  const elsewhere = await at(`${other}.example.test`);
  assert.equal(elsewhere.status, 404); assert.equal((await elsewhere.json()).error.code, 'SHARE_UNAVAILABLE');
  // An unregistered host is not scoped, as on a single-enterprise deployment.
  assert.equal((await at('unregistered.example.test')).status, 200);
});
