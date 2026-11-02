import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pool, transaction } from '../../persistence/src/client';
import { createInvitation, acceptInvitation } from '../../identity/src/service';
import { createProject, type Principal } from '../../projects/src/service';
import { LocalPrivateFileStore } from '../../files/src/storage';
import { createFloorplanImport, getFloorplanCandidate, getFloorplanImport, importHouseSpec, readFloorplanSource } from './service';
import { claimImport, publishImport, runImport } from './runner';
import { createImportQueue, initializeImportQueue } from './queue';

// Real PostgreSQL, real pg-boss producer in an isolated schema and the real `python -I` converter (pnpm setup:dxf).
const fixtures = new URL('../../floorplan-import/fixtures/dxf/', import.meta.url);
const fixture = async (name: string) => new Uint8Array(await readFile(new URL(name, fixtures)));
const schema = `hestia_imports_test_${randomUUID().replaceAll('-', '').slice(0, 8)}`, op = () => randomUUID();
const users: { principal: Principal; email: string; invitationId: string }[] = [];
let owner: Principal, stranger: Principal, root: string, store: LocalPrivateFileStore, queue: ReturnType<typeof createImportQueue>;
before(async () => {
  for (const label of ['图纸成员', '其他用户']) {
    const email = `drawing-${randomUUID()}@example.test`, invitation = await createInvitation(email);
    users.push({ principal: { userId: (await acceptInvitation(invitation.token, label, randomUUID())).userId }, email, invitationId: invitation.id });
  }
  [owner, stranger] = users.map(user => user.principal);
  root = await mkdtemp(path.join(os.tmpdir(), 'hestia-drawings-')); store = new LocalPrivateFileStore(root);
  await initializeImportQueue(schema); queue = createImportQueue(schema);
});
after(async () => {
  try {
    await transaction(async client => {
      for (const { principal, email, invitationId } of users) {
        await client.query('DELETE FROM operations WHERE actor_id=$1', [principal.userId]);
        await client.query('DELETE FROM floorplan_imports WHERE project_id IN (SELECT id FROM projects WHERE created_by=$1)', [principal.userId]);
        await client.query('DELETE FROM resources WHERE project_id IN (SELECT id FROM projects WHERE created_by=$1)', [principal.userId]);
        await client.query('DELETE FROM project_revisions WHERE project_id IN (SELECT id FROM projects WHERE created_by=$1)', [principal.userId]);
        await client.query('DELETE FROM projects WHERE created_by=$1', [principal.userId]);
        await client.query('DELETE FROM hestia_auth_user WHERE id=$1 AND email=$2', [principal.userId, email]);
        await client.query('DELETE FROM hestia_invitation WHERE id=$1 AND email=$2', [invitationId, email]);
      }
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    });
  } finally { await rm(root, { recursive: true, force: true }); await pool.end(); }
});
const project = () => createProject(owner, { name: '图纸导入验证', template: 'empty', operationId: op() });
const upload = (projectId: string, bytes: Uint8Array, name: string, operationId = op()) =>
  createFloorplanImport(owner, projectId, { operationId }, bytes, name, { store, queue });

test('a DXF is queued, converted in the background into a pending-review candidate that matches the drawing', async () => {
  const space = await project(), bytes = await fixture('synthetic-flat.dxf');
  const queued = await upload(space.id, bytes, 'synthetic-flat.dxf');
  assert.equal(queued.status, 'queued'); assert.equal(queued.mode, 'automatic'); assert.match(queued.label, /审核/);
  await runImport(queued.id, { store });
  const done = await getFloorplanImport(owner, space.id, queued.id);
  assert.equal(done.status, 'pending_review');
  assert.equal(done.candidate?.valid, true, JSON.stringify(done.candidate?.issues));
  assert.equal(done.candidate?.source, 'dxf-automatic');
  assert.equal(done.candidate?.scale.status, 'estimated');
  const truth = JSON.parse(await readFile(new URL('synthetic-flat.housespec.json', fixtures), 'utf8'));
  assert.equal(done.candidate?.summary?.walls, truth.walls.length);
  assert.equal(done.candidate?.summary?.openings, truth.walls.reduce((n: number, w: { openings?: unknown[] }) => n + (w.openings?.length ?? 0), 0));
  assert.deepEqual(new Set(done.candidate?.summary?.roomNames), new Set(truth.rooms.map((r: { name: string }) => r.name)));
  // Wall centrelines and thicknesses agree with the source HouseSpec within 1 mm, up to the drawing's origin.
  type W = { a: number[]; b: number[]; t: number };
  const full = await getFloorplanCandidate(owner, space.id, queued.id) as { houseSpec: { floors: { walls: W[] }[] } };
  const keys = (walls: W[]) => {
    const x0 = Math.min(...walls.flatMap(w => [w.a[0], w.b[0]])), z0 = Math.min(...walls.flatMap(w => [w.a[1], w.b[1]]));
    return new Set(walls.map(w => [...[w.a, w.b].map(p => [Math.round(p[0] - x0), Math.round(p[1] - z0)]).sort().flat(), Math.round(w.t)].join(',')));
  };
  assert.deepEqual(keys(full.houseSpec.floors[0].walls), keys(truth.walls));
  // Duplicate delivery after publication neither claims nor adds a candidate.
  await runImport(queued.id, { store });
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM floorplan_candidates WHERE import_id=$1', [queued.id])).rows[0].n, 1);
  assert.equal(await claimImport(queued.id), null);
});

