import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createInvitation } from '../../packages/identity/src/service';
import { pool, transaction } from '../../packages/persistence/src/client';

const origin = new URL(process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000').origin;
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('This fixture test only runs against a local application.');
const runId = randomUUID(), emails = [0, 1].map(n => `http-${runId}-${n}@example.test`);
const password = `synthetic-${randomUUID()}`;
const checks: string[] = [];
let currentCheck = 'startup';
type Client = { cookie: string; userId: string };
async function call(path: string, method = 'GET', payload?: unknown, client?: Client, requestOrigin = origin) {
  return fetch(`${origin}${path}`, { method, headers: {
    ...(payload !== undefined ? { 'Content-Type': 'application/json', Origin: requestOrigin } : {}),
    ...(client ? { Cookie: client.cookie } : {}),
  }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
}
async function expectStatus(response: Response, status: number) {
  // Do not dump bodies/headers on failure: authentication responses may contain bearer tokens.
  assert.equal(response.status, status, `${currentCheck}: unexpected HTTP status`);
  return response;
}
async function check(name: string, work: () => Promise<void>) { currentCheck = name; await work(); checks.push(name); }
async function oversized(path: string, client?: Client) {
  // Streaming upload has no Content-Length; validates the actual byte limit rather than a header check.
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (let i = 0; i < 9; i++) controller.enqueue(new TextEncoder().encode(' '.repeat(8192)));
    controller.close();
  } });
  return fetch(`${origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin,
    ...(client ? { Cookie: client.cookie } : {}) }, body: stream, duplex: 'half', signal: AbortSignal.timeout(30000),
  } as RequestInit & { duplex: 'half' });
}

try {
  await check('anonymous project access is rejected; session is empty', async () => {
    await expectStatus(await call('/api/projects'), 401);
    await expectStatus(await call('/api/projects', 'POST', { operationId: randomUUID(), name: 'Synthetic anonymous', template: 'empty' }), 401);
    assert.equal((await (await call('/api/session')).json()).user, null);
  });
  await check('public registration is disabled', async () => {
    await expectStatus(await call('/api/auth/sign-up/email', 'POST', { email: emails[0], name: 'Synthetic public signup', password }), 400);
  });
  await check('invitation API bounds actual request bytes', async () => { await expectStatus(await oversized('/api/invitations/accept'), 413); });
  await check('authentication API bounds actual request bytes', async () => { await expectStatus(await oversized('/api/auth/sign-in/email'), 413); });
  const clients: Client[] = [];
  await check('two invited users accept invitations and log in through HTTP', async () => {
    for (const email of emails) {
      const invitation = await createInvitation(email);
      const response = await expectStatus(await call('/api/invitations/accept', 'POST', { token: invitation.token, name: 'Synthetic HTTP User', password }), 200);
      assert.equal((await response.json()).email, email);
      await expectStatus(await call('/api/invitations/accept', 'POST', { token: invitation.token, name: 'Again', password }), 400);
      const login = await expectStatus(await call('/api/auth/sign-in/email', 'POST', { email, password }), 200);
      const setCookie = login.headers.getSetCookie();
      assert.ok(setCookie.some(value => /HttpOnly/i.test(value)), 'Session cookie must be HttpOnly');
      const cookie = setCookie.map(value => value.split(';')[0]).join('; ');
      const session = await (await call('/api/session', 'GET', undefined, { cookie, userId: '' })).json();
      assert.equal(session.user.email, email); clients.push({ cookie, userId: session.user.id });
    }
    assert.ok(clients[0].userId !== clients[1].userId, 'Identities must be distinct');
  });
  const [a, b] = clients;
  let projectId = '', secondProjectId = '';
  const createPayload = { name: 'Synthetic courtyard API fixture', template: 'courtyard', operationId: randomUUID() };
  await check('concurrent creation retries produce one persisted project', async () => {
    const responses = await Promise.all([call('/api/projects', 'POST', createPayload, a), call('/api/projects', 'POST', createPayload, a)]);
    for (const response of responses) await expectStatus(response, 201);
    const projects = await Promise.all(responses.map(response => response.json()));
    assert.equal(projects[0].project.id, projects[1].project.id); projectId = projects[0].project.id;
    assert.equal(projects[0].project.synthetic, true); assert.equal(projects[0].project.scale, 'synthetic');
    assert.ok(projects[0].project.scene.walls.length > 0);
    const persisted = await pool.query('SELECT id FROM projects WHERE owner_id=$1', [a.userId]); assert.equal(persisted.rowCount, 1);
    const reopened = await (await expectStatus(await call(`/api/projects/${projectId}`, 'GET', undefined, a), 200)).json();
    assert.deepEqual(reopened.project.scene, projects[0].project.scene);
  });
  await check('operation IDs reject changed payload and remain scoped to each identity', async () => {
    await expectStatus(await call('/api/projects', 'POST', { ...createPayload, name: 'Changed retry' }, a), 409);
    const response = await expectStatus(await call('/api/projects', 'POST', createPayload, b), 201);
    assert.ok((await response.json()).project.id !== projectId);
  });
  await check('strict owner fields, invalid IDs, origin and request sizes are rejected', async () => {
    await expectStatus(await call('/api/projects', 'POST', { ...createPayload, operationId: randomUUID(), ownerId: b.userId }, a), 400);
    await expectStatus(await call(`/api/projects/${projectId}`, 'PATCH', { name: 'Injected', expectedRevision: 1, operationId: randomUUID(), ownerId: b.userId }, a), 400);
    await expectStatus(await call('/api/projects/not-a-uuid', 'GET', undefined, a), 400);
    await expectStatus(await call('/api/projects', 'POST', { ...createPayload, operationId: randomUUID() }, a, 'https://foreign.invalid'), 403);
    await expectStatus(await oversized('/api/projects', a), 413);
  });
  await check('cross-account project reads and writes are denied', async () => {
    await expectStatus(await call(`/api/projects/${projectId}`, 'GET', undefined, b), 404);
    await expectStatus(await call(`/api/projects/${projectId}`, 'PATCH', { name: 'Wrong owner', expectedRevision: 1, operationId: randomUUID() }, b), 404);
    const list = await (await call('/api/projects', 'GET', undefined, b)).json();
    assert.ok(list.projects.every((p: { id: string }) => p.id !== projectId));
  });
  await check('rename commits one revision, retry is idempotent, stale versions conflict', async () => {
    const rename = { name: 'Synthetic saved revision', expectedRevision: 1, operationId: randomUUID() };
    const renamed = await (await expectStatus(await call(`/api/projects/${projectId}`, 'PATCH', rename, a), 200)).json();
    assert.equal(renamed.project.revision, 2); assert.equal(renamed.project.name, rename.name);
    const retry = await (await expectStatus(await call(`/api/projects/${projectId}`, 'PATCH', rename, a), 200)).json();
    assert.equal(retry.project.revision, 2);
    await expectStatus(await call(`/api/projects/${projectId}`, 'PATCH', { ...rename, operationId: randomUUID(), name: 'Stale overwrite' }, a), 409);
    const reopened = await (await call(`/api/projects/${projectId}`, 'GET', undefined, a)).json();
    assert.equal(reopened.project.revision, 2); assert.equal(reopened.project.name, rename.name);
  });
  let resourceId = '';
  await check('resource reservation and reads preserve project scope without exposing object keys', async () => {
    const second = await (await expectStatus(await call('/api/projects', 'POST', { name: 'Synthetic empty fixture', template: 'empty', operationId: randomUUID() }, a), 201)).json();
    secondProjectId = second.project.id; assert.equal(second.project.synthetic, false); assert.equal(second.project.scale, 'missing');
    resourceId = randomUUID(); const resource = { id: resourceId, mediaType: 'image/png' };
    const path = `/api/projects/${projectId}/resources`;
    const response = await expectStatus(await call(path, 'POST', resource, a), 201);
    const reserved = await response.json(); assert.equal(reserved.resource.state, 'pending');
    assert.ok(!('object_key' in reserved.resource) && !('objectKey' in reserved.resource));
    await expectStatus(await call(path, 'POST', resource, a), 201);
    await expectStatus(await call(path, 'POST', { ...resource, mediaType: 'application/pdf' }, a), 409);
    const read = await (await expectStatus(await call(`${path}/${resourceId}`, 'GET', undefined, a), 200)).json();
    assert.equal(read.resource.projectId, projectId);
    await expectStatus(await call(path, 'POST', { id: randomUUID(), mediaType: 'image/png' }, b), 404);
    await expectStatus(await call(`${path}/${resourceId}`, 'GET', undefined, b), 404);
    await expectStatus(await call(`${path}/${resourceId}`), 401);
    await expectStatus(await call(`/api/projects/${secondProjectId}/resources/${resourceId}`, 'GET', undefined, a), 404);
    await expectStatus(await call(`/api/projects/${secondProjectId}/resources`, 'POST', resource, a), 404);
  });
  await check('logout revokes the original cookie without affecting the other identity', async () => {
    await expectStatus(await call('/api/auth/sign-out', 'POST', {}, a), 200);
    await expectStatus(await call(`/api/projects/${projectId}`, 'GET', undefined, a), 401);
    assert.equal((await (await call('/api/session', 'GET', undefined, a)).json()).user, null);
    assert.equal((await (await call('/api/session', 'GET', undefined, b)).json()).user.id, b.userId);
  });
  console.log(JSON.stringify({ evidence: 'real-local-http-and-postgresql', status: 'passed', checks, count: checks.length,
    modelCalls: 0, realUserSamples: 0 }, null, 2));
} catch {
  console.error(JSON.stringify({ status: 'failed', check: currentCheck, passed: checks.length,
    detail: 'Sensitive response details suppressed; inspect the named case locally.' }));
  process.exitCode = 1;
} finally {
  // Discover only this run's randomized identities; preserve all unrelated local development records.
  try {
    await transaction(async client => {
      const users = (await client.query('SELECT id FROM hestia_auth_user WHERE email=ANY($1::text[])', [emails])).rows.map(row => row.id);
      const projectIds = (await client.query('SELECT id FROM projects WHERE owner_id=ANY($1::text[])', [users])).rows.map(row => row.id);
      await client.query('DELETE FROM resources WHERE project_id=ANY($1::uuid[])', [projectIds]);
      await client.query('DELETE FROM project_revisions WHERE project_id=ANY($1::uuid[])', [projectIds]);
      await client.query('DELETE FROM operations WHERE owner_id=ANY($1::text[])', [users]);
      await client.query('DELETE FROM projects WHERE owner_id=ANY($1::text[])', [users]);
      await client.query('DELETE FROM hestia_invitation WHERE email=ANY($1::text[])', [emails]);
      await client.query('DELETE FROM hestia_auth_user WHERE email=ANY($1::text[])', [emails]);
    });
  } finally { await pool.end(); }
}
