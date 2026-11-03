import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { pool, transaction } from '../../persistence/src/client';
import { auth, authOrigin } from '../../identity/src/auth';
import { acceptInvitation, createInvitation } from '../../identity/src/service';
import { mockSmsSender, setSmsSender } from '../../identity/src/sms';
import { createWorkspace } from '../../workspaces/src/service';
import { addStones } from '../../finishes/src/catalog';
import { demoStones } from '../../finishes/src/demo-stones';
import { initializeRenderQueue } from '../../renders/src/queue';
import * as authRoute from '../../../apps/web/app/api/auth/[...all]/route';
import * as leadsRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/leads/route';
import * as followRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/leads/[requestId]/follow/route';
import * as notesRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/leads/[requestId]/notes/route';
import * as sharesRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/leads/[requestId]/shares/route';
import * as bindRoute from '../../../apps/web/app/api/client/[entry]/shares/[code]/bind/route';
import * as previewRoute from '../../../apps/web/app/api/share/[code]/route';
import * as requestRoute from '../../../apps/web/app/api/client/[entry]/requests/[requestId]/route';
import * as requestsRoute from '../../../apps/web/app/api/client/[entry]/requests/route';
import * as messagesRoute from '../../../apps/web/app/api/client/[entry]/requests/[requestId]/messages/route';

