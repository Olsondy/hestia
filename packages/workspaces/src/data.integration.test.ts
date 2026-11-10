import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { pool, transaction } from '../../persistence/src/client';
import { auth } from '../../identity/src/auth';
import { acceptInvitation, createInvitation } from '../../identity/src/service';
import { mockSmsSender, setSmsSender } from '../../identity/src/sms';
import { LocalPrivateFileStore } from '../../files/src/storage';
import { addStones } from '../../finishes/src/catalog';
import { demoStones } from '../../finishes/src/demo-stones';
import { initializeRenderQueue, RENDER_SCHEMA } from '../../renders/src/queue';
import { runRender } from '../../renders/src/runner';
import { createWorkspace } from './service';
import { deleteWorkspace, exportWorkspace, migrateFileKeys } from './data';
import * as authRoute from '../../../apps/web/app/api/auth/[...all]/route';
import * as leadsRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/leads/route';
import { authOrigin } from '../../identity/src/origins';

// M04 (ADR-0017): one enterprise's data and files are exported and deleted together, and nothing of another
// enterprise is touched. Real PostgreSQL, the real render runner with an injected PNG, a temporary file store.
const run = randomUUID().slice(0, 8), slugA = `m04a-${run}`, slugB = `m04b-${run}`, password = 'synthetic-m04-password-482!';
const adminEmail = `m04-admin-${run}@example.test`, phones: string[] = [];
let idA = '', idB = '', adminCookie = '', root = '', store: LocalPrivateFileStore, png: Buffer;
const work = { a: { customer: '' }, b: { customer: '' } };
const cookieOf = (response: Response) => response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
const ip = () => `10.5.${randomInt(0, 255)}.${randomInt(1, 255)}`;
async function customer(entry: string, phoneNumber: string) {
  const post = (p: string, body: unknown) => authRoute.POST(new Request(`${authOrigin}/api/auth/${p}`, { method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: authOrigin, 'X-Real-IP': ip() } }));
  const code = (await (await post('phone/send-code', { phoneNumber, entry })).json()).demoCode;
  return (await (await post('phone/sign-in', { phoneNumber, entry, code })).json()).user.id as string;
}
async function presetScheme(workspaceId: string) {
  const response = await leadsRoute.POST(new Request(`${authOrigin}/api/test`, { method: 'POST', headers: { Origin: authOrigin, Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationId: randomUUID(), name: '合成导出方案', finishIds: ['finish-f1-living-floor', 'finish-f1-stair'],
      stones: [{ stoneId: 'demo-white-marble', stoneVersion: 1 }, { stoneId: 'demo-beige-marble', stoneVersion: 1 }] }) }),
  { params: Promise.resolve({ workspaceId }) } as never);
  const lead = (await response.json()).lead;
  assert.equal(response.status, 201, JSON.stringify(lead));
  await runRender(lead.schemes[0].render.id, { store, render: async () => png });
  return lead;
}
const count = async (sql: string, values: unknown[]) => (await pool.query(sql, values)).rows[0].n as number;
const filesUnder = async (dir: string) => (await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => [])).filter(e => e.isFile()).length;

before(async () => {
  process.env.HESTIA_OTP_SOURCE_HEADER = 'x-real-ip';
  setSmsSender(mockSmsSender);
  await initializeRenderQueue();
  root = await mkdtemp(path.join(os.tmpdir(), 'hestia-m04-')); store = new LocalPrivateFileStore(path.join(root, 'store'));
  png = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#ccc' } }).png().toBuffer();
  await acceptInvitation((await createInvitation(adminEmail)).token, '合成导出管理员', password);
  adminCookie = cookieOf(await auth.api.signInEmail({ body: { email: adminEmail, password }, asResponse: true }));
  idA = (await createWorkspace({ kind: 'enterprise', slug: slugA, name: '导出企业甲', adminEmail })).workspace.id;
  idB = (await createWorkspace({ kind: 'enterprise', slug: slugB, name: '导出企业乙', adminEmail })).workspace.id;
  for (const id of [idA, idB]) await transaction(client => addStones(client, id, demoStones));
  const number = `199${String(randomInt(0, 1e8)).padStart(8, '0')}`; phones.push(`+86${number}`);
  work.a.customer = await customer(slugA, number); work.b.customer = await customer(slugB, number);
  await presetScheme(idA); await presetScheme(idB);
});
after(async () => {
  try {
    const users = (await pool.query('SELECT id FROM hestia_auth_user WHERE phone_number=ANY($1) OR email=$2', [phones, adminEmail])).rows.map(r => r.id);
    for (const slug of [slugA, slugB]) await deleteWorkspace(slug, slug, store).catch(e => { if (e.code !== 'NOT_FOUND') throw e; });
    await pool.query('DELETE FROM workspaces WHERE personal_user_id=ANY($1)', [users]);
    await pool.query('DELETE FROM phone_otp_challenges WHERE phone_number=ANY($1)', [phones]);
    await pool.query('DELETE FROM hestia_invitation WHERE email=$1', [adminEmail]);
    await pool.query('DELETE FROM hestia_auth_user WHERE id=ANY($1)', [users]);
    await rm(root, { recursive: true, force: true });
  } finally { await pool.end(); }
});

