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
import * as adminUsage from '../../../apps/web/app/api/admin/usage/route';
import * as adminExport from '../../../apps/web/app/api/admin/usage/export/route';
import * as enterpriseUsageRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/usage/route';

// AM04 (ADR-0018): usage per call, summed by month, enterprise, model and member, each call at its own price version;
// unverified calls listed. HTTP route handlers + real PostgreSQL. No model is called.
const run = randomUUID().slice(0, 8), admin = `admin.am04-${run}.example.test`, slugA = `am04a-${run}`, slugB = `am04b-${run}`;
const hostA = `${slugA}.am04-${run}.example.test`, hostB = `${slugB}.am04-${run}.example.test`, password = 'synthetic-am04-password-317!';
const emails = { ops: `am04-ops-${run}@example.test`, adminA: `am04-a-${run}@example.test`, memberA: `am04-m-${run}@example.test`, adminB: `am04-b-${run}@example.test` };
const cookies = {} as Record<keyof typeof emails, string>, saved: Record<string, string | undefined> = {}, actor = { userId: null as unknown as string, email: `am04-actor-${run}@example.test` };
const users = {} as Record<keyof typeof emails, string>;
let idA = '', idB = '', serviceId = '', fast = '', deep = '', month = '';
type Handler = (request: Request, context: never) => Promise<Response>;
async function call(handler: Handler, host: string, cookie: string, query: string, params: Record<string, string> = {}) {
  const response = await handler(new Request(`http://${host}/api/x?${query}`, { headers: { Host: host, Cookie: cookie } }), { params: Promise.resolve(params) } as never);
  const text = await response.text();
  return { status: response.status, type: response.headers.get('content-type'), text, body: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null };
}
const spend = async (workspaceId: string, modelId: string, userId: string, input: number, output: number | null) =>
  settleCall((await reserveCall({ workspaceId, modelId, inputTokens: input, userId, taskId: randomUUID() })).callId, { inputTokens: input, outputTokens: output, outcome: 'ok', elapsedMs: 900 });

before(async () => {
  for (const key of ['HESTIA_ADMIN_HOST', 'HESTIA_SECRET_KEY']) saved[key] = process.env[key];
  process.env.HESTIA_ADMIN_HOST = admin; process.env.HESTIA_SECRET_KEY ||= randomBytes(32).toString('base64');
  for (const key of Object.keys(emails) as (keyof typeof emails)[]) {
    await acceptInvitation((await createInvitation(emails[key])).token, `合成${key}`, password);
    cookies[key] = (await auth.api.signInEmail({ body: { email: emails[key], password }, asResponse: true })).headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
    users[key] = (await pool.query('SELECT id FROM hestia_auth_user WHERE email=$1', [emails[key]])).rows[0].id;
  }
  await grantPlatformAdmin(emails.ops, 'platform');
  idA = (await createWorkspace({ kind: 'enterprise', slug: slugA, name: `用量企业甲-${run}`, adminEmail: emails.adminA })).workspace.id;
  idB = (await createWorkspace({ kind: 'enterprise', slug: slugB, name: `用量企业乙-${run}`, adminEmail: emails.adminB })).workspace.id;
  await setMember({ userId: users.adminA, workspaceId: idA }, idA, { email: emails.memberA, role: 'member' });
  await addWorkspaceDomain(slugA, hostA); await addWorkspaceDomain(slugB, hostB);
  serviceId = (await createService(actor, { name: `用量服务-${run}`, protocol: 'chat', baseUrl: 'https://api.vendor.example.test/v1', apiKey: 'sk-am04-synthetic', timeoutSeconds: 60, concurrency: 50 })).id;
  for (const [name, price] of [['fast', { input: 100, output: 200 }], ['deep', { input: 1000, output: 4000 }]] as const) {
    const model = await enableModel(actor, serviceId, { modelId: `${name}-${run}`, manual: true });
    await updateModel(actor, model.id, { name: name === 'fast' ? '快速修改' : '深度设计', maxOutput: 1000, price });
    await pool.query("UPDATE models SET state='admitted' WHERE id=$1", [model.id]);
    if (name === 'fast') fast = model.id; else deep = model.id;
  }
  for (const [slug, id] of [[slugA, idA], [slugB, idB]] as const) {
    await updateEnterprise(actor, slug, { grants: [fast, deep], quota: null, concurrency: 50 });
    await pool.query('UPDATE workspace_models SET enabled=true WHERE workspace_id=$1', [id]);
  }
  month = (await pool.query("SELECT to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM') AS m")).rows[0].m;
  // A: admin 2 fast calls + 1 deep; member 1 deep, then deep is repriced and the member makes 1 more deep call; 1 unverified fast call.
  await spend(idA, fast, users.adminA, 1_000_000, 500_000);   // 100 + 100 = 200 分
  await spend(idA, fast, users.adminA, 500_000, 0);           // 50 分
  await spend(idA, deep, users.adminA, 100_000, 10_000);      // 100 + 40 = 140 分
  await spend(idA, deep, users.memberA, 100_000, 10_000);     // 140 分
  await updateModel(actor, deep, { price: { input: 2000, output: 8000 } });
  await spend(idA, deep, users.memberA, 100_000, 10_000);     // 200 + 80 = 280 分 at the new price
  await spend(idA, fast, users.memberA, 1_000_000, null);     // unverified: reserved 100 + ceil(1000 × 200 / 1e6) = 101 分
  await spend(idB, fast, users.adminB, 1_000_000, 0);         // B: 100 分
  // A call from another month, and one still in flight: neither is in this month's settled totals.
  const old = await spend(idA, fast, users.adminA, 1_000_000, 0);
  await pool.query("UPDATE model_calls SET month='2025-01' WHERE workspace_id=$1 AND cost_fen=$2 AND input_tokens=1000000 AND output_tokens=0 AND id=(SELECT id FROM model_calls WHERE workspace_id=$1 AND output_tokens=0 ORDER BY started_at DESC LIMIT 1)", [idA, old.costFen]);
  await reserveCall({ workspaceId: idA, modelId: deep, inputTokens: 10, userId: users.adminA });
});
after(async () => {
  for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  try {
    await pool.query('DELETE FROM workspaces WHERE slug=ANY($1)', [[slugA, slugB]]);
    await pool.query('DELETE FROM models WHERE service_id=$1', [serviceId]); await pool.query('DELETE FROM model_services WHERE id=$1', [serviceId]);
    await pool.query('DELETE FROM platform_audit WHERE actor=ANY($1) OR target=ANY($1) OR target LIKE $2', [[...Object.values(emails), actor.email], `%${run}%`]);
    await pool.query('DELETE FROM workspaces WHERE personal_user_id=ANY($1)', [Object.values(users)]);
    await pool.query('DELETE FROM hestia_invitation WHERE email=ANY($1)', [Object.values(emails)]);
    await pool.query('DELETE FROM hestia_auth_user WHERE id=ANY($1)', [Object.values(users)]);
  } finally { await pool.end(); }
});

