import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../../persistence/src/client';
import { auth } from '../../identity/src/auth';
import { acceptInvitation, createInvitation } from '../../identity/src/service';
import { trustedOriginFor } from '../../identity/src/origins';
import { createWorkspace } from '../../workspaces/src/service';
import { addWorkspaceDomain } from '../../workspaces/src/domains';
import { grantPlatformAdmin, listAudit, listPlatformAdmins, revokePlatformAdmin } from './service';
import { adminHost, isAdminRequest } from './host';
import * as sessionRoute from '../../../apps/web/app/api/admin/session/route';
import * as auditRoute from '../../../apps/web/app/api/admin/audit/route';
import { NextRequest } from 'next/server';
import { proxy } from '../../../apps/web/proxy';

// AM01 (ADR-0018): platform administrators are granted on the server, the console answers only on HESTIA_ADMIN_HOST,
// and every grant or revoke is audited. HTTP route handlers + real PostgreSQL.
const run = randomUUID().slice(0, 8), parent = `am01-${run}.example.test`, admin = `admin.${parent}`, slug = `am01-${run}`, enterpriseHost = `${slug}.${parent}`;
const password = 'synthetic-am01-password-731!';
const emails = { ops: `am01-ops-${run}@example.test`, member: `am01-member-${run}@example.test` };
const cookies: Record<keyof typeof emails, string> = { ops: '', member: '' };
let previousAdminHost: string | undefined;
type Handler = (request: Request, context: never) => Promise<Response>;
async function call(handler: Handler, host: string, cookie?: string) {
  const headers: Record<string, string> = { Host: host };
  if (cookie) headers.Cookie = cookie;
  const response = await handler(new Request(`http://${host}/api/admin/test`, { headers }), { params: Promise.resolve({}) } as never);
  return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? await response.json() : null };
}

before(async () => {
  previousAdminHost = process.env.HESTIA_ADMIN_HOST;
  process.env.HESTIA_ADMIN_HOST = admin.toUpperCase();
  for (const key of Object.keys(emails) as (keyof typeof emails)[]) {
    const invitation = await createInvitation(emails[key]);
    await acceptInvitation(invitation.token, `合成${key}`, password);
    cookies[key] = (await auth.api.signInEmail({ body: { email: emails[key], password }, asResponse: true })).headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  }
  await createWorkspace({ kind: 'enterprise', slug, name: '后台测试企业', adminEmail: emails.member });
  await addWorkspaceDomain(slug, enterpriseHost);
});
after(async () => {
  if (previousAdminHost === undefined) delete process.env.HESTIA_ADMIN_HOST; else process.env.HESTIA_ADMIN_HOST = previousAdminHost;
  try {
    const users = (await pool.query('SELECT id FROM hestia_auth_user WHERE email=ANY($1)', [Object.values(emails)])).rows.map(row => row.id);
    await pool.query('DELETE FROM platform_audit WHERE target=ANY($1)', [Object.values(emails)]);
    await pool.query('DELETE FROM workspaces WHERE slug=$1 OR personal_user_id=ANY($2)', [slug, users]);
    await pool.query('DELETE FROM hestia_invitation WHERE email=ANY($1)', [Object.values(emails)]);
    await pool.query('DELETE FROM hestia_auth_user WHERE id=ANY($1)', [users]);
  } finally { await pool.end(); }
});

test('the admin host is configured and normalized; only that host is an admin request', () => {
  assert.equal(adminHost(), admin);
  assert.equal(isAdminRequest(new Headers({ Host: `${admin.toUpperCase()}:443` })), true);
  for (const host of [enterpriseHost, parent, `www.${parent}`, 'localhost']) assert.equal(isAdminRequest(new Headers({ Host: host })), false, host);
});

test('admin, www, api and the main domain itself cannot be registered as an enterprise entry', async () => {
  for (const host of [admin, parent, `www.${parent}`, `api.${parent}`, `static.${parent}`, `mail.${parent}`])
    await assert.rejects(addWorkspaceDomain(slug, host), { code: 'RESERVED_HOST' }, host);
  // A reserved label only matters right under our main domain: an enterprise's own www domain is fine.
  for (const host of [`www.${slug}-own.example.test`, `admin-${run}.${parent}`]) assert.equal((await addWorkspaceDomain(slug, host)).added, true, host);
});