test('new files are stored under their workspace; files from before are moved there, once', async () => {
  const { rows: [file] } = await pool.query(`SELECT r.id, r.object_key, r.project_id FROM resources r JOIN projects p ON p.id = r.project_id
    WHERE p.workspace_id = $1 AND r.state = 'ready' LIMIT 1`, [idA]);
  assert.ok(file.object_key.startsWith(`workspaces/${idA}/projects/${file.project_id}/resources/`), file.object_key);
  // Put it back where a pre-M04 deployment would have written it.
  const legacy = `projects/${file.project_id}/resources/${file.id}.png`;
  await store.put(legacy, await store.read(file.object_key)); await store.remove(file.object_key);
  await pool.query('UPDATE resources SET object_key=$1 WHERE id=$2', [legacy, file.id]);
  const first = await migrateFileKeys(store);
  assert.ok(first.moved >= 1);
  assert.equal((await pool.query('SELECT object_key FROM resources WHERE id=$1', [file.id])).rows[0].object_key, file.object_key);
  assert.equal((await store.read(file.object_key)).length, png.length);
  await assert.rejects(store.read(legacy), { code: 'ENOENT' });
  assert.equal((await migrateFileKeys(store)).moved, 0, 'a second run moves nothing');
});

test('an export holds the enterprise\'s rows, people and files, nothing of another enterprise and no secrets', async () => {
  const target = path.join(root, 'export-a'), manifest = await exportWorkspace(slugA, target, store);
  assert.equal(manifest.workspace.slug, slugA);
  for (const table of ['workspaces', 'workspace_members', 'workspace_customers', 'workspace_stones', 'projects', 'finish_requests', 'finish_schemes', 'project_renders', 'resources'])
    assert.ok(manifest.tables[table]?.rows > 0, `${table} exported`);
  for (const secret of ['hestia_auth_session', 'hestia_auth_account', 'phone_otp_challenges', 'hestia_invitation', 'credit_ledger'])
    assert.equal(manifest.tables[secret], undefined, `${secret} is never exported`);
  const people = JSON.parse(await readFile(path.join(target, 'tables', 'hestia_auth_user.json'), 'utf8')) as { id: string; email: string | null }[];
  assert.ok(people.some(p => p.id === work.a.customer)); assert.ok(people.some(p => p.email === adminEmail));
  assert.ok(!people.some(p => p.id === work.b.customer), "B's customer with the same number is not A's");
  // Not one value of the other enterprise appears anywhere in the export.
  for (const name of await readdir(path.join(target, 'tables'))) {
    const body = await readFile(path.join(target, 'tables', name), 'utf8'), sums = manifest.tables[name.replace('.json', '')];
    assert.ok(!body.includes(idB) && !body.includes(work.b.customer), `${name} has nothing of B`);
    assert.equal(sums.rows, JSON.parse(body).length);
  }
  assert.ok(manifest.files.length > 0); assert.deepEqual(manifest.missingFiles, []);
  assert.equal(await filesUnder(path.join(target, 'files')), manifest.files.length);
  assert.ok(manifest.files.every(f => f.key.startsWith(`workspaces/${idA}/`)));
  await assert.rejects(exportWorkspace(slugA, target, store), { code: 'EXPORT_TARGET_NOT_EMPTY' });
  await assert.rejects(exportWorkspace('m04-missing', path.join(root, 'export-missing'), store), { code: 'NOT_FOUND' });
});

test('deleting an enterprise removes its rows, jobs, customer accounts and files; another enterprise and members stay', async () => {
  const before = { projects: await count('SELECT count(*)::int AS n FROM projects WHERE workspace_id=$1', [idB]),
    requests: await count('SELECT count(*)::int AS n FROM finish_requests WHERE workspace_id=$1', [idB]),
    files: await filesUnder(path.join(root, 'store', 'workspaces', idB)) };
  assert.ok(before.files > 0);
  await assert.rejects(deleteWorkspace(slugA, slugB, store), { code: 'CONFIRMATION_REQUIRED' });
  // A's other scheme renders are still waiting in the queue: deletion takes their jobs too.
  assert.ok(await count(`SELECT count(*)::int AS n FROM ${RENDER_SCHEMA}.job WHERE group_id=$1`, [idA]) > 0);
  const result = await deleteWorkspace(slugA, slugA, store);
  assert.equal(result.rows.workspaces, 1); assert.ok(result.rows.projects > 0); assert.ok(result.files > 0); assert.deepEqual(result.missingFiles, []);
  assert.equal(result.rows.hestia_auth_user, 1, 'the one customer account of A');
  assert.equal(await count('SELECT count(*)::int AS n FROM workspaces WHERE id=$1', [idA]), 0);
  assert.equal(await count("SELECT count(*)::int AS n FROM projects WHERE workspace_id=$1", [idA]), 0);
  assert.equal(await count('SELECT count(*)::int AS n FROM hestia_auth_user WHERE id=$1', [work.a.customer]), 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM ${RENDER_SCHEMA}.job WHERE group_id=$1`, [idA]), 0);
  assert.equal(await filesUnder(path.join(root, 'store', 'workspaces', idA)), 0);
  // B and the member's platform account are untouched.
  assert.equal(await count('SELECT count(*)::int AS n FROM hestia_auth_user WHERE email=$1', [adminEmail]), 1);
  assert.equal(await count('SELECT count(*)::int AS n FROM hestia_auth_user WHERE id=$1', [work.b.customer]), 1);
  assert.equal(await count('SELECT count(*)::int AS n FROM projects WHERE workspace_id=$1', [idB]), before.projects);
  assert.equal(await count('SELECT count(*)::int AS n FROM finish_requests WHERE workspace_id=$1', [idB]), before.requests);
  assert.equal(await filesUnder(path.join(root, 'store', 'workspaces', idB)), before.files);
  await assert.rejects(deleteWorkspace(slugA, slugA, store), { code: 'NOT_FOUND' });
});
