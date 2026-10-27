import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { pool } from '../../persistence/src/client';
import { auth, authOrigin } from './auth';
import { acceptInvitation, createInvitation, InvitationError } from './service';
import { POST as acceptRoute } from '../../../apps/web/app/api/invitations/accept/route';

const password = 'synthetic-test-password-735!';
const runId = randomUUID();
const emails: string[] = [];
function email() { const value = `identity-${runId}-${emails.length}@example.test`; emails.push(value); return value; }
const request = (path: string, body?: unknown, cookie?: string, origin = authOrigin) => new Request(`${authOrigin}/api/auth/${path}`, {
  method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

test('invitation and Better Auth integration against PostgreSQL', async t => {
  try {
    await t.test('public email/password registration is closed', async () => {
      const value = email();
      const response = await auth.handler(request('sign-up/email', { email: value, password, name: 'Synthetic Signup' }));
      assert.equal(response.status, 400);
      assert.equal((await pool.query('SELECT id FROM hestia_auth_user WHERE email=$1', [value])).rowCount, 0);
    });
    await t.test('tokens are hashed, email is normalized, password account is created once', async () => {
      const value = email();
      const invitation = await createInvitation(value.toUpperCase());
      const stored = await pool.query('SELECT token_hash FROM hestia_invitation WHERE id=$1', [invitation.id]);
      assert.equal(stored.rows[0].token_hash, createHash('sha256').update(invitation.token).digest('hex'));
      const accepted = await acceptInvitation(invitation.token, 'Synthetic Person', password);
      assert.equal(accepted.email, value);
      const account = await pool.query('SELECT password,provider_id FROM hestia_auth_account WHERE user_id=$1', [accepted.userId]);
      assert.equal(account.rows[0].provider_id, 'credential'); assert.notEqual(account.rows[0].password, password);
      await assert.rejects(acceptInvitation(invitation.token, 'Again', password), InvitationError);
      await assert.rejects(createInvitation(value), InvitationError);
    });
    await t.test('expired invitations create no account or consumption', async () => {
      const value = email(), invitation = await createInvitation(value);
      await pool.query("UPDATE hestia_invitation SET expires_at=now()-interval '1 second' WHERE id=$1", [invitation.id]);
      await assert.rejects(acceptInvitation(invitation.token, 'Expired', password), InvitationError);
      assert.equal((await pool.query('SELECT id FROM hestia_auth_user WHERE email=$1', [value])).rowCount, 0);
      assert.equal((await pool.query('SELECT consumed_at FROM hestia_invitation WHERE id=$1', [invitation.id])).rows[0].consumed_at, null);
    });
    await t.test('concurrent consumption creates exactly one identity and one account', async () => {
      const value = email(), invitation = await createInvitation(value);
      const results = await Promise.allSettled([acceptInvitation(invitation.token, 'Concurrent A', password), acceptInvitation(invitation.token, 'Concurrent B', password)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal((await pool.query('SELECT id FROM hestia_auth_user WHERE email=$1', [value])).rowCount, 1);
    });
    await t.test('different invitations racing for one email roll back the losing consumption', async () => {
      const value = email(), a = await createInvitation(value), b = await createInvitation(value);
      const results = await Promise.allSettled([acceptInvitation(a.token, 'First', password), acceptInvitation(b.token, 'Second', password)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal((await pool.query('SELECT id FROM hestia_invitation WHERE email=$1 AND consumed_at IS NOT NULL', [value])).rowCount, 1);
    });
    await t.test('two invited users sign in with isolated database sessions; logout revokes', async () => {
      const values = [email(), email()], cookies: string[] = [], users: string[] = [];
      for (const value of values) {
        const invitation = await createInvitation(value);
        const accepted = await acceptInvitation(invitation.token, 'Synthetic Session', password); users.push(accepted.userId);
        const response = await auth.handler(request('sign-in/email', { email: value, password }));
        assert.equal(response.status, 200);
        const setCookie = response.headers.getSetCookie();
        assert.ok(setCookie.some(c => /HttpOnly/i.test(c)));
        cookies.push(setCookie.map(c => c.split(';')[0]).join('; '));
      }
      for (let i = 0; i < 2; i++) {
        const response = await auth.handler(request('get-session', undefined, cookies[i]));
        const body = await response.json(); assert.equal(body.user.id, users[i]); assert.equal(body.user.email, values[i]);
      }
      assert.equal(await (await auth.handler(request('get-session'))).json(), null);
      const failedLogin = await auth.handler(request('sign-in/email', { email: values[0], password: 'wrong-password' }));
      assert.equal(failedLogin.status, 401);
      assert.equal((await auth.handler(request('sign-out', {}, cookies[0]))).status, 200);
      assert.equal(await (await auth.handler(request('get-session', undefined, cookies[0]))).json(), null);
      assert.equal((await (await auth.handler(request('get-session', undefined, cookies[1]))).json()).user.id, users[1]);
      await pool.query("UPDATE hestia_auth_session SET expires_at=now()-interval '1 second' WHERE user_id=$1", [users[1]]);
      assert.equal(await (await auth.handler(request('get-session', undefined, cookies[1]))).json(), null);
    });
    await t.test('accept API rejects foreign origin and unrecognized email override', async () => {
      const value = email(), invitation = await createInvitation(value);
      const routeRequest = (body: unknown, origin: string) => new Request(`${authOrigin}/api/invitations/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
      });
      const body = { token: invitation.token, name: 'API User', password };
      assert.equal((await acceptRoute(routeRequest(body, 'https://untrusted.invalid'))).status, 403);
      assert.equal((await acceptRoute(routeRequest({ ...body, email: 'override@example.test' }, authOrigin))).status, 400);
      const response = await acceptRoute(routeRequest(body, authOrigin));
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, email: value });
    });
  } finally {
    // Only rows created by this run are removed; never truncate a shared development database.
    await pool.query('DELETE FROM hestia_invitation WHERE email=ANY($1::text[])', [emails]);
    await pool.query('DELETE FROM hestia_auth_user WHERE email=ANY($1::text[])', [emails]);
    await pool.end();
  }
});
