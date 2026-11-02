import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pool } from '../../persistence/src/client';
import { auth, authOrigin } from './auth';
import { acceptInvitation, createInvitation } from './service';
import { mockSmsSender, setSmsSender, type VerificationSms } from './sms';
import { createWorkspace } from '../../workspaces/src/service';
import * as authRoute from '../../../apps/web/app/api/auth/[...all]/route';
import * as workspacesRoute from '../../../apps/web/app/api/workspaces/route';
import * as workspaceRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/route';
import * as workspaceProjectsRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/projects/route';
import * as membersRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/members/route';
import * as projectRoute from '../../../apps/web/app/api/projects/[id]/route';

const run = randomUUID(), slug = `d02-${run.slice(0, 8)}`, password = 'synthetic-phone-password-482!';
const adminEmail = `phone-admin-${run}@example.test`, phones: string[] = [];
let adminUser = '', adminCookie = '', workspaceId = '', projectId = '';
// Synthetic numbers in the 199 range, unique per run.
const phone = () => { const value = `199${String(randomInt(0, 1e8)).padStart(8, '0')}`; phones.push(`+86${value}`); return value; };
const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');

/** Calls the public auth route handler exactly as the browser would (same-origin JSON POST). */
async function post(path: string, payload: unknown, ip = `10.0.${randomInt(0, 255)}.${randomInt(1, 255)}`) {
  const response = await authRoute.POST(new Request(`${authOrigin}/api/auth/${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: authOrigin, 'X-Real-IP': ip }, body: JSON.stringify(payload) }));
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text), cookie: cookieOf(response) };
}
const send = (phoneNumber: string, ip?: string, entry = slug) => post('phone/send-code', { phoneNumber, entry }, ip);
const signIn = (phoneNumber: string, code: string, entry = slug) => post('phone/sign-in', { phoneNumber, code, entry });
/** Moves this number's sends out of the resend cooldown without touching the hourly window. */
const skipCooldown = (phoneNumber: string) => pool.query("UPDATE phone_otp_challenges SET created_at=created_at-interval '61 seconds' WHERE phone_number=$1", [`+86${phoneNumber}`]);
type Handler = (request: Request, context: never) => Promise<Response>;
async function get(handler: Handler, cookie: string, params: Record<string, string> = {}) {
  const response = await handler(new Request(`${authOrigin}/api/test`, { headers: { Cookie: cookie } }), { params: Promise.resolve(params) } as never);
  return { status: response.status, body: await response.json() };
}
const session = async (cookie: string) => (await auth.handler(new Request(`${authOrigin}/api/auth/get-session`, { headers: { Cookie: cookie } }))).json();

before(async () => {
  process.env.HESTIA_OTP_SOURCE_HEADER = 'x-real-ip';
  setSmsSender(mockSmsSender);
  const invitation = await createInvitation(adminEmail);
  adminUser = (await acceptInvitation(invitation.token, '合成企业管理员', password)).userId;
  adminCookie = cookieOf(await auth.api.signInEmail({ body: { email: adminEmail, password }, asResponse: true }));
  workspaceId = (await createWorkspace({ kind: 'enterprise', slug, name: '合成石材企业', adminEmail })).workspace.id;
  const created = await workspaceProjectsRoute.POST(new Request(`${authOrigin}/api/test`, { method: 'POST',
    headers: { Cookie: adminCookie, Origin: authOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '企业成员项目', template: 'empty', operationId: randomUUID() }) }), { params: Promise.resolve({ workspaceId }) });
  assert.equal(created.status, 201); projectId = (await created.json()).project.id;
});
after(async () => {
  try {
    const users = (await pool.query('SELECT id FROM hestia_auth_user WHERE phone_number=ANY($1) OR id=$2', [phones, adminUser])).rows.map(row => row.id);
    const workspaces = (await pool.query('SELECT id FROM workspaces WHERE slug=$1 OR personal_user_id=ANY($2)', [slug, users])).rows.map(row => row.id);
    await pool.query('DELETE FROM operations WHERE project_id IN (SELECT id FROM projects WHERE workspace_id=ANY($1::uuid[]))', [workspaces]);
    await pool.query('DELETE FROM project_revisions WHERE project_id IN (SELECT id FROM projects WHERE workspace_id=ANY($1::uuid[]))', [workspaces]);
    await pool.query('DELETE FROM projects WHERE workspace_id=ANY($1::uuid[])', [workspaces]);
    await pool.query('DELETE FROM workspaces WHERE id=ANY($1::uuid[])', [workspaces]);
    await pool.query('DELETE FROM phone_otp_challenges WHERE phone_number=ANY($1)', [phones]);
    await pool.query('DELETE FROM hestia_invitation WHERE email=$1', [adminEmail]);
    await pool.query('DELETE FROM hestia_auth_user WHERE id=ANY($1)', [users]);
  } finally { await pool.end(); }
});

test('mock code signs in once per number, stores only a hash, and records one customer relation', async () => {
  const number = phone(), logged: unknown[] = [], info = console.info;
  console.info = (...args: unknown[]) => { logged.push(args); };
  let sent;
  try { sent = await send(number); } finally { console.info = info; }
  assert.equal(sent.status, 200);
  assert.match(sent.body.demoCode, /^\d{6}$/);
  assert.deepEqual({ ...sent.body, demoCode: undefined }, { sent: true, expiresInSeconds: 300, resendAfterSeconds: 60, maxAttempts: 5, demoCode: undefined });
  assert.ok(JSON.stringify(logged).includes(sent.body.demoCode), 'mock code is written to the server log');
  const stored = (await pool.query('SELECT code_hash,source_hash FROM phone_otp_challenges WHERE phone_number=$1', [`+86${number}`])).rows;
  assert.equal(stored.length, 1); assert.doesNotMatch(JSON.stringify(stored), new RegExp(sent.body.demoCode));

  const first = await signIn(number, sent.body.demoCode);
  assert.equal(first.status, 200);
  assert.equal(first.body.user.phoneNumber, `+86${number}`); assert.deepEqual(first.body.entry, { slug, name: '合成石材企业' });
  assert.deepEqual(first.body.customer, { created: true });
  assert.equal((await session(first.cookie)).user.id, first.body.user.id);
  // A consumed code cannot be reused.
  assert.equal((await signIn(number, sent.body.demoCode)).body.error.code, 'OTP_NOT_REQUESTED');

  // Same number in another notation: same account, no second relation.
  await skipCooldown(number);
  const again = await send(`+86 ${number.slice(0, 3)}-${number.slice(3)}`);
  const second = await signIn(number, again.body.demoCode);
  assert.equal(second.body.user.id, first.body.user.id); assert.deepEqual(second.body.customer, { created: false });
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM hestia_auth_user WHERE phone_number=$1', [`+86${number}`])).rows[0].n, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM workspace_customers WHERE user_id=$1', [first.body.user.id])).rows[0].n, 1);
});

test('wrong codes spend attempts until the code locks; expired codes are refused', async () => {
  const number = phone(), sent = await send(number), wrong = sent.body.demoCode === '000000' ? '111111' : '000000';
  for (const remaining of [4, 3, 2, 1]) {
    const result = await signIn(number, wrong);
    assert.equal(result.status, 400); assert.equal(result.body.error.code, 'OTP_INVALID'); assert.equal(result.body.error.details.attemptsRemaining, remaining);
  }
  const locked = await signIn(number, wrong);
  assert.equal(locked.status, 429); assert.equal(locked.body.error.code, 'OTP_LOCKED');
  assert.equal((await signIn(number, sent.body.demoCode)).body.error.code, 'OTP_LOCKED', 'the right code no longer works once locked');
  assert.equal(locked.cookie, '');

  await skipCooldown(number);
  const fresh = await send(number);
  await pool.query("UPDATE phone_otp_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE phone_number=$1 AND superseded_at IS NULL", [`+86${number}`]);
  const expired = await signIn(number, fresh.body.demoCode);
  assert.equal(expired.status, 400); assert.equal(expired.body.error.code, 'OTP_EXPIRED');
  assert.equal((await pool.query('SELECT id FROM hestia_auth_user WHERE phone_number=$1', [`+86${number}`])).rowCount, 0);
});

test('sends are limited by cooldown, per phone number and per source', async () => {
  const number = phone(), ip = `10.9.${randomInt(0, 255)}.1`;
  assert.equal((await send(number, ip)).status, 200);
  const cooldown = await send(number, ip);
  assert.equal(cooldown.status, 429); assert.equal(cooldown.body.error.code, 'OTP_COOLDOWN'); assert.ok(cooldown.body.error.details.retryAfterSeconds > 0);
  for (let i = 1; i < 5; i++) { await skipCooldown(number); assert.equal((await send(number, `10.8.${i}.${randomInt(1, 255)}`)).status, 200); }
  await skipCooldown(number);
  const perPhone = await send(number, `10.7.0.${randomInt(1, 255)}`);
  assert.equal(perPhone.status, 429); assert.equal(perPhone.body.error.code, 'OTP_RATE_LIMITED'); assert.equal(perPhone.body.error.details.scope, 'phone');

  process.env.HESTIA_OTP_MAX_PER_SOURCE = '3';
  try {
    const source = `10.6.${randomInt(0, 255)}.2`;
    for (let i = 0; i < 3; i++) assert.equal((await send(phone(), source)).status, 200);
    const perSource = await send(phone(), source);
    assert.equal(perSource.status, 429); assert.equal(perSource.body.error.code, 'OTP_RATE_LIMITED'); assert.equal(perSource.body.error.details.scope, 'source');
    assert.equal((await send(phone(), `10.5.${randomInt(0, 255)}.3`)).status, 200, 'another source is unaffected');
  } finally { delete process.env.HESTIA_OTP_MAX_PER_SOURCE; }
});

test('a non-mock sender never returns the code; invalid input and unknown entries are refused', async () => {
  const delivered: VerificationSms[] = [];
  setSmsSender({ provider: 'test-double', revealsCode: false, async send(message) { delivered.push(message); } });
  try {
    const number = phone(), sent = await send(number);
    assert.equal(sent.status, 200); assert.equal(sent.body.demoCode, undefined);
    assert.equal(delivered.length, 1); assert.ok(!sent.text.includes(delivered[0].code));
    assert.equal((await signIn(number, delivered[0].code)).status, 200);
  } finally { setSmsSender(mockSmsSender); }
  const unknown = await send(phone(), undefined, `no-such-${run.slice(0, 8)}`);
  assert.equal(unknown.status, 404); assert.equal(unknown.body.error.code, 'ENTRY_NOT_FOUND');
  assert.equal((await send('12345', undefined)).body.error.code, 'INVALID_PHONE');
  setSmsSender(null);
  try { assert.equal((await send(phone())).body.error.code, 'SMS_UNAVAILABLE'); } finally { setSmsSender(mockSmsSender); }
});

test('mock SMS in production stops the identity module and the web server at startup', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const start = (code: string, env: Record<string, string>) => spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code],
    { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
  const identity = "await import('./packages/identity/src/auth.ts')";
  const web = "const m = await import('./apps/web/instrumentation.ts'); await m.register();";
  const refused = start(identity, { NODE_ENV: 'production', SMS_PROVIDER: 'mock' });
  assert.notEqual(refused.status, 0); assert.match(refused.stderr, /SMS_PROVIDER=mock is not allowed when NODE_ENV=production/);
  const server = start(web, { NODE_ENV: 'production', SMS_PROVIDER: 'mock', NEXT_RUNTIME: 'nodejs' });
  assert.equal(server.status, 1); assert.match(server.stderr, /startup_configuration_rejected/);
  assert.equal(start(identity, { NODE_ENV: 'development', SMS_PROVIDER: 'mock' }).status, 0);
  assert.equal(start(web, { NODE_ENV: 'production', SMS_PROVIDER: '', NEXT_RUNTIME: 'nodejs' }).status, 0);
});

test('a customer is not a member: member APIs, the workspace and its projects stay closed', async () => {
  const number = phone(), sent = await send(number), customer = await signIn(number, sent.body.demoCode);
  assert.equal(customer.status, 200);
  const params = { workspaceId };
  assert.equal((await get(workspaceRoute.GET, customer.cookie, params)).status, 404);
  assert.equal((await get(membersRoute.GET, customer.cookie, params)).status, 404);
  assert.equal((await get(workspaceProjectsRoute.GET, customer.cookie, params)).status, 404);
  assert.equal((await get(projectRoute.GET, customer.cookie, { id: projectId })).status, 404);
  const listed = await get(workspacesRoute.GET, customer.cookie);
  assert.ok(!listed.body.workspaces.some((w: { id: string }) => w.id === workspaceId));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM project_access WHERE user_id=$1', [customer.body.user.id])).rows[0].n, 0);
  // The member still works normally, and the customer does not appear among members.
  const members = await get(membersRoute.GET, adminCookie, params);
  assert.deepEqual(members.body.members.map((m: { userId: string }) => m.userId), [adminUser]);
  assert.equal((await get(projectRoute.GET, adminCookie, { id: projectId })).status, 200);
});
