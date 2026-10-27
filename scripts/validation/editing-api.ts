import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createInvitation } from '../../packages/identity/src/service';
import { pool, transaction } from '../../packages/persistence/src/client';
import type { Command } from '../../packages/contracts/src/commands';

const origin = new URL(process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000').origin;
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Only local synthetic validation is allowed.');
const emails = [0, 1].map(i => `editing-${randomUUID()}-${i}@example.test`), password = `synthetic-${randomUUID()}`;
const checks: string[] = []; let current = 'setup', projectId = '', cookie = '', otherCookie = '';
async function call(path: string, method = 'GET', payload?: unknown, selectedCookie = cookie) {
  return fetch(`${origin}${path}`, { method, headers: { ...(selectedCookie ? { Cookie: selectedCookie } : {}),
    ...(payload === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }) },
    body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
}
async function status(response: Response, expected = 200) { assert.equal(response.status, expected, `${current}: HTTP status`); return response.json(); }
async function check(name: string, work: () => Promise<void>) { current = name; await work(); checks.push(name); }
const input = (revision: number, command: Command) => ({ operationId: randomUUID(), expectedRevision: revision, command });
const move = (x: number, z: number, objectId = 'sofa-a', yaw = 0): Command => ({ type: 'move-furniture', x, z, yaw, objectId });
const endpoint = () => `/api/projects/${projectId}/commands`;
async function databaseState() {
  return { project: (await pool.query('SELECT snapshot,revision FROM projects WHERE id=$1', [projectId])).rows[0],
    revisions: (await pool.query('SELECT revision FROM project_revisions WHERE project_id=$1 ORDER BY revision', [projectId])).rows,
    operations: (await pool.query('SELECT id FROM operations WHERE project_id=$1 ORDER BY id', [projectId])).rows,
    commands: (await pool.query('SELECT operation_id,undone_by FROM project_commands WHERE project_id=$1 ORDER BY operation_id', [projectId])).rows };
}
try {
  for (const [i, email] of emails.entries()) {
    current = `setup invitation ${i + 1}`;
    const invitation = await createInvitation(email);
    current = `setup accept ${i + 1}`;
    await status(await call('/api/invitations/accept', 'POST', { token: invitation.token, name: 'Synthetic editing test', password }, ''));
    current = `setup login ${i + 1}`;
    const login = await call('/api/auth/sign-in/email', 'POST', { email, password }, ''); assert.equal(login.status, 200);
    const value = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    if (i === 0) cookie = value; else otherCookie = value;
  }
  current = 'setup project';
  const created = await status(await call('/api/projects', 'POST', { name: '合成家具编辑 HTTP 验证', template: 'courtyard', operationId: randomUUID() }), 201);
  projectId = created.project.id;
  await check('anonymous and cross-account command access is rejected', async () => {
    await status(await call(endpoint(), 'GET', undefined, ''), 401);
    await status(await call(endpoint(), 'GET', undefined, otherCookie), 404);
    await status(await call(endpoint(), 'POST', input(1, move(4, 1.2)), otherCookie), 404);
  });
  await check('fixed facts, extra fields and invalid values cannot modify project/history', async () => {
    const before = await databaseState();
    for (const payload of [input(1, move(1, 1, 'fixed-a')), input(1, move(NaN, 1)),
      { ...input(1, move(4, 1.2)), ownerId: 'fake-owner' },
      { ...input(1, move(4, 1.2)), command: { ...move(4, 1.2), size: { width: .1 } } }]) await status(await call(endpoint(), 'POST', payload), 400);
    assert.deepEqual(await databaseState(), before);
  });
  await check('boundary, wall, fixed and furniture collision failures include object-local issues', async () => {
    const before = await databaseState();
    for (const [command, code] of [[move(10, 2), 'OUT_OF_BOUNDS'], [move(3, .1), 'WALL_COLLISION'],
      [move(.45, .7), 'FIXED_COLLISION'], [move(3, 3), 'FURNITURE_COLLISION']] as const) {
      const rejected = await status(await call(endpoint(), 'POST', input(1, command)), 400);
      assert.equal(rejected.error.code, 'PLACEMENT_REJECTED');
      assert.ok(rejected.error.details.issues.some((i: { code: string; objectId: string }) => i.code === code && i.objectId === 'sofa-a'));
    }
    assert.deepEqual(await databaseState(), before);
  });
  let firstOperation = '';
  await check('concurrent identical move/rotation applies exactly one persisted revision', async () => {
    const request = input(1, move(4, 1.2, 'sofa-a', .1)); firstOperation = request.operationId;
    const results = await Promise.all([call(endpoint(), 'POST', request), call(endpoint(), 'POST', request)]);
    for (const response of results) {
      const saved = await status(response); assert.equal(saved.project.revision, 2); assert.equal(saved.operation.revision, 2);
      const object = saved.project.scene.objects.find((o: { id: string }) => o.id === 'sofa-a'); assert.equal(object.position.x, 4); assert.equal(object.yaw, .1);
    }
    assert.equal((await databaseState()).commands.length, 1);
    await status(await call(endpoint(), 'POST', { ...request, command: move(3.5, 1.2) }), 409);
    const reopened = await status(await call(`/api/projects/${projectId}`)); assert.equal(reopened.project.revision, 2);
    const history = await status(await call(endpoint())); assert.equal(history.operations[0].id, firstOperation); assert.equal(history.operations[0].undoable, true);
    assert.ok(!('before_value' in history.operations[0]));
  });
  let laterOperation = '';
  await check('competing expected revisions allow one result; stale dependent undo is rejected', async () => {
    const a = input(2, move(4, 1.4)), b = input(2, move(4, 1.6));
    const responses = await Promise.all([call(endpoint(), 'POST', a), call(endpoint(), 'POST', b)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const accepted = await responses.find(r => r.status === 200)!.json(); laterOperation = accepted.operation.id;
    const before = await databaseState();
    const rejected = await status(await call(endpoint(), 'POST', input(3, { type: 'undo', targetOperationId: firstOperation })), 409);
    assert.equal(rejected.error.code, 'UNDO_DEPENDENCY'); assert.deepEqual(await databaseState(), before);
  });
  await check('undo is a new revision, retries are stable, and reverse order restores original pose', async () => {
    const undo = input(3, { type: 'undo', targetOperationId: laterOperation });
    assert.equal((await status(await call(endpoint(), 'POST', undo))).project.revision, 4);
    assert.equal((await status(await call(endpoint(), 'POST', undo))).project.revision, 4);
    await status(await call(endpoint(), 'POST', input(4, { type: 'undo', targetOperationId: laterOperation })), 409);
    const restored = await status(await call(endpoint(), 'POST', input(4, { type: 'undo', targetOperationId: firstOperation })));
    assert.equal(restored.project.revision, 5);
    const object = restored.project.scene.objects.find((o: { id: string }) => o.id === 'sofa-a');
    assert.equal(object.position.x, 3); assert.equal(object.position.z, 1.2); assert.equal(object.yaw, 0);
    assert.equal((await databaseState()).revisions.length, 5);
  });
  await check('lock/unlock persists and prevents editing without partial operations', async () => {
    const locked = await status(await call(endpoint(), 'POST', input(5, { type: 'set-lock', objectId: 'sofa-a', locked: true })));
    assert.deepEqual(locked.project.lockedObjectIds, ['sofa-a']); const before = await databaseState();
    const rejection = await status(await call(endpoint(), 'POST', input(6, move(4, 1.2))), 400); assert.equal(rejection.error.code, 'OBJECT_LOCKED');
    assert.deepEqual(await databaseState(), before);
    const unlocked = await status(await call(endpoint(), 'POST', input(6, { type: 'set-lock', objectId: 'sofa-a', locked: false })));
    assert.deepEqual(unlocked.project.lockedObjectIds, []); assert.equal(unlocked.project.revision, 7);
  });
  console.log(JSON.stringify({ evidence: 'real-local-http-and-postgresql', status: 'passed', count: checks.length, checks, modelCalls: 0, realUserSamples: 0 }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', check: current, passed: checks.length,
    ...(error instanceof assert.AssertionError && typeof error.actual === 'number' ? { actual: error.actual, expected: error.expected } : {}),
    errorType: error instanceof Error ? error.name : 'unknown', detail: 'Sensitive response details suppressed.' })); process.exitCode = 1;
} finally {
  try {
    await transaction(async client => {
      const users = (await client.query('SELECT id FROM hestia_auth_user WHERE email=ANY($1::text[])', [emails])).rows.map(r => r.id);
      const projects = (await client.query('SELECT id FROM projects WHERE created_by=ANY($1::text[])', [users])).rows.map(r => r.id);
      await client.query('DELETE FROM operations WHERE actor_id=ANY($1::text[])', [users]); // command rows cascade
      await client.query('DELETE FROM resources WHERE project_id=ANY($1::uuid[])', [projects]);
      await client.query('DELETE FROM project_revisions WHERE project_id=ANY($1::uuid[])', [projects]);
      await client.query('DELETE FROM projects WHERE created_by=ANY($1::text[])', [users]);
      await client.query('DELETE FROM hestia_invitation WHERE email=ANY($1::text[])', [emails]);
      await client.query('DELETE FROM hestia_auth_user WHERE email=ANY($1::text[])', [emails]);
    });
  } finally { await pool.end(); }
}
