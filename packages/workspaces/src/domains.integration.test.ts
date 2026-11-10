import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { pool } from '../../persistence/src/client';
import { auth } from '../../identity/src/auth';
import { acceptInvitation, createInvitation } from '../../identity/src/service';
import { mockSmsSender, setSmsSender } from '../../identity/src/sms';
import { createWorkspace } from './service';
import { addWorkspaceDomain, enterpriseForHost, listWorkspaceDomains, normalizeHost, removeWorkspaceDomain, requestHost } from './domains';
import * as authRoute from '../../../apps/web/app/api/auth/[...all]/route';
import * as catalogRoute from '../../../apps/web/app/api/client/[entry]/catalog/route';
import * as workspaceRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/route';
import * as bySlugRoute from '../../../apps/web/app/api/workspaces/by-slug/[slug]/route';

// M01 (ADR-0017): a registered entry domain decides the request's enterprise. HTTP route handlers + real PostgreSQL.
const run = randomUUID().slice(0, 8), slugA = `m01a-${run}`, slugB = `m01b-${run}`, hostA = `${slugA}.example.test`, hostB = `${slugB}.example.test`;
const adminEmail = `m01-admin-${run}@example.test`, password = 'synthetic-m01-password-482!', phones: string[] = [];
const loose = `m01-loose-${run}.example.test`;
let adminCookie = '', idA = '', idB = '';
type Handler = (request: Request, context: never) => Promise<Response>;
const ip = () => `10.7.${randomInt(0, 255)}.${randomInt(1, 255)}`;
async function call(handler: Handler, host: string, params: Record<string, string>, init: { cookie?: string; origin?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = { Host: host, 'X-Real-IP': ip() };
  if (init.cookie) headers.Cookie = init.cookie;
  if (init.origin) headers.Origin = init.origin;
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  const response = await handler(new Request(`http://${host}/api/test`, { method: init.json === undefined ? 'GET' : 'POST', headers,
    body: init.json === undefined ? undefined : JSON.stringify(init.json) }), { params: Promise.resolve(params) } as never);
  return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? await response.json() : null };
}
const sendCode = (host: string, entry: string, origin = `http://${host}`) => {
  const phoneNumber = `199${String(randomInt(0, 1e8)).padStart(8, '0')}`; phones.push(`+86${phoneNumber}`);
  return authRoute.POST(new Request(`http://${host}/api/auth/phone/send-code`, { method: 'POST', body: JSON.stringify({ phoneNumber, entry }),
    headers: { Host: host, Origin: origin, 'Content-Type': 'application/json', 'X-Real-IP': ip() } }))
    .then(async response => ({ status: response.status, body: await response.json() }));
};

before(async () => {
  process.env.HESTIA_OTP_SOURCE_HEADER = 'x-real-ip';
  setSmsSender(mockSmsSender);
  const invitation = await createInvitation(adminEmail);
  await acceptInvitation(invitation.token, '合成域名管理员', password);
  adminCookie = (await auth.api.signInEmail({ body: { email: adminEmail, password }, asResponse: true })).headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  idA = (await createWorkspace({ kind: 'enterprise', slug: slugA, name: '域名企业甲', adminEmail })).workspace.id;
  idB = (await createWorkspace({ kind: 'enterprise', slug: slugB, name: '域名企业乙', adminEmail })).workspace.id;
  await addWorkspaceDomain(slugA, hostA); await addWorkspaceDomain(slugB, hostB);
});
after(async () => {
  try {
    const users = (await pool.query('SELECT id FROM hestia_auth_user WHERE phone_number=ANY($1) OR email=$2', [phones, adminEmail])).rows.map(row => row.id);
    await pool.query('DELETE FROM workspaces WHERE slug=ANY($1) OR personal_user_id=ANY($2)', [[slugA, slugB], users]);
    await pool.query('DELETE FROM phone_otp_challenges WHERE phone_number=ANY($1)', [phones]);
    await pool.query('DELETE FROM hestia_invitation WHERE email=$1', [adminEmail]);
    await pool.query('DELETE FROM hestia_auth_user WHERE id=ANY($1)', [users]);
  } finally { await pool.end(); }
});