test('grants are made by e-mail, idempotent, can be raised to super, and are audited; unknown accounts are refused', async () => {
  assert.deepEqual(await grantPlatformAdmin(emails.ops, 'platform'), { email: emails.ops, level: 'platform', changed: true });
  assert.deepEqual(await grantPlatformAdmin(emails.ops.toUpperCase(), 'platform'), { email: emails.ops, level: 'platform', changed: false });
  assert.deepEqual(await grantPlatformAdmin(emails.ops, 'super'), { email: emails.ops, level: 'super', changed: true });
  await assert.rejects(grantPlatformAdmin(`am01-nobody-${run}@example.test`, 'platform'), { code: 'NOT_FOUND' });
  const listed = (await listPlatformAdmins()).find(row => row.email === emails.ops);
  assert.equal(listed?.level, 'super');
  const audit = (await listAudit({ limit: 50 })).filter(row => row.target === emails.ops);
  assert.deepEqual(audit.map(row => [row.action, row.actor, row.detail]), [
    ['grant', 'server command', { level: 'super', previous: 'platform' }],
    ['grant', 'server command', { level: 'platform', previous: null }],
  ]);
});

test('the console API answers only a platform administrator, only on the admin host, and stops at once on revoke', async () => {
  await grantPlatformAdmin(emails.ops, 'super');
  const ok = await call(sessionRoute.GET, admin, cookies.ops);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { admin: { name: '合成ops', email: emails.ops, level: 'super' } });

  // Off the admin host the console does not exist, even for an administrator.
  for (const host of [enterpriseHost, parent, `elsewhere-${run}.example.test`]) assert.equal((await call(sessionRoute.GET, host, cookies.ops)).status, 404, host);
  assert.equal((await call(sessionRoute.GET, admin)).status, 401);
  // An enterprise admin is not a platform administrator.
  assert.equal((await call(sessionRoute.GET, admin, cookies.member)).status, 403);
  assert.equal((await call(auditRoute.GET, admin, cookies.member)).status, 403);

  const audit = await call(auditRoute.GET, admin, cookies.ops);
  assert.equal(audit.status, 200);
  const mine = audit.body.entries.filter((row: { target: string }) => row.target === emails.ops);
  assert.ok(mine.length >= 1 && mine[0].action === 'grant' && typeof mine[0].at === 'string');

  assert.deepEqual(await revokePlatformAdmin(emails.ops), { email: emails.ops, revoked: true });
  assert.deepEqual(await revokePlatformAdmin(emails.ops), { email: emails.ops, revoked: false });
  assert.equal((await call(sessionRoute.GET, admin, cookies.ops)).status, 403, 'the same session is refused right after revoke');
  assert.equal((await listAudit({ limit: 50 })).find(row => row.target === emails.ops)?.action, 'revoke');
});

test('state-changing requests are trusted from the admin host origin only when sent to the admin host', async () => {
  assert.equal(await trustedOriginFor(new Headers({ Host: admin, Origin: `http://${admin}` })), `http://${admin}`);
  assert.equal(await trustedOriginFor(new Headers({ Host: enterpriseHost, Origin: `http://${admin}` })), null);
  assert.equal(await trustedOriginFor(new Headers({ Host: admin, Origin: `http://${enterpriseHost}` })), null);
});

test('the proxy hides /admin off the admin host and keeps the admin host to the console', () => {
  const at = (host: string, path: string) => proxy(new NextRequest(`http://${host}${path}`, { headers: { Host: host } }));
  for (const path of ['/admin', '/admin/audit', '/api/admin/session']) {
    const hidden = at(enterpriseHost, path);
    assert.match(hidden.headers.get('x-middleware-rewrite') ?? '', /\/_hestia\/not-found$/, path);
    assert.equal(at(admin, path).headers.get('x-middleware-next'), '1', path);
  }
  for (const path of ['/api/auth/sign-in/email', '/fonts/a.woff2']) assert.equal(at(admin, path).headers.get('x-middleware-next'), '1', path);
  for (const path of ['/', '/w', '/c/x', '/api/workspaces']) {
    const response = at(admin, path);
    assert.equal(response.status, 307, path); assert.equal(new URL(response.headers.get('location')!).pathname, '/admin', path);
  }
  assert.equal(at(enterpriseHost, '/w').headers.get('x-middleware-next'), '1');
});