// S02 线索跟进 over HTTP route handlers and real PostgreSQL.
const run = randomUUID().slice(0, 8), slugs = [`s02-${run}`, `s02-o-${run}`], password = 'synthetic-s02-password-731!';
const emails = { admin: `s02-admin-${run}@example.test`, outsider: `s02-out-${run}@example.test` }, phones: string[] = [];
const cookies = { admin: '', outsider: '' };
let workspaceId = '';
const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
type Handler = (request: Request, context: never) => Promise<Response>;
async function call(handler: Handler, params: Record<string, string>, cookie?: string, json?: unknown, query = '') {
  const response = await handler(new Request(`${authOrigin}/api/test${query}`, { method: json === undefined ? 'GET' : 'POST',
    headers: { Origin: authOrigin, ...(cookie ? { Cookie: cookie } : {}), ...(json === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: json === undefined ? undefined : JSON.stringify(json) }), { params: Promise.resolve(params) } as never);
  return { status: response.status, body: await response.json() };
}
async function customer() {
  const phoneNumber = `198${String(randomInt(0, 1e8)).padStart(8, '0')}`; phones.push(`+86${phoneNumber}`);
  const post = (path: string, payload: unknown) => authRoute.POST(new Request(`${authOrigin}/api/auth/${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: authOrigin, 'X-Real-IP': `10.7.${randomInt(0, 255)}.${randomInt(1, 255)}` }, body: JSON.stringify(payload) }));
  const code = (await (await post('phone/send-code', { phoneNumber, entry: slugs[0] })).json()).demoCode;
  return cookieOf(await post('phone/sign-in', { phoneNumber, entry: slugs[0], code }));
}
async function lead(name: string) {
  const created = await call(leadsRoute.POST, { workspaceId }, cookies.admin, { operationId: randomUUID(), name,
    finishIds: ['finish-f1-living-floor'], stones: [{ stoneId: 'demo-white-marble', stoneVersion: 1 }] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.lead;
}
const follow = (requestId: string, status: string, cookie = cookies.admin, operationId = randomUUID()) =>
  call(followRoute.POST, { workspaceId, requestId }, cookie, { operationId, status });
const note = (requestId: string, text: string, cookie = cookies.admin, operationId = randomUUID()) =>
  call(notesRoute.POST, { workspaceId, requestId }, cookie, { operationId, note: text });

before(async () => {
  process.env.HESTIA_OTP_SOURCE_HEADER = 'x-real-ip';
  setSmsSender(mockSmsSender);
  await initializeRenderQueue();
  for (const key of ['admin', 'outsider'] as const) {
    const invitation = await createInvitation(emails[key]);
    await acceptInvitation(invitation.token, key === 'admin' ? '合成方案顾问' : '另一企业成员', password);
    cookies[key] = cookieOf(await auth.api.signInEmail({ body: { email: emails[key], password }, asResponse: true }));
  }
  workspaceId = (await createWorkspace({ kind: 'enterprise', slug: slugs[0], name: '跟进验证企业', adminEmail: emails.admin })).workspace.id;
  await createWorkspace({ kind: 'enterprise', slug: slugs[1], name: '另一企业', adminEmail: emails.outsider });
  await transaction(client => addStones(client, workspaceId, demoStones));
});
after(async () => {
  try {
    const users = (await pool.query('SELECT id FROM hestia_auth_user WHERE phone_number=ANY($1) OR email=ANY($2)', [phones, Object.values(emails)])).rows.map(row => row.id);
    const workspaces = (await pool.query('SELECT id FROM workspaces WHERE slug=ANY($1) OR personal_user_id=ANY($2)', [slugs, users])).rows.map(row => row.id);
    await pool.query('DELETE FROM finish_requests WHERE workspace_id=ANY($1::uuid[])', [workspaces]);
    for (const table of ['project_renders', 'resources', 'project_revisions', 'operations'])
      await pool.query(`DELETE FROM ${table} WHERE project_id IN (SELECT id FROM projects WHERE workspace_id=ANY($1::uuid[]))`, [workspaces]);
    await pool.query('DELETE FROM projects WHERE workspace_id=ANY($1::uuid[])', [workspaces]);
    await pool.query('DELETE FROM workspace_stones WHERE workspace_id=ANY($1::uuid[])', [workspaces]);
    await pool.query('DELETE FROM workspaces WHERE id=ANY($1::uuid[])', [workspaces]);
    await pool.query('DELETE FROM phone_otp_challenges WHERE phone_number=ANY($1)', [phones]);
    await pool.query('DELETE FROM hestia_invitation WHERE email=ANY($1)', [Object.values(emails)]);
    await pool.query('DELETE FROM hestia_auth_user WHERE id=ANY($1)', [users]);
  } finally { await pool.end(); }
});

test('members set the follow status and append notes; history records who and when; writes are idempotent', async () => {
  const created = await lead('跟进别墅 · 演示');
  assert.deepEqual(created.follow, { status: 'new', history: [], notes: [] });
  const operationId = randomUUID();
  const contacted = await follow(created.id, 'contacted', cookies.admin, operationId);
  assert.equal(contacted.status, 200, JSON.stringify(contacted.body));
  assert.equal(contacted.body.lead.follow.status, 'contacted');
  assert.deepEqual(contacted.body.lead.follow.history.map((h: { status: string; by: { name: string } }) => `${h.status}:${h.by.name}`), ['contacted:合成方案顾问']);
  // Retrying the same operation changes nothing; reusing its ID for another status is refused.
  assert.equal((await follow(created.id, 'contacted', cookies.admin, operationId)).body.lead.follow.history.length, 1);
  assert.equal((await follow(created.id, 'won', cookies.admin, operationId)).body.error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await follow(created.id, 'contacted')).body.lead.follow.history.length, 1, 'setting the current status again records nothing');
  assert.equal((await follow(created.id, 'active')).body.lead.follow.history.length, 2);
  assert.equal((await follow(created.id, 'lost')).status, 400);

  const noteId = randomUUID(), first = await note(created.id, '  客户周末在家，可约上门量尺。  ', cookies.admin, noteId);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.lead.follow.notes.map((n: { text: string; by: { name: string } }) => `${n.by.name}:${n.text}`), ['合成方案顾问:客户周末在家，可约上门量尺。']);
  assert.ok(Date.parse(first.body.lead.follow.notes[0].at) > 0);
  assert.equal((await note(created.id, '客户周末在家，可约上门量尺。', cookies.admin, noteId)).body.lead.follow.notes.length, 1, 'retry is a no-op');
  await note(created.id, '已发样板照片。');
  assert.equal((await note(created.id, 'x'.repeat(501))).status, 400);
  assert.equal((await note(created.id, '   ')).status, 400);
  const listed = (await call(leadsRoute.GET, { workspaceId }, cookies.admin)).body.leads.find((l: { id: string }) => l.id === created.id);
  assert.deepEqual(listed.follow.notes.map((n: { text: string }) => n.text), ['客户周末在家，可约上门量尺。', '已发样板照片。']);
});

test('customers, other enterprises\' members and visitors cannot read or write follow-up; client views carry none of it', async () => {
  const created = await lead('保密别墅 · 演示'), secret = `内部备注-${run}`;
  await note(created.id, secret); await follow(created.id, 'won');
  const shared = (await call(sharesRoute.POST, { workspaceId, requestId: created.id }, cookies.admin, { operationId: randomUUID() })).body;
  const owner = await customer();
  assert.equal((await call(bindRoute.POST, { entry: slugs[0], code: shared.code }, owner, { operationId: randomUUID() })).status, 200);
  for (const [cookie, expected] of [[owner, 404], [cookies.outsider, 404], ['', 401]] as const) {
    assert.equal((await follow(created.id, 'parked', cookie)).status, expected);
    assert.equal((await note(created.id, '冒充备注', cookie)).status, expected);
    assert.equal((await call(leadsRoute.GET, { workspaceId }, cookie)).status, expected);
  }
  const views = [await call(requestRoute.GET, { entry: slugs[0], requestId: created.id }, owner), await call(requestsRoute.GET, { entry: slugs[0] }, owner),
    await call(previewRoute.GET, { code: shared.code }, owner)];
  for (const view of views) {
    assert.equal(view.status, 200);
    const json = JSON.stringify(view.body);
    assert.ok(!json.includes(secret) && !json.includes('"follow"') && !json.includes('followStatus'), json.slice(0, 200));
  }
  const lead2 = (await call(leadsRoute.GET, { workspaceId }, cookies.admin)).body.leads.find((l: { id: string }) => l.id === created.id);
  assert.equal(lead2.follow.status, 'won'); assert.equal(lead2.follow.notes.length, 1);
});

test('filters by request status, follow status and contact request; latest customer action is reported', async () => {
  const quiet = await lead('安静别墅 · 演示'), asking = await lead('来电别墅 · 演示');
  await follow(quiet.id, 'parked');
  const shared = (await call(sharesRoute.POST, { workspaceId, requestId: asking.id }, cookies.admin, { operationId: randomUUID() })).body;
  const owner = await customer();
  await call(bindRoute.POST, { entry: slugs[0], code: shared.code }, owner, { operationId: randomUUID() });
  assert.equal((await call(messagesRoute.POST, { entry: slugs[0], requestId: asking.id }, owner, { operationId: randomUUID(), contactRequested: true, preferredTime: '工作日晚上' })).status, 200);
  const ids = async (query: string) => (await call(leadsRoute.GET, { workspaceId }, cookies.admin, undefined, query)).body.leads.map((l: { id: string }) => l.id);
  assert.deepEqual(await ids('?follow=parked'), [quiet.id]);
  assert.ok((await ids('?contact=1')).includes(asking.id)); assert.ok(!(await ids('?contact=1')).includes(quiet.id));
  assert.ok((await ids('?status=published')).includes(quiet.id));
  assert.deepEqual(await ids('?status=pending_review'), []);
  assert.deepEqual(await ids('?follow=new&contact=1'), [asking.id]);
  assert.equal((await call(leadsRoute.GET, { workspaceId }, cookies.admin, undefined, '?follow=bogus')).status, 400);
  const all = (await call(leadsRoute.GET, { workspaceId }, cookies.admin)).body.leads;
  const askingView = all.find((l: { id: string }) => l.id === asking.id), quietView = all.find((l: { id: string }) => l.id === quiet.id);
  assert.equal(askingView.contactRequested, true); assert.equal(askingView.lastCustomerAction.kind, 'contact');
  assert.equal(quietView.contactRequested, false); assert.equal(quietView.lastCustomerAction, null, 'member-prepared lead without customer action');
});
