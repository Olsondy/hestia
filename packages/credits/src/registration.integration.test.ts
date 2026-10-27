import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { pool, transaction } from '../../persistence/src/client';
import { createInvitation, acceptInvitation } from '../../identity/src/service';
import { createRegistrationInTransaction, register, registrationSchema } from '../../identity/src/registration';
import { auth, authOrigin } from '../../identity/src/auth';

const marker = randomUUID(), emails: string[] = [], users: string[] = [];
const password = 'synthetic-registration-password-527!';
const nextEmail = () => { const value = `credit-${marker}-${emails.length}@example.test`; emails.push(value); return value; };
const headers = (cookie?: string, origin = authOrigin) => ({ Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) });
async function http(path: string, method = 'GET', data?: unknown, cookie?: string, origin?: string) {
  return fetch(`${authOrigin}${path}`, { method, headers: headers(cookie, origin), body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(30000) });
}
async function login(email: string) {
  const response = await http('/api/auth/sign-in/email', 'POST', { email, password }); assert.equal(response.status, 200);
  return response.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
}

after(async () => {
  try { await transaction(async client => {
    const ids = (await client.query('SELECT id FROM hestia_auth_user WHERE email=ANY($1::text[])', [emails])).rows.map(row => row.id);
    const projects = (await client.query('SELECT id FROM projects WHERE owner_id=ANY($1::text[])', [ids])).rows.map(row => row.id);
    await client.query('DELETE FROM operations WHERE owner_id=ANY($1::text[])', [ids]);
    await client.query('DELETE FROM project_revisions WHERE project_id=ANY($1::uuid[])', [projects]);
    await client.query('DELETE FROM projects WHERE owner_id=ANY($1::text[])', [ids]);
    await client.query('DELETE FROM hestia_invitation WHERE email=ANY($1::text[])', [emails]);
    await client.query('DELETE FROM hestia_auth_user WHERE email=ANY($1::text[])', [emails]);
  }); } finally { await pool.end(); }
});

test('open registration, exactly-once grant, session and user isolation through existing HTTP/PG', async () => {
  const first = nextEmail(), second = nextEmail(), register = { name: '合成注册验收', email: first.toUpperCase(), password };
  assert.equal((await http('/api/register', 'POST', register, undefined, 'https://untrusted.invalid')).status, 403);
  assert.equal((await http('/api/register', 'POST', { ...register, amount: 9999 })).status, 400);
  assert.equal((await http('/api/credits')).status, 401);
  assert.equal((await http('/api/projects')).status, 401);
  const attempts = await Promise.all(Array.from({ length: 3 }, () => http('/api/register', 'POST', register)));
  assert.ok(attempts.every(response => response.status === 201), `statuses=${attempts.map(response => response.status)}`);
  assert.deepEqual(await attempts[0].json(), { registered: true });
  const identity = await pool.query('SELECT id FROM hestia_auth_user WHERE email=$1', [first]); assert.equal(identity.rowCount, 1);
  users.push(identity.rows[0].id);
  assert.equal((await pool.query("SELECT id FROM credit_ledger WHERE user_id=$1 AND kind='registration_grant'", [users[0]])).rowCount, 1);
  assert.equal((await http('/api/register', 'POST', register)).status, 201); // lost-response replay
  assert.equal((await pool.query('SELECT available FROM credit_accounts WHERE user_id=$1', [users[0]])).rows[0].available, 40);
  assert.equal((await http('/api/register', 'POST', { email: second, name: '另一个合成用户', password })).status, 201);
  const firstCookie = await login(first), secondCookie = await login(second);
  const firstCredits = await (await http('/api/credits', 'GET', undefined, firstCookie)).json();
  const secondCredits = await (await http(`/api/credits?userId=${encodeURIComponent(users[0])}`, 'GET', undefined, secondCookie)).json();
  assert.deepEqual(firstCredits.balance, { available: 40, reserved: 0 }); assert.equal(firstCredits.entries.length, 1);
  assert.equal(firstCredits.entries[0].kind, 'registration_grant'); assert.equal(firstCredits.entries[0].amount, 40);
  assert.deepEqual(secondCredits.balance, { available: 40, reserved: 0 });
  assert.notEqual(firstCredits.entries[0].id, secondCredits.entries[0].id);
  assert.equal((await http('/api/credits', 'POST', { available: 1000 }, firstCookie)).status, 405);
  const created = await http('/api/projects', 'POST', { name: '仅属于第一个账号', template: 'empty', operationId: randomUUID() }, firstCookie);
  assert.equal(created.status, 201); const project = (await created.json()).project;
  assert.equal((await http(`/api/projects/${project.id}`, 'GET', undefined, secondCookie)).status, 404);
});

