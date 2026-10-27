import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rmdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import type { PgBoss } from 'pg-boss';
import { pool } from '../../persistence/src/client';
import { createProject, getProject } from '../../projects/src/service';
import { executeCommand } from '../../commands/src/service';
import { createCandidate, getCandidate } from '../../candidates/src/service';
import { LocalPrivateFileStore, type PrivateFileStore } from '../../files/src/storage';
import { createRender, getRender, listRenders, readRender } from './service';
import { claimRender, publishRender, runRender } from './runner';
import { createRenderQueue, initializeRenderQueue, RENDER_QUEUE } from './queue';
import { labelPng } from './image';
import { artifactLabel } from './label';
import { bytesHash } from './versions';

const owner = { userId: `renders-${randomUUID()}` }, other = { userId: `renders-${randomUUID()}` };
const schema = `render_test_${randomUUID().replaceAll('-', '')}`;
let boss: PgBoss, store: LocalPrivateFileStore, directory: string, png: Buffer;
const create = () => createProject(owner, { name: '合成静态图验证', template: 'courtyard', operationId: randomUUID() });
const request = (revision = 1) => ({ operationId: randomUUID(), source: { kind: 'current', revision } });
const renderer = async () => png;
before(async () => {
  boss = await initializeRenderQueue(schema); directory = await mkdtemp(path.join(os.tmpdir(), 'hestia-render-test-')); store = new LocalPrivateFileStore(directory);
  png = await sharp({ create: { width: 1280, height: 80, channels: 4, background: '#b2bca0' } }).png().toBuffer();
});
after(async () => {
  const files = (await pool.query('SELECT s.object_key FROM resources s JOIN projects p ON p.id=s.project_id WHERE p.owner_id=$1', [owner.userId])).rows;
  for (const file of files) await store.remove(file.object_key);
  const projects = (await pool.query('SELECT id FROM projects WHERE owner_id=$1', [owner.userId])).rows;
  await pool.query('DELETE FROM project_renders WHERE owner_id=$1', [owner.userId]);
  await pool.query('DELETE FROM resources WHERE project_id IN (SELECT id FROM projects WHERE owner_id=$1)', [owner.userId]);
  await pool.query('DELETE FROM operations WHERE owner_id=$1', [owner.userId]);
  await pool.query('DELETE FROM project_revisions WHERE project_id IN (SELECT id FROM projects WHERE owner_id=$1)', [owner.userId]);
  await pool.query('DELETE FROM projects WHERE owner_id=$1', [owner.userId]);
  for (const project of projects) {
    await rmdir(path.join(directory, 'projects', project.id, 'resources')).catch(e => { if (e.code !== 'ENOENT') throw e; });
    await rmdir(path.join(directory, 'projects', project.id)).catch(e => { if (e.code !== 'ENOENT') throw e; });
  }
  await rmdir(path.join(directory, 'projects')).catch(e => { if (e.code !== 'ENOENT') throw e; }); await rmdir(directory);
  assert.match(schema, /^render_test_[a-f0-9]{32}$/); await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end();
});

