import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool, transaction } from '../../persistence/src/client';
import { auth } from '../../identity/src/auth';
import { acceptInvitation, createInvitation } from '../../identity/src/service';
import { mockSmsSender, setSmsSender } from '../../identity/src/sms';
import { addStones } from '../../finishes/src/catalog';
import { demoStones } from '../../finishes/src/demo-stones';
import { initializeRenderQueue } from '../../renders/src/queue';
import { createWorkspace } from './service';
import { addWorkspaceDomain } from './domains';
import { deleteWorkspace } from './data';

// M06 (ADR-0017): cross-enterprise isolation matrix. Every API route that can name another enterprise's data is
// called on enterprise A's domain by A's member, A's customer and an anonymous visitor, once with enterprise B's
// real identifiers and once with identifiers that do not exist. No call may succeed, and the two answers must be
// the same, so A cannot even learn that B's data exists. A route not listed here fails the coverage check.

const run = randomUUID().slice(0, 8), slugA = `m06a-${run}`, slugB = `m06b-${run}`, hostA = `${slugA}.example.test`, hostB = `${slugB}.example.test`;
const password = 'synthetic-m06-password-482!', emails = [`m06-a-${run}@example.test`, `m06-b-${run}@example.test`], phones: string[] = [];
const apiRoot = fileURLToPath(new URL('../../../apps/web/app/api/', import.meta.url));
// Routes that take no identifier of another enterprise: own session, own account, public catalogs, sign-in.
const NO_FOREIGN_TARGET = new Set(['auth/[...all]', 'catalog', 'credits', 'invitations/accept', 'projects', 'register', 'session', 'styles/catalog', 'workspaces']);
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

type Actor = { name: string; cookie: string };
let actors: Actor[] = [], ownerB: Actor;
let real: Record<string, string> = {}, missing: Record<string, string> = {};
const cookieOf = (response: Response) => response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
const ip = () => `10.4.${randomInt(0, 255)}.${randomInt(1, 255)}`;

async function routes(dir = apiRoot): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await routes(full));
    else if (entry.name === 'route.ts') found.push(path.relative(apiRoot, dir).split(path.sep).join('/'));
  }
  return found.sort();
}
const paramsOf = (route: string, values: Record<string, string>) => Object.fromEntries(
  [...route.matchAll(/\[([A-Za-z]+)\]/g)].map(([, name]) => {
    if (!(name in values)) throw new Error(`No matrix value for [${name}] in ${route}`);
    return [name, values[name]];
  }));
async function call(handler: (request: Request, context: never) => Promise<Response>, method: string, actor: Actor, params: Record<string, string>, host = hostA) {
  const headers: Record<string, string> = { Host: host, Origin: `http://${host}`, 'X-Real-IP': ip() };
  if (actor.cookie) headers.Cookie = actor.cookie;
  const hasBody = method !== 'GET' && method !== 'DELETE';
  if (hasBody) headers['Content-Type'] = 'application/json';
  const response = await handler(new Request(`http://${host}/api/matrix`, { method, headers, body: hasBody ? JSON.stringify({ operationId: randomUUID() }) : undefined }),
    { params: Promise.resolve(params) } as never);
  const body = response.headers.get('content-type')?.includes('json') ? await response.json().catch(() => null) : null;
  await response.body?.cancel().catch(() => {});
  return { status: response.status, code: (body?.error?.code as string | undefined) ?? null };
}

async function signInCustomer(host: string, entry: string) {
  const phoneNumber = `199${String(randomInt(0, 1e8)).padStart(8, '0')}`; phones.push(`+86${phoneNumber}`);
  const { POST } = await import('../../../apps/web/app/api/auth/[...all]/route');
  const post = (p: string, body: unknown) => POST(new Request(`http://${host}/api/auth/${p}`, { method: 'POST', body: JSON.stringify(body),
    headers: { Host: host, Origin: `http://${host}`, 'Content-Type': 'application/json', 'X-Real-IP': ip() } }));
  const code = (await (await post('phone/send-code', { phoneNumber, entry })).json()).demoCode;
  return cookieOf(await post('phone/sign-in', { phoneNumber, entry, code }));
}
async function member(email: string) {
  await acceptInvitation((await createInvitation(email)).token, '合成成员', password);
  return cookieOf(await auth.api.signInEmail({ body: { email, password }, asResponse: true }));
}