test('hosts are normalized and registered idempotently; a host belongs to one workspace', async () => {
  assert.equal(normalizeHost('A.Example.TEST:443'), 'a.example.test');
  assert.equal(normalizeHost('a.example.test.'), 'a.example.test');
  for (const bad of ['127.0.0.1', '[::1]:3000', 'localhost', '', null, 'a_b.example.test']) assert.equal(normalizeHost(bad), null, String(bad));
  assert.equal(requestHost(new Headers({ Host: 'A.example.test:3000' })), 'a.example.test');
  process.env.HESTIA_HOST_HEADER = 'x-forwarded-host';
  try { assert.equal(requestHost(new Headers({ Host: 'internal', 'X-Forwarded-Host': 'forged.example.test, b.example.test' })), 'b.example.test'); }
  finally { delete process.env.HESTIA_HOST_HEADER; }

  assert.deepEqual(await addWorkspaceDomain(slugA, hostA), { host: hostA, added: false });
  await assert.rejects(addWorkspaceDomain(slugB, hostA), { code: 'HOST_TAKEN' });
  for (const bad of ['https://x.example.test', 'x.example.test:3000', 'x.example.test/c', '1.2.3.4'])
    await assert.rejects(addWorkspaceDomain(slugA, bad), { code: 'INVALID_HOST' }, bad);
  await assert.rejects(addWorkspaceDomain('m01-missing', `x-${run}.example.test`), { code: 'NOT_FOUND' });
  assert.equal(await enterpriseForHost(hostA), slugA); assert.equal(await enterpriseForHost(hostB), slugB);
  assert.equal(await enterpriseForHost(loose), null);

  const extra = `www.${hostA}`;
  assert.equal((await addWorkspaceDomain(slugA, extra.toUpperCase())).added, true);
  assert.deepEqual(await listWorkspaceDomains(slugA), [hostA, extra].sort());
  assert.deepEqual(await removeWorkspaceDomain(slugA, extra), { host: extra, removed: true });
  assert.deepEqual(await removeWorkspaceDomain(slugA, extra), { host: extra, removed: false });
});

test('client APIs on a registered domain serve only that enterprise; an unregistered host is not scoped', async () => {
  assert.equal((await call(catalogRoute.GET, hostA, { entry: slugA })).body.catalog.workspace.name, '域名企业甲');
  const other = await call(catalogRoute.GET, hostA, { entry: slugB });
  assert.equal(other.status, 404); assert.equal(other.body.error.code, 'ENTRY_NOT_FOUND');
  // Same answer as an enterprise that does not exist: the domain does not reveal whether another enterprise is hosted.
  assert.deepEqual((await call(catalogRoute.GET, hostA, { entry: 'm01-missing' })).body, other.body);
  assert.equal((await call(catalogRoute.GET, loose, { entry: slugB })).status, 200);
});

test('phone sign-in follows the domain; registered domains are trusted origins only for their own host', async () => {
  assert.equal((await sendCode(hostA, slugA)).status, 200);
  const wrongEntry = await sendCode(hostA, slugB);
  assert.equal(wrongEntry.status, 404); assert.equal(wrongEntry.body.error.code, 'ENTRY_NOT_FOUND');
  // Origin of another registered domain, or of an unregistered host, is rejected before any work.
  assert.equal((await sendCode(hostA, slugA, `http://${hostB}`)).body.error.code, 'ORIGIN_REJECTED');
  assert.equal((await sendCode(loose, slugA)).body.error.code, 'ORIGIN_REJECTED');
  assert.equal((await sendCode(hostA, slugA, `https://${hostA}`)).body.error.code, 'ORIGIN_REJECTED', 'scheme must match BETTER_AUTH_URL');
});

test('workbench APIs on a registered domain reach only that enterprise', async () => {
  assert.equal((await call(workspaceRoute.GET, hostA, { workspaceId: idA }, { cookie: adminCookie })).status, 200);
  assert.equal((await call(workspaceRoute.GET, hostA, { workspaceId: idB }, { cookie: adminCookie })).status, 404);
  assert.equal((await call(workspaceRoute.GET, hostA, { workspaceId: 'not-a-uuid' }, { cookie: adminCookie })).status, 404);
  assert.equal((await call(bySlugRoute.GET, hostB, { slug: slugB }, { cookie: adminCookie })).status, 200);
  assert.equal((await call(bySlugRoute.GET, hostB, { slug: slugA }, { cookie: adminCookie })).status, 404);
  // The same member reaches both on an unregistered host, as on a single-enterprise deployment.
  assert.equal((await call(workspaceRoute.GET, loose, { workspaceId: idB }, { cookie: adminCookie })).status, 200);
});