test('acceptance, idempotency and pg-boss enqueue are atomic and bind an exact project revision', async () => {
  const p = await create(), input = request();
  const [a, b] = await Promise.all([createRender(owner, p.id, input, boss), createRender(owner, p.id, input, boss)]);
  assert.equal(a.id, b.id); assert.equal(a.status, 'queued'); assert.equal(a.contentHref, null);
  assert.equal((await boss.fetch<{ renderId: string }>(RENDER_QUEUE, { batchSize: 100 })).filter(job => job.data.renderId === a.id).length, 1);
  await assert.rejects(createRender(owner, p.id, { ...input, source: { kind: 'current', revision: 2 } }, boss), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(createRender(owner, p.id, request(2), boss), { code: 'REVISION_CONFLICT' });
  const failed = await create(), bad = request();
  await assert.rejects(createRender(owner, failed.id, bad, createRenderQueue(`${schema}_no`)));
  assert.equal((await listRenders(owner, failed.id)).length, 0);
  assert.equal((await pool.query('SELECT 1 FROM operations WHERE owner_id=$1 AND id=$2', [owner.userId, bad.operationId])).rowCount, 0);
});

test('ownership/project binding/strict input deny creation, metadata and image access', async () => {
  const p = await create(), p2 = await create(), candidate = await createCandidate(owner, p.id, { operationId: randomUUID(), expectedRevision: 1, name: '候选' });
  const image = await createRender(owner, p.id, request(), boss);
  for (const work of [() => createRender(other, p.id, request(), boss), () => getRender(other, p.id, image.id),
    () => getRender(owner, p2.id, image.id), () => readRender(other, p.id, image.id, store), () => listRenders(other, p.id),
    () => createRender(owner, p2.id, { operationId: randomUUID(), source: { kind: 'candidate', candidateId: candidate.id, revision: 1 } }, boss)])
    await assert.rejects(work(), { code: 'NOT_FOUND' });
  await assert.rejects(createRender(owner, p.id, { ...request(), objectKey: '../anything' }, boss));
  await assert.rejects(readRender(owner, p.id, image.id, store), { code: 'OUTPUT_NOT_READY' });
});

test('a queued snapshot stays frozen after a manual edit and is visibly stale when published', async () => {
  const p = await create(), image = await createRender(owner, p.id, request(), boss);
  await executeCommand(owner, p.id, { operationId: randomUUID(), expectedRevision: 1, command: { type: 'move-furniture', objectId: 'sofa-a', x: 4, z: 1.2, yaw: .1 } });
  let renderedX = 0;
  await runRender(image.id, { store, render: async scene => { renderedX = scene.objects.find(o => o.id === 'sofa-a')!.position.x; return png; } });
  assert.equal(renderedX, 3);
  const result = await getRender(owner, p.id, image.id);
  assert.equal(result.status, 'completed'); assert.equal(result.stale, true); assert.equal(result.currentProjectRevision, 2);
  assert.equal(result.source.projectRevision, 1); assert.equal(result.snapshotHash, image.snapshotHash);
  assert.equal(bytesHash(await readRender(owner, p.id, image.id, store)), result.imageHash);
  let called = false; await runRender(image.id, { store, render: async () => { called = true; return png; } });
  assert.equal(called, false, 'redelivery after a publishing COMMIT never overwrites the published resource');
  assert.equal((await getRender(owner, p.id, image.id)).resourceId, result.resourceId);
});

test('candidate output freezes its version, preserves current layout, and marks concept pixels', async () => {
  const p = await create();
  const state = (await pool.query('SELECT snapshot FROM projects WHERE id=$1', [p.id])).rows[0].snapshot;
  state.scale = 'missing'; state.synthetic = false; await pool.query('UPDATE projects SET snapshot=$2 WHERE id=$1', [p.id, state]);
  const candidate = await createCandidate(owner, p.id, { operationId: randomUUID(), expectedRevision: 1, name: '概念候选' });
  const image = await createRender(owner, p.id, { operationId: randomUUID(), source: { kind: 'candidate', candidateId: candidate.id, revision: 1 } }, boss);
  assert.equal(image.concept, true); assert.match(image.label, /候选方案 · 未采用.*概念草稿 · 尺寸未校准/);
  // Candidate editing checks are independent; this controlled fixture emulates a subsequent candidate revision.
  await pool.query('UPDATE candidates SET revision=revision+1 WHERE id=$1', [candidate.id]);
  const labeled = await labelPng(png, image.label, '项目修订 1　快照核对');
  assert.equal((await sharp(labeled).metadata()).height, 192);
  const pixels = await sharp(labeled).extract({ left: 20, top: 12, width: 1200, height: 80 }).stats();
  assert.ok(pixels.channels[0].min < 150, 'text is rasterized in the header, not an external viewer label');
  await runRender(image.id, { store, render: async () => labeled });
  const result = await getRender(owner, p.id, image.id);
  assert.equal(result.stale, true); assert.equal(result.currentCandidateRevision, 2);
  assert.equal((await getCandidate(owner, p.id, candidate.id)).status, 'draft');
  assert.equal((await getProject(owner, p.id)).revision, 1);
});

test('a store that writes then loses its response leaves the file intact and retries into a distinct immutable key', async () => {
  const p = await create(), image = await createRender(owner, p.id, request(), boss);
  let uncertainKey = '', deletes = 0;
  const uncertain: PrivateFileStore = { read: key => store.read(key), remove: async () => { deletes++; },
    put: async (key, bytes) => { uncertainKey = key; await store.put(key, bytes); throw new Error('injected lost upload response'); } };
  await assert.rejects(runRender(image.id, { store: uncertain, render: renderer }));
  assert.equal((await getRender(owner, p.id, image.id)).status, 'retry_wait'); assert.equal(deletes, 0);
  assert.equal(bytesHash(await store.read(uncertainKey)), bytesHash(png));
  await runRender(image.id, { store, render: renderer });
  const result = await getRender(owner, p.id, image.id);
  const key = (await pool.query('SELECT object_key FROM resources WHERE id=$1', [result.resourceId])).rows[0].object_key;
  assert.notEqual(key, uncertainKey); assert.equal(result.status, 'completed');
  assert.equal(bytesHash(await store.read(uncertainKey)), bytesHash(png));
});

test('expired generations cannot publish or overwrite the newer ready resource', async () => {
  const p = await create(), image = await createRender(owner, p.id, request(), boss), old = (await claimRender(image.id))!;
  await pool.query("UPDATE project_renders SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [image.id]);
  const current = (await claimRender(image.id))!; await publishRender(current, png, store);
  await assert.rejects(publishRender(old, png, store), { code: 'RENDER_FENCE_LOST' });
  assert.equal((await getRender(owner, p.id, image.id)).resourceId, current.resourceId);
  assert.equal((await pool.query('SELECT state FROM resources WHERE id=$1', [old.resourceId])).rows[0].state, 'pending');
});

test('snapshot/version mismatch and bounded failures remain queryable and never publish content', async () => {
  for (const column of ['snapshot_hash', 'renderer_version']) {
    const p = await create(), image = await createRender(owner, p.id, request(), boss);
    await pool.query(`UPDATE project_renders SET ${column}=$2 WHERE id=$1`, [image.id, 'changed']);
    await runRender(image.id, { store, render: renderer });
    const result = await getRender(owner, p.id, image.id); assert.equal(result.status, 'failed'); assert.equal(result.contentHref, null);
    assert.equal(result.error?.code, column === 'snapshot_hash' ? 'SNAPSHOT_MISMATCH' : 'RENDER_VERSION_CHANGED');
  }
  const p = await create(), image = await createRender(owner, p.id, request(), boss);
  for (let n = 0; n < 3; n++) await runRender(image.id, { store, render: async () => { throw new Error('bounded render failure'); } }).catch(() => {});
  assert.equal((await getRender(owner, p.id, image.id)).status, 'failed');
});

test('content digest mismatch fails closed and the label covers all uncalibrated scales', async () => {
  const p = await create(), image = await createRender(owner, p.id, request(), boss);
  await runRender(image.id, { store, render: renderer });
  await assert.rejects(readRender(owner, p.id, image.id, { ...store, put: store.put.bind(store), remove: store.remove.bind(store), read: async () => Buffer.from('bad') }), { code: 'OUTPUT_UNAVAILABLE' });
  for (const scale of ['missing', 'estimated', 'conflicted']) assert.match(artifactLabel({ kind: 'current', revision: 2 }, scale, false), /概念草稿 · 尺寸未校准/);
  assert.match(artifactLabel({ kind: 'candidate', revision: 3 }, 'synthetic', true), /合成示例/);
});
