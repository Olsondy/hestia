import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pool } from '../../persistence/src/client';
import { auth } from './auth';
import { acceptInvitation, createInvitation } from './service';
import { mockSmsSender, setSmsSender } from './sms';
import { createWorkspace } from '../../workspaces/src/service';
import { addWorkspaceDomain } from '../../workspaces/src/domains';
import * as authRoute from '../../../apps/web/app/api/auth/[...all]/route';
import * as sessionRoute from '../../../apps/web/app/api/session/route';
import * as myRequestsRoute from '../../../apps/web/app/api/client/[entry]/requests/route';

// M02 (ADR-0017): customer accounts belong to one enterprise; sessions count only on that enterprise's domain.
// Members keep platform e-mail accounts. HTTP route handlers + real PostgreSQL.
const run = randomUUID().slice(0, 8), slugA = `m02a-${run}`, slugB = `m02b-${run}`, hostA = `${slugA}.example.test`, hostB = `${slugB}.example.test`;
const loose = `m02-loose-${run}.example.test`, adminEmail = `m02-admin-${run}@example.test`, password = 'synthetic-m02-password-482!';
const phones: string[] = [];
let idA = '', idB = '', adminCookie = '';
const ip = () => `10.6.${randomInt(0, 255)}.${randomInt(1, 255)}`;
const cookieOf = (response: Response) => response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
const phone = () => { const value = `199${String(randomInt(0, 1e8)).padStart(8, '0')}`; phones.push(`+86${value}`); return value; };
async function auth_(host: string, path: string, payload: unknown) {
  const response = await authRoute.POST(new Request(`http://${host}/api/auth/${path}`, { method: 'POST', body: JSON.stringify(payload),
    headers: { Host: host, Origin: `http://${host}`, 'Content-Type': 'application/json', 'X-Real-IP': ip() } }));
  return { status: response.status, body: await response.json(), cookie: cookieOf(response) };
}
async function signIn(host: string, entry: string, phoneNumber: string) {
  const sent = await auth_(host, 'phone/send-code', { phoneNumber, entry });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const signed = await auth_(host, 'phone/sign-in', { phoneNumber, entry, code: sent.body.demoCode });
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  return { userId: signed.body.user.id as string, cookie: signed.cookie };
}
async function get(handler: (request: Request, context: never) => Promise<Response>, host: string, cookie: string, params: Record<string, string> = {}) {
  const response = await handler(new Request(`http://${host}/api/test`, { headers: { Host: host, Cookie: cookie } }), { params: Promise.resolve(params) } as never);
  return { status: response.status, body: await response.json() };
}
const accountOf = async (userId: string) => (await pool.query('SELECT workspace_id FROM hestia_auth_user WHERE id=$1', [userId])).rows[0]?.workspace_id ?? null;
const customerOf = async (workspaceId: string, userId: string) => (await pool.query('SELECT 1 FROM workspace_customers WHERE workspace_id=$1 AND user_id=$2', [workspaceId, userId])).rowCount === 1;

before(async () => {
  process.env.HESTIA_OTP_SOURCE_HEADER = 'x-real-ip';
  setSmsSender(mockSmsSender);
  await acceptInvitation((await createInvitation(adminEmail)).token, '合成成员', password);
  adminCookie = cookieOf(await auth.api.signInEmail({ body: { email: adminEmail, password }, asResponse: true }));
  idA = (await createWorkspace({ kind: 'enterprise', slug: slugA, name: '账号企业甲', adminEmail })).workspace.id;
  // The member belongs to A only; B gets its own admin so the member is not part of it.
  const otherAdmin = `m02-other-${run}@example.test`;
  await acceptInvitation((await createInvitation(otherAdmin)).token, '合成乙管理员', password);
  idB = (await createWorkspace({ kind: 'enterprise', slug: slugB, name: '账号企业乙', adminEmail: otherAdmin })).workspace.id;
  await addWorkspaceDomain(slugA, hostA); await addWorkspaceDomain(slugB, hostB);
});
after(async () => {
  try {
    const users = (await pool.query("SELECT id FROM hestia_auth_user WHERE phone_number=ANY($1) OR email LIKE $2", [phones, `m02-%-${run}@example.test`])).rows.map(r => r.id);
    await pool.query('DELETE FROM workspaces WHERE slug=ANY($1) OR personal_user_id=ANY($2)', [[slugA, slugB], users]);
    await pool.query('DELETE FROM phone_otp_challenges WHERE phone_number=ANY($1)', [phones]);
    await pool.query("DELETE FROM hestia_invitation WHERE email LIKE $1", [`m02-%-${run}@example.test`]);
    await pool.query('DELETE FROM hestia_auth_user WHERE id=ANY($1)', [users]);
  } finally { await pool.end(); }
});

