import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, transaction } from '../../persistence/src/client';
import { createInvitation, acceptInvitation } from '../../identity/src/service';
import { auth, authOrigin } from '../../identity/src/auth';
import { createProject, getProject, type Principal } from '../../projects/src/service';
import { executeCommand } from '../../commands/src/service';
import { browserUser, type BrowserUser } from '../../candidates/src/browser-user';
import { createCandidate, editCandidate, checkCandidate, presentCandidate, selectCandidate, adoptCandidate, undoAdoption } from '../../candidates/src/service';
import { applyStyle, getStyles, undoStyle } from './service';
import { defaultVisualStyle, type StyleCommand } from '../../contracts/src/styles';
import type { CandidateCommand, CandidateView } from '../../contracts/src/candidates';
import { catalogInstance } from '../../catalog/src/instances';
import { getCatalog } from '../../catalog/src/catalog';
import { createRender } from '../../renders/src/service';
import type { PgBoss } from 'pg-boss';

const email = `style-domain-${randomUUID()}@example.test`, password = randomUUID(), op = () => randomUUID();
let owner: Principal, user: BrowserUser, invitationId: string;
before(async () => {
  const invitation = await createInvitation(email); invitationId = invitation.id;
  owner = { userId: (await acceptInvitation(invitation.token, '合成风格验证', password)).userId };
  const login = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  user = await browserUser(new Request(authOrigin, { headers: { Origin: authOrigin, Cookie: login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ') } }));
});
after(async () => {
  try { await transaction(async client => {
    if (owner) {
      await client.query('DELETE FROM operations WHERE actor_id=$1', [owner.userId]);
      await client.query('DELETE FROM project_revisions WHERE project_id IN (SELECT id FROM projects WHERE created_by=$1)', [owner.userId]);
      await client.query('DELETE FROM resources WHERE project_id IN (SELECT id FROM projects WHERE created_by=$1)', [owner.userId]);
      await client.query('DELETE FROM projects WHERE created_by=$1', [owner.userId]);
      await client.query('DELETE FROM hestia_auth_user WHERE id=$1 AND email=$2', [owner.userId, email]);
    }
    if (invitationId) await client.query('DELETE FROM hestia_invitation WHERE id=$1 AND email=$2', [invitationId, email]);
  }); } finally { await pool.end(); }
});
const create = () => createProject(owner, { name: '合成风格验证', template: 'courtyard', operationId: op() });
const material = (objectId = 'sofa-a', materialId = 'prototype-chinese'): StyleCommand => ({ type: 'set-material', objectId, materialId, materialVersion: 1 });
const draft = (id: string, revision = 1) => createCandidate(owner, id, { operationId: op(), expectedRevision: revision, name: '视觉风格候选' });
const edit = (candidate: CandidateView, command: CandidateCommand) => editCandidate(owner, candidate.projectId, candidate.id, { operationId: op(), expectedCandidateRevision: candidate.revision, command });
async function choose(candidate: CandidateView) {
  const check = await checkCandidate(owner, candidate.projectId, candidate.id, { operationId: op(), expectedCandidateRevision: candidate.revision }); assert.equal(check.adoptable, true);
  const presentation = await presentCandidate(user, candidate.projectId, candidate.id, { operationId: op(), expectedCandidateRevision: candidate.revision, expectedRevision: candidate.baseRevision, checkId: check.id });
  const selection = await selectCandidate(user, candidate.projectId, candidate.id, { operationId: op(), presentationId: presentation.id });
  return { operationId: op(), expectedRevision: candidate.baseRevision, selectionId: selection.id };
}

test('explicit local material commits once, keeps complete layout/facts, reopens and undoes without layout identity change', async () => {
  const before = await create(), request = { operationId: op(), expectedRevision: 1, command: material() };
  const [first, retry] = await Promise.all([applyStyle(owner, before.id, request), applyStyle(owner, before.id, request)]);
  assert.equal(first.project.revision, 2); assert.equal(retry.project.revision, 2);
  assert.deepEqual(first.project.currentLayout, before.currentLayout); assert.deepEqual(first.project.scene.objects, before.scene.objects);
  assert.deepEqual(first.project.fixedFacts, before.fixedFacts); assert.equal(first.visualStyle.materials.length, 1);
  assert.deepEqual((await getProject(owner, before.id)).scene.visualStyle, first.visualStyle);
  await assert.rejects(applyStyle(owner, before.id, { ...request, command: material('table-a') }), { code: 'IDEMPOTENCY_CONFLICT' });
  const undo = { operationId: op(), expectedRevision: 2 }, restored = await undoStyle(owner, before.id, request.operationId, undo);
  assert.equal(restored.project.revision, 3); assert.deepEqual(restored.project.scene, before.scene); assert.deepEqual(restored.project.currentLayout, before.currentLayout);
  assert.equal((await undoStyle(owner, before.id, request.operationId, undo)).project.revision, 3);
  assert.equal(restored.undoableCommand, null);
});
test('style rejects fixed, locked, unknown target/catalog/version, arbitrary fields and cross-account access atomically', async () => {
  const project = await create();
  await executeCommand(owner, project.id, { operationId: op(), expectedRevision: 1, command: { type: 'set-lock', objectId: 'table-a', locked: true } });
  const baseline = await getProject(owner, project.id);
  for (const [command, code] of [[material('fixed-a'), 'FIXED_FACT'], [material('table-a'), 'OBJECT_LOCKED'], [material('absent'), 'OBJECT_NOT_FOUND'], [material('sofa-a', 'unknown'), 'STYLE_MATERIAL_UNKNOWN'], [{ ...material(), materialVersion: 99 }, 'STYLE_MATERIAL_UNKNOWN'], [{ type: 'set-display-lighting', presetId: 'sun', presetVersion: 1 }, 'STYLE_LIGHTING_UNKNOWN']] as const)
    await assert.rejects(applyStyle(owner, project.id, { operationId: op(), expectedRevision: 2, command }), { code });
  await assert.rejects(applyStyle(owner, project.id, { operationId: op(), expectedRevision: 2, command: { ...material(), color: '#ffffff' } }));
  await assert.rejects(getStyles({ userId: op() }, project.id), { code: 'NOT_FOUND' });
  assert.deepEqual(await getProject(owner, project.id), baseline);
});
test('measured furniture style is separate, later project changes block style undo, and reset restores base appearance', async () => {
  const project = await create();
  await pool.query("UPDATE projects SET snapshot=jsonb_set(snapshot,'{currentLayout,objects,0,dimensionSource}','\"measured\"') WHERE id=$1", [project.id]);
  const before = await getProject(owner, project.id), result = await applyStyle(owner, project.id, { operationId: op(), expectedRevision: 1, command: material() });
  assert.deepEqual(result.project.scene.objects, before.scene.objects);
  await executeCommand(owner, project.id, { operationId: op(), expectedRevision: 2, command: { type: 'move-furniture', objectId: 'sofa-a', x: 3.2, z: 1.2, yaw: 0 } });
  assert.equal((await getStyles(owner, project.id)).undoableCommand, null);
  await assert.rejects(undoStyle(owner, project.id, result.operationId, { operationId: op(), expectedRevision: 3 }), { code: 'UNDO_STYLE_CONFLICT' });
  const reset = await applyStyle(owner, project.id, { operationId: op(), expectedRevision: 3, command: { type: 'reset-material', objectId: 'sofa-a' } });
  assert.deepEqual(reset.visualStyle, defaultVisualStyle()); assert.equal(reset.project.scene.objects.find(object => object.id === 'sofa-a')!.dimensionSource, 'measured');
});
test('pure style candidates are isolated, checked and user-adopted without creating a furniture layout; whole undo restores style', async () => {
  const project = await create(); let candidate = await edit(await draft(project.id), material());
  candidate = await edit(candidate, { type: 'set-display-lighting', presetId: 'display-soft', presetVersion: 1 });
  assert.equal(candidate.changeKind, 'style'); assert.equal(candidate.objectChanges.length, 0); assert.equal(candidate.styleChanges.length, 2);
  assert.equal((await getProject(owner, project.id)).scene.visualStyle, undefined);
  const request = await choose(candidate), result = await adoptCandidate(owner, project.id, candidate.id, request);
  assert.equal(result.project.revision, 2); assert.deepEqual(result.project.currentLayout, project.currentLayout); assert.deepEqual(result.project.scene.visualStyle, candidate.visualStyle);
  const undo = await undoAdoption(owner, project.id, result.adoption.operationId, { operationId: op(), expectedRevision: 2 });
  assert.equal(undo.project.revision, 3); assert.deepEqual(undo.project.currentLayout, project.currentLayout); assert.deepEqual(undo.project.scene, project.scene);
});
test('mixed candidates adopt style and layout atomically, bind user selection to style and restore both with a fresh layout identity', async () => {
  const project = await create(); let candidate = await edit(await draft(project.id), { type: 'move-furniture', objectId: 'sofa-a', x: 3.3, z: 1.2, yaw: 0 });
  const stale = await choose(candidate); candidate = await edit(candidate, material());
  assert.equal(candidate.changeKind, 'mixed');
  await assert.rejects(adoptCandidate(owner, project.id, candidate.id, stale), { code: 'STALE_SELECTION' });
  const adopted = await adoptCandidate(owner, project.id, candidate.id, await choose(candidate));
  assert.notEqual(adopted.project.currentLayout.id, project.currentLayout.id);
  const restored = await undoAdoption(owner, project.id, adopted.adoption.operationId, { operationId: op(), expectedRevision: 2 });
  assert.deepEqual(restored.project.scene, project.scene); assert.notEqual(restored.project.currentLayout.id, project.currentLayout.id);
});
test('candidate removal drops inherited overrides, raw fixed/locked style fails coverage and missing-scale style cannot adopt', async () => {
  const project = await create(); await applyStyle(owner, project.id, { operationId: op(), expectedRevision: 1, command: material() });
  let candidate = await edit(await draft(project.id, 2), { type: 'remove-furniture', objectId: 'sofa-a' });
  assert.equal(candidate.changeKind, 'mixed'); assert.equal(candidate.visualStyle.materials.length, 0); assert.equal(candidate.styleChanges[0].kind, 'material');
  await pool.query('UPDATE candidates SET visual_style=$1 WHERE id=$2', [{ ...defaultVisualStyle(), materials: [{ objectId: 'fixed-a', materialId: 'prototype-cream', materialVersion: 1 }] }, candidate.id]);
  const failed = await checkCandidate(owner, project.id, candidate.id, { operationId: op(), expectedCandidateRevision: candidate.revision });
  assert.equal(failed.adoptable, false); assert.ok(failed.issues.some(item => item.code === 'FIXED_FACT'));
  const unscaled = await create(); await pool.query("UPDATE projects SET snapshot=jsonb_set(snapshot,'{scale}','\"missing\"') WHERE id=$1", [unscaled.id]);
  candidate = await edit(await draft(unscaled.id), material());
  const report = await checkCandidate(owner, unscaled.id, candidate.id, { operationId: op(), expectedCandidateRevision: candidate.revision });
  assert.equal(report.adoptable, false); assert.ok(report.issues.some(item => item.code === 'SCALE_UNCONFIRMED'));
});
test('local style snapshot, history and idempotency ledger roll back together after a persistence fault', async () => {
  const project = await create(), snapshot = (await pool.query('SELECT snapshot FROM projects WHERE id=$1', [project.id])).rows[0].snapshot;
  await pool.query('INSERT INTO project_revisions(project_id,revision,snapshot,operation_id) VALUES($1,2,$2,$3)', [project.id, snapshot, op()]);
  const request = { operationId: op(), expectedRevision: 1, command: material() };
  await assert.rejects(applyStyle(owner, project.id, request), { code: '23505' });
  assert.equal((await getProject(owner, project.id)).revision, 1);
  assert.equal((await pool.query('SELECT * FROM project_style_commands WHERE project_id=$1', [project.id])).rowCount, 0);
  assert.equal((await pool.query('SELECT * FROM operations WHERE actor_id=$1 AND id=$2', [owner.userId, request.operationId])).rowCount, 0);
});

test('historical palette-only replacement plus lighting cannot be presented or silently discard visible furniture on style adoption', async () => {
  const project = await create(), asset = getCatalog().assets[0];
  const fixture = catalogInstance('sofa-a', { assetId: asset.id, assetVersion: 1, materialId: 'prototype-wood', materialVersion: 1 }, asset.defaultSize, { x: 3, z: 1.2, yaw: 0 });
  await pool.query("UPDATE projects SET snapshot=jsonb_set(snapshot,'{currentLayout,objects,0}',$2::jsonb) WHERE id=$1", [project.id, JSON.stringify(fixture)]);
  const before = await getProject(owner, project.id); let candidate = await draft(project.id);
  const objects = candidate.scene.objects.filter(object => object.kind === 'furniture');
  objects[0] = catalogInstance('sofa-a', { ...fixture.catalog!, materialId: 'prototype-cream' }, asset.defaultSize, { x: 3, z: 1.2, yaw: 0 });
  // Emulate an immutable pre-T16 draft carrying a palette inside the object rather than a style override.
  await pool.query('UPDATE candidates SET objects=$1 WHERE id=$2', [JSON.stringify(objects), candidate.id]);
  candidate = await edit(candidate, { type: 'set-display-lighting', presetId: 'display-soft', presetVersion: 1 });
  assert.equal(candidate.changeKind, 'style'); assert.equal(candidate.objectChanges.length, 1);
  const check = await checkCandidate(owner, project.id, candidate.id, { operationId: op(), expectedCandidateRevision: candidate.revision });
  assert.equal(check.adoptable, false); assert.ok(check.issues.some(issue => issue.code === 'STYLE_REQUIRES_OVERRIDE'));
  await assert.rejects(presentCandidate(user, project.id, candidate.id, { operationId: op(), expectedCandidateRevision: candidate.revision, expectedRevision: 1, checkId: check.id }), { code: 'CANDIDATE_NOT_ADOPTABLE' });
  assert.deepEqual(await getProject(owner, project.id), before);
});

test('frozen render snapshots project both current and candidate independent styles (queue dispatch is a test stub)', async () => {
  const project = await create();
  const current = await applyStyle(owner, project.id, { operationId: op(), expectedRevision: 1, command: material() });
  const candidate = await edit(await draft(project.id, 2), { type: 'set-display-lighting', presetId: 'display-neutral', presetVersion: 1 });
  const dispatches: string[] = [];
  const queue = { send: async (_name: string, payload: { renderId: string }) => { dispatches.push(payload.renderId); return payload.renderId; } } as unknown as PgBoss;
  const a = await createRender(owner, project.id, { operationId: op(), source: { kind: 'current', revision: 2 } }, queue);
  const b = await createRender(owner, project.id, { operationId: op(), source: { kind: 'candidate', candidateId: candidate.id, revision: candidate.revision } }, queue);
  const frozen = (await pool.query('SELECT id,snapshot FROM project_renders WHERE id=ANY($1::uuid[])', [[a.id, b.id]])).rows;
  assert.deepEqual(frozen.find(row => row.id === a.id)!.snapshot.visualStyle, current.visualStyle);
  assert.deepEqual(frozen.find(row => row.id === b.id)!.snapshot.visualStyle, candidate.visualStyle);
  assert.equal(dispatches.length, 2); assert.notEqual(a.snapshotHash, b.snapshotHash);
  await edit(candidate, material('table-a', 'prototype-cream'));
  assert.deepEqual((await pool.query('SELECT snapshot FROM project_renders WHERE id=$1', [b.id])).rows[0].snapshot, frozen.find(row => row.id === b.id)!.snapshot);
});