before(async () => {
  process.env.HESTIA_OTP_SOURCE_HEADER = 'x-real-ip';
  setSmsSender(mockSmsSender);
  await initializeRenderQueue();
  const [memberA, memberB] = [await member(emails[0]), await member(emails[1])];
  ownerB = { name: "B's member", cookie: memberB };
  const idA = (await createWorkspace({ kind: 'enterprise', slug: slugA, name: '矩阵企业甲', adminEmail: emails[0] })).workspace.id;
  const idB = (await createWorkspace({ kind: 'enterprise', slug: slugB, name: '矩阵企业乙', adminEmail: emails[1] })).workspace.id;
  for (const id of [idA, idB]) await transaction(client => addStones(client, id, demoStones));
  await addWorkspaceDomain(slugA, hostA); await addWorkspaceDomain(slugB, hostB);
  // B's data: a preset scheme with a share, made by B's member on B's domain.
  const leads = await import('../../../apps/web/app/api/workspaces/[workspaceId]/leads/route');
  const shares = await import('../../../apps/web/app/api/workspaces/[workspaceId]/leads/[requestId]/shares/route');
  const asB = (body: unknown) => new Request(`http://${hostB}/api/x`, { method: 'POST', body: JSON.stringify(body),
    headers: { Host: hostB, Origin: `http://${hostB}`, Cookie: memberB, 'Content-Type': 'application/json' } });
  const lead = (await (await leads.POST(asB({ operationId: randomUUID(), name: '乙的方案', finishIds: ['finish-f1-living-floor', 'finish-f1-stair'],
    stones: [{ stoneId: 'demo-white-marble', stoneVersion: 1 }, { stoneId: 'demo-beige-marble', stoneVersion: 1 }] }), { params: Promise.resolve({ workspaceId: idB }) } as never)).json()).lead;
  assert.ok(lead?.id, 'B has a lead');
  const share = await (await shares.POST(asB({ operationId: randomUUID() }), { params: Promise.resolve({ workspaceId: idB, requestId: lead.id }) } as never)).json();
  assert.ok(share.code, 'B has a share code');
  const userB = (await pool.query('SELECT id FROM hestia_auth_user WHERE email=$1', [emails[1]])).rows[0].id;
  real = { entry: slugB, slug: slugB, workspaceId: idB, requestId: lead.id, schemeId: lead.schemes[0].id, code: share.code, shareId: share.share.id,
    userId: userB, id: lead.projectId ?? (await pool.query('SELECT project_id FROM finish_requests WHERE id=$1', [lead.id])).rows[0].project_id,
    applicationId: randomUUID(), candidateId: randomUUID(), operationId: randomUUID(), taskId: randomUUID(), importId: randomUUID(), renderId: lead.schemes[0].render.id, resourceId: randomUUID() };
  missing = Object.fromEntries(Object.entries(real).map(([k]) => [k, k === 'entry' || k === 'slug' ? `m06-missing-${run}` : k === 'code' ? 'ABCD-EFGH' : randomUUID()]));
  actors = [{ name: "A's member", cookie: memberA }, { name: "A's customer", cookie: await signInCustomer(hostA, slugA) }, { name: 'anonymous', cookie: '' }];
});
after(async () => {
  try {
    for (const slug of [slugA, slugB]) await deleteWorkspace(slug, slug).catch(e => { if (e.code !== 'NOT_FOUND') throw e; });
    const users = (await pool.query('SELECT id FROM hestia_auth_user WHERE email=ANY($1)', [emails])).rows.map(r => r.id);
    await pool.query('DELETE FROM workspaces WHERE personal_user_id=ANY($1)', [users]);
    await pool.query('DELETE FROM phone_otp_challenges WHERE phone_number=ANY($1)', [phones]);
    await pool.query('DELETE FROM hestia_invitation WHERE email=ANY($1)', [emails]);
    await pool.query('DELETE FROM hestia_auth_user WHERE id=ANY($1)', [users]);
  } finally { await pool.end(); }
});

test('every API route is either in the isolation matrix or takes no identifier of another enterprise', async () => {
  const all = await routes(), targeted = all.filter(r => !NO_FOREIGN_TARGET.has(r));
  assert.deepEqual([...NO_FOREIGN_TARGET].filter(r => !all.includes(r)), [], 'allow-list names only existing routes');
  for (const route of targeted) paramsOf(route, real);
  assert.ok(targeted.length > 50, `${targeted.length} routes in the matrix`);
});

test("on A's domain no actor reaches B's data, and B's data answers exactly like data that does not exist", async () => {
  // Control: the same harness does reach B's data for B's member on B's domain, so a leak would show.
  const leadsRoute = await import('../../../apps/web/app/api/workspaces/[workspaceId]/leads/route');
  const shareRoute = await import('../../../apps/web/app/api/share/[code]/route');
  assert.equal((await call(leadsRoute.GET, 'GET', ownerB, { workspaceId: real.workspaceId }, hostB)).status, 200);
  assert.equal((await call(shareRoute.GET, 'GET', actors[2], { code: real.code }, hostB)).status, 200);
  const failures: string[] = [], seen = new Map<string, number>();
  for (const route of (await routes()).filter(r => !NO_FOREIGN_TARGET.has(r))) {
    const module = await import(pathToFileURL(path.join(apiRoot, route, 'route.ts')).href) as Record<string, unknown>;
    for (const method of METHODS) {
      const handler = module[method] as ((request: Request, context: never) => Promise<Response>) | undefined;
      if (typeof handler !== 'function') continue;
      for (const actor of actors) {
        const [toB, toNothing] = [await call(handler, method, actor, paramsOf(route, real)), await call(handler, method, actor, paramsOf(route, missing))];
        const where = `${method} /api/${route} as ${actor.name}`, key = `${toB.status} ${toB.code}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        if (toB.status < 400) failures.push(`${where}: B's data answered ${toB.status}`);
        else if (toB.status !== toNothing.status || toB.code !== toNothing.code)
          failures.push(`${where}: B's data ${toB.status} ${toB.code} vs missing ${toNothing.status} ${toNothing.code}`);
      }
    }
  }
  assert.deepEqual(failures, []);
  // Refusals come from access checks, not from the request being malformed or from another origin.
  assert.equal(seen.get('403 ORIGIN_REJECTED') ?? 0, 0, JSON.stringify(Object.fromEntries(seen)));
  console.log('isolation matrix answers', Object.fromEntries(seen));
});