const pick = (rows: { name: string }[], name: string) => rows.find(r => r.name.startsWith(name)) as Record<string, number | string>;

test('the platform sees every enterprise by enterprise and by model, each call at its own price version', async () => {
  const byWorkspace = await call(adminUsage.GET, admin, cookies.ops, `month=${month}`);
  assert.equal(byWorkspace.status, 200);
  const a = pick(byWorkspace.body.rows, `用量企业甲-${run}`), b = pick(byWorkspace.body.rows, `用量企业乙-${run}`);
  assert.deepEqual([a.calls, a.costFen, a.unverified, a.inputTokens, a.outputTokens], [6, 200 + 50 + 140 + 140 + 280 + 101, 1, 2_800_000, 530_000]);
  assert.deepEqual([b.calls, b.costFen], [1, 100]);
  assert.ok(byWorkspace.body.months.includes('2025-01') && byWorkspace.body.months[0] >= month);
  const byModel = (await call(adminUsage.GET, admin, cookies.ops, `month=${month}&by=model`)).body.rows;
  const deepRow = byModel.find((r: { key: string }) => r.key === deep), fastRow = byModel.find((r: { key: string }) => r.key === fast);
  assert.deepEqual([deepRow.calls, deepRow.costFen, deepRow.name], [3, 560, `深度设计 · deep-${run}`]);
  assert.deepEqual([fastRow.calls, fastRow.costFen, fastRow.unverified], [4, 451, 1]);
  const older = (await call(adminUsage.GET, admin, cookies.ops, 'month=2025-01&by=workspace')).body.rows;
  assert.equal(pick(older, `用量企业甲-${run}`).calls, 1, 'the other month holds its own call');
  assert.equal((await call(adminUsage.GET, admin, cookies.ops, 'month=2025-13')).status, 400);
  assert.equal((await call(adminUsage.GET, admin, cookies.ops, 'by=member')).status, 400);
  assert.equal((await call(adminUsage.GET, admin, cookies.adminA, '')).status, 403);
  assert.equal((await call(adminUsage.GET, hostA, cookies.ops, '')).status, 404, 'not on an enterprise domain');
});

test('the CSV export has the same numbers as the page', async () => {
  const page = (await call(adminUsage.GET, admin, cookies.ops, `month=${month}&by=model`)).body;
  const csv = await call(adminExport.GET, admin, cookies.ops, `month=${month}&by=model`);
  assert.equal(csv.status, 200); assert.match(csv.type ?? '', /^text\/csv/);
  const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], '模型,调用次数,输入 token,输出 token,未核对次数,金额（元）');
  assert.equal(lines.length, page.rows.length + 2);
  assert.equal(lines.at(-1), `合计,${page.total.calls},${page.total.inputTokens},${page.total.outputTokens},${page.total.unverified},${(page.total.costFen / 100).toFixed(2)}`);
  assert.ok(lines.includes(`深度设计 · deep-${run},3,300000,30000,0,5.60`));
  assert.equal((await call(adminExport.GET, admin, cookies.adminA, '')).status, 403);
});

test('the enterprise admin sees only their enterprise, by member or by model; members cannot', async () => {
  const byMember = await call(enterpriseUsageRoute.GET, hostA, cookies.adminA, `month=${month}`, { workspaceId: idA });
  assert.equal(byMember.status, 200);
  assert.deepEqual(byMember.body.rows.map((r: { name: string; calls: number; costFen: number }) => [r.name, r.calls, r.costFen]),
    [['合成memberA', 3, 140 + 280 + 101], ['合成adminA', 3, 200 + 50 + 140]]);
  assert.equal(byMember.body.total.costFen, 911);
  const byModel = (await call(enterpriseUsageRoute.GET, hostA, cookies.adminA, `month=${month}&by=model`, { workspaceId: idA })).body;
  assert.deepEqual(byModel.rows.map((r: { key: string }) => r.key).sort(), [fast, deep].sort());
  assert.equal((await call(enterpriseUsageRoute.GET, hostA, cookies.memberA, '', { workspaceId: idA })).status, 403);
  assert.equal((await call(enterpriseUsageRoute.GET, hostB, cookies.adminB, '', { workspaceId: idA })).status, 404);
  assert.equal((await call(enterpriseUsageRoute.GET, hostA, cookies.adminA, 'by=workspace', { workspaceId: idA })).status, 400);
});