test('uploads are idempotent per operation, bounded and checked by content', async () => {
  const space = await project(), bytes = await fixture('synthetic-flat.dxf'), operationId = op();
  const first = await upload(space.id, bytes, 'a.dxf', operationId), again = await upload(space.id, bytes, 'a.dxf', operationId);
  assert.equal(again.id, first.id);
  await assert.rejects(upload(space.id, new Uint8Array([...bytes, 10]), 'a.dxf', operationId), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(upload(space.id, new TextEncoder().encode('AC1032 binary dwg'), 'renamed.dxf'), { code: 'INVALID_DXF' });
  await assert.rejects(upload(space.id, bytes, 'plan.exe'), { code: 'UNSUPPORTED_FILE_TYPE' });
  await assert.rejects(upload(space.id, new Uint8Array(16 * 1024 * 1024 + 1), 'big.dxf'), { code: 'FILE_TOO_LARGE' });
  await assert.rejects(createFloorplanImport(stranger, space.id, { operationId: op() }, bytes, 'x.dxf', { store, queue }), { code: 'NOT_FOUND' });
});

test('a restarted Worker takes over an expired conversion and the stale generation cannot publish', async () => {
  const space = await project(), queued = await upload(space.id, await fixture('synthetic-flat.dxf'), 'restart.dxf');
  const stale = await claimImport(queued.id);
  assert.ok(stale);
  await pool.query("UPDATE floorplan_imports SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [queued.id]);
  await runImport(queued.id, { store });
  const done = await getFloorplanImport(owner, space.id, queued.id);
  assert.equal(done.status, 'pending_review'); assert.equal(done.attempts, 2);
  await assert.rejects(publishImport(stale!, { houseSpec: {}, candidate: null, scene: null, issues: [], conversion: null }), { code: 'IMPORT_FENCE_LOST' });
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM floorplan_candidates WHERE import_id=$1', [queued.id])).rows[0].n, 1);
});

test('timeouts and a missing converter end in clear failed states, and members can still assist', async () => {
  const space = await project(), bytes = await fixture('synthetic-flat.dxf');
  const slow = await upload(space.id, bytes, 'slow.dxf');
  await runImport(slow.id, { store, converter: { timeoutMs: 1 } });
  const timedOut = await getFloorplanImport(owner, space.id, slow.id);
  assert.equal(timedOut.status, 'failed'); assert.equal(timedOut.error?.code, 'CONVERSION_TIMEOUT');
  const broken = await upload(space.id, bytes, 'broken.dxf');
  await runImport(broken.id, { store, converter: { python: path.join(root, 'no-python') } });
  const unavailable = await getFloorplanImport(owner, space.id, broken.id);
  assert.equal(unavailable.status, 'failed'); assert.equal(unavailable.error?.code, 'CONVERTER_UNAVAILABLE');
  const truth = JSON.parse(await readFile(new URL('synthetic-flat.housespec.json', fixtures), 'utf8'));
  const assisted = await importHouseSpec(owner, space.id, broken.id, { operationId: op(), expectedRevision: unavailable.revision, houseSpec: truth });
  assert.equal(assisted.status, 'pending_review'); assert.equal(assisted.candidate?.source, 'member-housespec'); assert.equal(assisted.candidate?.valid, true);
});

test('undeclared units and contradictory dimensions are reported, not hidden', async () => {
  const space = await project();
  const unitless = await upload(space.id, await fixture('synthetic-flat-unitless.dxf'), 'unitless.dxf');
  await runImport(unitless.id, { store });
  assert.equal((await getFloorplanImport(owner, space.id, unitless.id)).candidate?.scale.status, 'missing');
  const conflict = await upload(space.id, await fixture('synthetic-flat-conflict.dxf'), 'conflict.dxf');
  await runImport(conflict.id, { store });
  const view = await getFloorplanImport(owner, space.id, conflict.id);
  assert.equal(view.candidate?.scale.status, 'conflicted');
  assert.ok(view.candidate!.dimensionConflicts.length > 0);
  assert.ok(view.candidate!.issues.some(issue => issue.code === 'DIMENSION_CONFLICTS'));
});

test('other formats wait for assisted conversion; member HouseSpecs are validated and sources stay private', async () => {
  const space = await project(), png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const assisted = await upload(space.id, png, '平面图.png');
  assert.equal(assisted.status, 'assisted_conversion'); assert.equal(assisted.mode, 'assisted'); assert.match(assisted.label, /不会自动识别/);
  assert.equal(assisted.candidate, null);
  const invalid = await importHouseSpec(owner, space.id, assisted.id, { operationId: op(), expectedRevision: 1, houseSpec: { height: 2800, walls: [] } });
  assert.equal(invalid.candidate?.valid, false); assert.ok(invalid.candidate!.issues.some(issue => issue.severity === 'blocking'));
  const villa = JSON.parse(await readFile(new URL('../demo-villa.housespec.json', fixtures), 'utf8'));
  const accepted = await importHouseSpec(owner, space.id, assisted.id, { operationId: op(), expectedRevision: invalid.revision, houseSpec: villa });
  assert.equal(accepted.candidate?.valid, true, JSON.stringify(accepted.candidate?.issues)); assert.equal(accepted.candidate?.summary?.levels, 3);
  await assert.rejects(importHouseSpec(owner, space.id, assisted.id, { operationId: op(), expectedRevision: 1, houseSpec: villa }), { code: 'IMPORT_REVISION_CONFLICT' });
  assert.deepEqual(new Uint8Array((await readFloorplanSource(owner, space.id, assisted.id, store)).bytes), png);
  await assert.rejects(readFloorplanSource(stranger, space.id, assisted.id, store), { code: 'NOT_FOUND' });
  await assert.rejects(getFloorplanImport(stranger, space.id, assisted.id), { code: 'NOT_FOUND' });
  await assert.rejects(importHouseSpec(stranger, space.id, assisted.id, { operationId: op(), expectedRevision: accepted.revision, houseSpec: villa }), { code: 'NOT_FOUND' });
});
