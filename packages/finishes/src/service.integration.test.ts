import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, transaction } from '../../persistence/src/client';
import { createInvitation, acceptInvitation } from '../../identity/src/service';
import { auth, authOrigin } from '../../identity/src/auth';
import { createProject, getProject, type Principal } from '../../projects/src/service';
import { browserUser, type BrowserUser } from '../../candidates/src/browser-user';
import { createCandidate, editCandidate, checkCandidate, presentCandidate, selectCandidate, adoptCandidate, undoAdoption } from '../../candidates/src/service';
import type { CandidateCommand, CandidateView } from '../../contracts/src/candidates';
import type { Tiling } from '../../contracts/src/finishes';
import { addStones, retireStone } from './catalog';
import { demoStones } from './demo-stones';

const email = `finishes-${randomUUID()}@example.test`, password = randomUUID(), op = () => randomUUID();
let owner: Principal, user: BrowserUser, invitationId: string, workspaceId: string;
before(async () => {
  const invitation = await createInvitation(email); invitationId = invitation.id;
  owner = { userId: (await acceptInvitation(invitation.token, '合成铺贴验证', password)).userId };
  const login = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  user = await browserUser(new Request(authOrigin, { headers: { Origin: authOrigin, Cookie: login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ') } }));
  const project = await createVilla();
  workspaceId = (await pool.query('SELECT workspace_id FROM projects WHERE id=$1', [project.id])).rows[0].workspace_id;
  await transaction(client => addStones(client, workspaceId, demoStones));
});
after(async () => {
  try { await transaction(async client => {
    if (owner) {
      await client.query('DELETE FROM operations WHERE actor_id=$1', [owner.userId]);
      await client.query('DELETE FROM project_revisions WHERE project_id IN (SELECT id FROM projects WHERE created_by=$1)', [owner.userId]);
      await client.query('DELETE FROM projects WHERE created_by=$1', [owner.userId]);
      if (workspaceId) await client.query('DELETE FROM workspace_stones WHERE workspace_id=$1', [workspaceId]);
      await client.query('DELETE FROM hestia_auth_user WHERE id=$1 AND email=$2', [owner.userId, email]);
    }
    if (invitationId) await client.query('DELETE FROM hestia_invitation WHERE id=$1 AND email=$2', [invitationId, email]);
  }); } finally { await pool.end(); }
});
function createVilla() { return createProject(owner, { name: '演示别墅铺贴验证', template: 'demo-villa', operationId: op() }); }
const draft = (id: string, revision = 1) => createCandidate(owner, id, { operationId: op(), expectedRevision: revision, name: '铺贴候选' });
const edit = (candidate: CandidateView, command: CandidateCommand) => editCandidate(owner, candidate.projectId, candidate.id, { operationId: op(), expectedCandidateRevision: candidate.revision, command });
const check = (candidate: CandidateView) => checkCandidate(owner, candidate.projectId, candidate.id, { operationId: op(), expectedCandidateRevision: candidate.revision });
const living = (candidate: CandidateView) => candidate.surfaceDesign!.tilings.find(t => t.finishId === 'finish-f1-living-floor')!;
const setTiling = (tiling: Tiling): CandidateCommand => ({ type: 'set-tiling', ...tiling });

test('demo villa project carries storeys, finishes and an example surface design as fixed facts, with furniture kept as staging', async () => {
  const project = await createVilla();
  assert.equal(project.scene.levels?.length, 3);
  assert.ok(project.scene.finishes?.some(f => f.kind === 'stair') && project.scene.finishes.some(f => f.kind === 'wall'));
  assert.equal(project.scene.surfaceDesign?.tilings.length, 5);
  assert.ok(project.scene.objects.every(object => object.kind === 'fixed'));
});

test('a tiling change is checked, adopted as a surface change without touching layout or fixed facts, and undone', async () => {
  const project = await createVilla();
  let candidate = await draft(project.id);
  candidate = await edit(candidate, setTiling({ ...living(candidate), pattern: 'running-bond', tile: { length: 1.2, width: .6 } }));
  assert.equal(candidate.changeKind, 'surface');
  assert.deepEqual(candidate.tilingChanges.map(change => change.finishId), ['finish-f1-living-floor']);
  assert.deepEqual(candidate.changedObjectIds, ['finish-f1-living-floor']);
  const report = await check(candidate);
  assert.equal(report.adoptable, true, JSON.stringify(report.issues));
  assert.ok(report.checks.some(item => item.code === 'surface-design' && item.status === 'passed'));
  const presentation = await presentCandidate(user, project.id, candidate.id, { operationId: op(), expectedCandidateRevision: candidate.revision, expectedRevision: candidate.baseRevision, checkId: report.id });
  const selection = await selectCandidate(user, project.id, candidate.id, { operationId: op(), presentationId: presentation.id });
  const adopted = await adoptCandidate(owner, project.id, candidate.id, { operationId: op(), expectedRevision: candidate.baseRevision, selectionId: selection.id });
  assert.equal(adopted.project.revision, 2);
  assert.equal(adopted.project.scene.surfaceDesign?.tilings.find(t => t.finishId === 'finish-f1-living-floor')?.pattern, 'running-bond');
  assert.deepEqual(adopted.project.fixedFacts, project.fixedFacts);
  assert.deepEqual(adopted.project.currentLayout, project.currentLayout);
  assert.deepEqual(adopted.project.scene.finishes, project.scene.finishes);
  const undone = await undoAdoption(owner, project.id, adopted.adoption.operationId, { operationId: op(), expectedRevision: 2 });
  assert.equal(undone.project.revision, 3);
  assert.deepEqual(undone.project.scene.surfaceDesign, project.scene.surfaceDesign);
  assert.deepEqual((await getProject(owner, project.id)).scene.surfaceDesign, project.scene.surfaceDesign);
});

test('layout conflicts block adoption, and invalid targets or no-op tilings are rejected', async () => {
  const project = await createVilla();
  const candidate = await draft(project.id);
  await assert.rejects(edit(candidate, setTiling({ ...living(candidate), finishId: 'no-such-finish' })), { code: 'TILING_UNKNOWN_FINISH' });
  await assert.rejects(edit(candidate, setTiling(living(candidate))), { code: 'NO_CHANGE' });
  await assert.rejects(edit(candidate, setTiling({ ...living(candidate), stoneId: 'no-such-stone' })), { code: 'STONE_NOT_FOUND' });
  // Herringbone needs plank-shaped pieces; square tiles are a hard conflict.
  const squared = await edit(candidate, setTiling({ ...living(candidate), pattern: 'herringbone', border: undefined }));
  const report = await check(squared);
  assert.equal(report.adoptable, false);
  assert.ok(report.issues.some(issue => issue.code === 'PATTERN_NEEDS_PLANK' && issue.objectId === 'finish-f1-living-floor'));
  // Clearing a finish is a valid surface change.
  const cleared = await edit(squared, { type: 'clear-tiling', finishId: 'finish-f1-living-floor' });
  assert.equal(cleared.surfaceDesign?.tilings.some(t => t.finishId === 'finish-f1-living-floor'), false);
  assert.equal((await check(cleared)).adoptable, true);
});

test('retired catalog versions cannot be newly chosen, block changed tilings, and are hints on inherited ones', async () => {
  const project = await createVilla();
  let candidate = await draft(project.id);
  await transaction(client => retireStone(client, workspaceId, { stoneId: 'demo-dark-gold', stoneVersion: 1 }));
  try {
    // Living floor uses the retired border stone: re-choosing it in a changed tiling is refused.
    await assert.rejects(edit(candidate, setTiling({ ...living(candidate), joint: { width: .002, color: '#d9d2c6' } })), { code: 'STONE_VERSION_RETIRED' });
    // Changing another finish keeps the inherited border; the retired version is reported but does not block.
    const dining = candidate.surfaceDesign!.tilings.find(t => t.finishId === 'finish-f1-dining-floor')!;
    candidate = await edit(candidate, setTiling({ ...dining, angle: 0 }));
    const report = await check(candidate);
    assert.equal(report.adoptable, true, JSON.stringify(report.issues));
    assert.ok(report.issues.some(issue => issue.code === 'STONE_VERSION_RETIRED' && issue.objectId === 'finish-f1-living-floor'));
  } finally {
    await pool.query("UPDATE workspace_stones SET status='active' WHERE workspace_id=$1", [workspaceId]);
  }
});