test('the same number at two enterprises is two accounts; signing in again at one finds the same account', async () => {
  const number = phone(), atA = await signIn(hostA, slugA, number), atB = await signIn(hostB, slugB, number);
  assert.notEqual(atA.userId, atB.userId);
  assert.equal(await accountOf(atA.userId), idA); assert.equal(await accountOf(atB.userId), idB);
  assert.ok(await customerOf(idA, atA.userId)); assert.ok(!(await customerOf(idB, atA.userId)));
  await pool.query("UPDATE phone_otp_challenges SET created_at=created_at-interval '61 seconds' WHERE phone_number=$1", [`+86${number}`]);
  assert.equal((await signIn(hostA, slugA, number)).userId, atA.userId);
  // Within one enterprise the number stays unique.
  await assert.rejects(pool.query('INSERT INTO hestia_auth_user (id, name, phone_number, workspace_id) VALUES ($1, $2, $3, $4)',
    [randomUUID(), '重复', `+86${number}`, idA]), { code: '23505' });
});

test('a session counts only on its own enterprise\'s domain', async () => {
  const customer = await signIn(hostA, slugA, phone());
  assert.equal((await get(sessionRoute.GET, hostA, customer.cookie)).body.user.id, customer.userId);
  assert.equal((await get(sessionRoute.GET, hostB, customer.cookie)).body.user, null);
  assert.equal((await get(myRequestsRoute.GET, hostA, customer.cookie, { entry: slugA })).status, 200);
  // On an unregistered host the account still cannot act at another enterprise, nor become its customer.
  const elsewhere = await get(myRequestsRoute.GET, loose, customer.cookie, { entry: slugB });
  assert.equal(elsewhere.status, 401); assert.equal(elsewhere.body.error.code, 'UNAUTHENTICATED');
  assert.ok(!(await customerOf(idB, customer.userId)));
  // A member's platform account counts where it is a member, not at another enterprise.
  assert.equal((await get(sessionRoute.GET, hostA, adminCookie)).body.user.email, adminEmail);
  assert.equal((await get(sessionRoute.GET, hostB, adminCookie)).body.user, null);
  assert.equal((await get(sessionRoute.GET, loose, adminCookie)).body.user.email, adminEmail);
});

test('codes are asked for, limited and used per enterprise', async () => {
  const number = phone();
  const sentA = await auth_(hostA, 'phone/send-code', { phoneNumber: number, entry: slugA });
  assert.equal(sentA.status, 200);
  // A's code does not sign in at B, and A's resend cooldown does not hold up B.
  const wrong = await auth_(hostB, 'phone/sign-in', { phoneNumber: number, entry: slugB, code: sentA.body.demoCode });
  assert.equal(wrong.body.error.code, 'OTP_NOT_REQUESTED');
  assert.equal((await auth_(hostA, 'phone/send-code', { phoneNumber: number, entry: slugA })).body.error.code, 'OTP_COOLDOWN');
  const sentB = await auth_(hostB, 'phone/send-code', { phoneNumber: number, entry: slugB });
  assert.equal(sentB.status, 200);
  // B's new code did not supersede A's.
  assert.equal((await auth_(hostA, 'phone/sign-in', { phoneNumber: number, entry: slugA, code: sentA.body.demoCode })).status, 200);
});

test('migration: an existing customer account joins its one enterprise; no relation stays platform; two relations refuse', async () => {
  const sql = (await readFile(new URL('../../persistence/drizzle/0007_backfill_customer_accounts.sql', import.meta.url), 'utf8')).split('--> statement-breakpoint');
  const legacy = async (client: import('pg').PoolClient, workspaceIds: string[]) => {
    const id = randomUUID(), number = phone();
    await client.query('INSERT INTO hestia_auth_user (id, name, phone_number) VALUES ($1, $2, $3)', [id, '旧账号', `+86${number}`]);
    for (const w of workspaceIds) await client.query('INSERT INTO workspace_customers (workspace_id, user_id) VALUES ($1, $2)', [w, id]);
    return id;
  };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const one = await legacy(client, [idA]), none = await legacy(client, []);
    for (const statement of sql) await client.query(statement);
    const scoped = async (id: string) => (await client.query('SELECT workspace_id FROM hestia_auth_user WHERE id=$1', [id])).rows[0].workspace_id;
    assert.equal(await scoped(one), idA); assert.equal(await scoped(none), null);
    await client.query('ROLLBACK');
    await client.query('BEGIN');
    const both = await legacy(client, [idA, idB]);
    await assert.rejects(client.query(sql[0]), (error: Error) => error.message.includes(both) && error.message.includes('must be split'));
  } finally { await client.query('ROLLBACK'); client.release(); }
});
