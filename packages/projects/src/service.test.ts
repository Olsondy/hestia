import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pool } from '../../persistence/src/client';
import { createProject, getProject, listProjects, renameProject, getResource, reserveResource } from './service';

const a = { userId: `test-project-a-${randomUUID()}` }, b = { userId: `test-project-b-${randomUUID()}` };
after(async () => {
  // Delete only the records created by these random test identities.
  await pool.query('DELETE FROM resources WHERE project_id IN (SELECT id FROM projects WHERE owner_id=ANY($1))', [[a.userId, b.userId]]);
  await pool.query('DELETE FROM operations WHERE owner_id=ANY($1)', [[a.userId, b.userId]]);
  await pool.query('DELETE FROM project_revisions WHERE project_id IN (SELECT id FROM projects WHERE owner_id=ANY($1))', [[a.userId, b.userId]]);
  await pool.query('DELETE FROM projects WHERE owner_id=ANY($1)', [[a.userId, b.userId]]);
  await pool.end();
});
test('concurrent creation retries persist one project, reopening from DB preserves fixed facts separately', async () => {
  const input = { name: '合成隔离验证', template: 'angled', operationId: randomUUID() };
  const results = await Promise.all(Array.from({ length: 5 }, () => createProject(a, input)));
  assert.equal(new Set(results.map(r => r.id)).size, 1);
  const reopened = await getProject(a, results[0].id);
  assert.deepEqual(reopened, results[0]);
  assert.equal(reopened.synthetic, true);
  assert.equal(reopened.scale, 'synthetic');
  assert.ok(reopened.scene.objects.some(o => o.kind === 'fixed'));
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    `import { getProject } from './packages/projects/src/service.ts'; import { pool } from './packages/persistence/src/client.ts';
     try { console.log(JSON.stringify(await getProject({userId:process.argv[1]},process.argv[2]))); } finally { await pool.end(); }`,
    a.userId, reopened.id], { encoding: 'utf8', env: process.env });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), reopened, 'a new Node process reads the same committed state');
  assert.equal((await listProjects(b)).length, 0);
  await assert.rejects(createProject(a, { ...input, name: 'different' }), { code: 'IDEMPOTENCY_CONFLICT' });
});
test('two identities cannot directly read or mutate each other’s project or resource references', async () => {
  const one = await createProject(a, { name: 'A', template: 'courtyard', operationId: randomUUID() });
  const two = await createProject(b, { name: 'B', template: 'empty', operationId: randomUUID() });
  await assert.rejects(getProject(b, one.id), { code: 'NOT_FOUND' });
  await assert.rejects(renameProject(b, one.id, { name: 'stolen', expectedRevision: 1, operationId: randomUUID() }), { code: 'NOT_FOUND' });
  const fileId = randomUUID();
  await pool.query("INSERT INTO resources(id,project_id,object_key,media_type,state) VALUES($1,$2,$3,'image/png','ready')", [fileId, one.id, randomUUID()]);
  assert.equal((await getResource(a, one.id, fileId)).id, fileId);
  await assert.rejects(getResource(b, one.id, fileId), { code: 'NOT_FOUND' });
  await assert.rejects(getResource(b, two.id, fileId), { code: 'NOT_FOUND' });
  await assert.rejects(reserveResource(b, one.id, { id: randomUUID(), mediaType: 'image/png' }), { code: 'NOT_FOUND' });
  await assert.rejects(reserveResource(b, two.id, { id: fileId, mediaType: 'image/png' }), { code: 'NOT_FOUND' });
  const pending = await reserveResource(a, one.id, { id: randomUUID(), mediaType: 'image/png' });
  assert.equal(pending.state, 'pending');
  assert.equal((await getProject(a, one.id)).name, 'A');
});
test('renaming is revision checked, atomic and retry safe; an empty project contains no synthetic geometry', async () => {
  const project = await createProject(a, { name: '空白', template: 'empty', operationId: randomUUID() });
  assert.equal(project.synthetic, false);
  assert.equal(project.scene.objects.length, 0);
  const request = { name: '重命名', expectedRevision: 1, operationId: randomUUID() };
  const renamed = await renameProject(a, project.id, request);
  assert.equal(renamed.revision, 2);
  assert.deepEqual(await renameProject(a, project.id, request), renamed);
  await assert.rejects(renameProject(a, project.id, { ...request, name: '旧请求', operationId: randomUUID() }), { code: 'REVISION_CONFLICT' });
  assert.equal((await getProject(a, project.id)).revision, 2);
  assert.equal((await pool.query('SELECT * FROM project_revisions WHERE project_id=$1', [project.id])).rowCount, 2);
});