test('legacy identity remains usable without backfill; newly invited identity receives one grant', async () => {
  const email = nextEmail(), invitation = await createInvitation(email), accepted = await acceptInvitation(invitation.token, '合成旧身份', password);
  assert.equal((await pool.query('SELECT available FROM credit_accounts WHERE user_id=$1', [accepted.userId])).rows[0].available, 40);
  // Simulate a pre-C01 identity (created before the credit migration); no production rows touched.
  await pool.query('DELETE FROM credit_ledger WHERE user_id=$1', [accepted.userId]);
  await pool.query('DELETE FROM credit_accounts WHERE user_id=$1', [accepted.userId]);
  // Existing invitation authentication is separately covered by its eight PG tests. Use the
  // same framework handler in this process to avoid consuming the shared Next sign-in bucket.
  const signed = await auth.handler(new Request(`${authOrigin}/api/auth/sign-in/email`, { method: 'POST', headers: headers(), body: JSON.stringify({ email, password }) }));
  assert.equal(signed.status, 200);
  const cookie = signed.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
  const before = await (await http('/api/credits', 'GET', undefined, cookie)).json();
  assert.deepEqual(before, { balance: { available: 0, reserved: 0 }, entries: [] });
  assert.equal((await http('/api/register', 'POST', { name: '已有用户', email, password })).status, 201);
  assert.equal((await pool.query('SELECT user_id FROM credit_accounts WHERE user_id=$1', [accepted.userId])).rowCount, 0);
  assert.deepEqual(await (await http('/api/credits', 'GET', undefined, cookie)).json(), before);
});

test('invalid rules are rejected and new grant uses transactionally read config without changing existing balances', async () => {
  const existingId = users[0], baseline = (await pool.query('SELECT available FROM credit_accounts WHERE user_id=$1', [existingId])).rows[0].available;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assert.rejects(client.query('UPDATE credit_rules SET registration_grant=-1 WHERE singleton=true'), { code: '23514' });
    await client.query('ROLLBACK');
    await client.query('BEGIN');
    await assert.rejects(client.query('UPDATE credit_rules SET qa_cost=0 WHERE singleton=true'), { code: '23514' });
    await client.query('ROLLBACK');
    await client.query('BEGIN');
    await client.query('UPDATE credit_rules SET registration_grant=55 WHERE singleton=true');
    const configured = registrationSchema.parse({ email: nextEmail(), name: '配置事务测试', password });
    await createRegistrationInTransaction(client, configured, await hashPassword(password));
    const account = (await client.query('SELECT a.available FROM credit_accounts a JOIN hestia_auth_user u ON u.id=a.user_id WHERE u.email=$1', [configured.email])).rows[0];
    assert.equal(account.available, 55);
    assert.equal((await client.query('SELECT available FROM credit_accounts WHERE user_id=$1', [existingId])).rows[0].available, baseline);
    await client.query('ROLLBACK'); // exact test identity and rule change never commit
  } finally { client.release(); }
});

test('a missing rule aborts identity, credential and grant together', async () => {
  const email = nextEmail(), client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM credit_rules WHERE singleton=true');
    await assert.rejects(createRegistrationInTransaction(client, registrationSchema.parse({ email, name: '回滚验收', password }), await hashPassword(password)), { code: 'CREDIT_CONFIGURATION_INVALID' });
    await client.query('ROLLBACK');
    assert.equal((await pool.query('SELECT 1 FROM hestia_auth_user WHERE email=$1', [email])).rowCount, 0);
  } finally { client.release(); }
});

test('public registration racing an invitation creates at most one identity and one new-user grant', async () => {
  const email = nextEmail(), invitation = await createInvitation(email);
  const outcomes = await Promise.allSettled([
    register({ email, name: '公开注册竞争', password }),
    acceptInvitation(invitation.token, '邀请注册竞争', password),
  ]);
  assert.ok(outcomes.some(outcome => outcome.status === 'fulfilled'));
  const identities = await pool.query('SELECT id FROM hestia_auth_user WHERE email=$1', [email]);
  assert.equal(identities.rowCount, 1);
  const id = identities.rows[0].id;
  assert.equal((await pool.query('SELECT available FROM credit_accounts WHERE user_id=$1', [id])).rows[0].available, 40);
  const grants = await pool.query("SELECT amount FROM credit_ledger WHERE user_id=$1 AND kind='registration_grant'", [id]);
  assert.equal(grants.rowCount, 1); assert.equal(grants.rows[0].amount, 40);
});
