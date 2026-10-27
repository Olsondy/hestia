import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, transaction } from '../../persistence/src/client';
import { createInvitation, acceptInvitation } from '../../identity/src/service';
import { auth, authOrigin } from '../../identity/src/auth';
import { createProject, getProject, renameProject, type Principal } from '../../projects/src/service';
import { executeCommand, listCommands } from '../../commands/src/service';
import { browserUser, type BrowserUser } from './browser-user';
import { createCandidate, getCandidate, listCandidates, editCandidate, checkCandidate, presentCandidate, selectCandidate, adoptCandidate, undoAdoption } from './service';
import type { CandidateView } from '../../contracts/src/candidates';
import { getCatalog } from '../../catalog/src/catalog';

const email = `candidate-domain-${randomUUID()}@example.test`, password = randomUUID();
let owner: Principal, browser: BrowserUser, invitationId: string;
const outsider = { userId: `candidate-outsider-${randomUUID()}` };
before(async () => {
  const invitation = await createInvitation(email); invitationId = invitation.id;
  const identity = await acceptInvitation(invitation.token, '候选契约验证', password); owner = { userId: identity.userId };
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true }); assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
  browser = await browserUser(new Request(authOrigin, { headers: { Origin: authOrigin, Cookie: cookie } }));
});
after(async () => {
  try {
    await transaction(async client => {
      if (owner) {
        await client.query('DELETE FROM operations WHERE owner_id=$1', [owner.userId]);
        await client.query('DELETE FROM project_revisions WHERE project_id IN (SELECT id FROM projects WHERE owner_id=$1)', [owner.userId]);
        await client.query('DELETE FROM resources WHERE project_id IN (SELECT id FROM projects WHERE owner_id=$1)', [owner.userId]);
        await client.query('DELETE FROM projects WHERE owner_id=$1', [owner.userId]);
        await client.query('DELETE FROM hestia_auth_user WHERE id=$1 AND email=$2', [owner.userId, email]);
      }
      if (invitationId) await client.query('DELETE FROM hestia_invitation WHERE id=$1 AND email=$2', [invitationId, email]);
    });
  } finally { await pool.end(); }
});
const op = () => randomUUID();
const create = () => createProject(owner, { name: '合成候选事务验证', template: 'courtyard', operationId: op() });
const draft = (projectId: string, revision = 1) => createCandidate(owner, projectId, { operationId: op(), expectedRevision: revision, name: '候选布局' });
const edit = (candidate: CandidateView, x: number, z = 1.2, objectId = 'sofa-a', yaw = 0) => editCandidate(owner, candidate.projectId, candidate.id, {
  operationId: op(), expectedCandidateRevision: candidate.revision, command: { type: 'move-furniture', objectId, x, z, yaw },
});
const check = (candidate: CandidateView) => checkCandidate(owner, candidate.projectId, candidate.id, { operationId: op(), expectedCandidateRevision: candidate.revision });
async function presented(candidate: CandidateView) {
  const report = await check(candidate); assert.equal(report.adoptable, true);
  const presentation = await presentCandidate(browser, candidate.projectId, candidate.id, { operationId: op(), expectedCandidateRevision: candidate.revision, expectedRevision: candidate.baseRevision, checkId: report.id });
  return { report, presentation };
}
async function selected(candidate: CandidateView) {
  const { report, presentation } = await presented(candidate);
  const selection = await selectCandidate(browser, candidate.projectId, candidate.id, { operationId: op(), presentationId: presentation.id });
  return { report, presentation, selection, input: { operationId: op(), expectedRevision: candidate.baseRevision, selectionId: selection.id } };
}
async function saved(id: string) {
  return transaction(async client => {
    const result: Record<string, unknown> = {};
    result.project = (await client.query('SELECT snapshot,revision FROM projects WHERE id=$1', [id])).rows[0];
    for (const table of ['operations', 'project_revisions', 'project_commands', 'candidates', 'candidate_adoptions']) {
      result[table] = (await client.query(`SELECT to_jsonb(t) AS value FROM ${table} t WHERE project_id=$1 ORDER BY to_jsonb(t)::text`, [id])).rows;
    }
    for (const table of ['candidate_revisions', 'candidate_checks', 'candidate_presentations']) {
      result[table] = (await client.query(`SELECT to_jsonb(t) AS value FROM ${table} t WHERE candidate_id IN(SELECT id FROM candidates WHERE project_id=$1) ORDER BY to_jsonb(t)::text`, [id])).rows;
    }
    result.selections = (await client.query('SELECT to_jsonb(s) AS value FROM candidate_selections s JOIN candidate_presentations p ON p.id=s.presentation_id JOIN candidates c ON c.id=p.candidate_id WHERE c.project_id=$1 ORDER BY s.id', [id])).rows;
    return result;
  });
}

test('candidate create/edit/read are isolated; replay is stable and never adopts', async () => {
  const project = await create(), input = { operationId: op(), expectedRevision: 1, name: '独立候选' };
  const [a, b] = await Promise.all([createCandidate(owner, project.id, input), createCandidate(owner, project.id, input)]);
  assert.equal(a.id, b.id); assert.equal(a.revision, 1);
  const changed = await edit(a, 4);
  assert.equal(changed.revision, 2); assert.deepEqual(changed.changedObjectIds, ['sofa-a']);
  assert.equal((await getProject(owner, project.id)).revision, 1);
  assert.equal((await getProject(owner, project.id)).scene.objects.find(o => o.id === 'sofa-a')!.position.x, 3);
  assert.equal((await getCandidate(owner, project.id, a.id)).scene.objects.find(o => o.id === 'sofa-a')!.position.x, 4);
  assert.equal((await listCandidates(owner, project.id)).candidates.length, 1);
  assert.equal((await listCandidates(owner, project.id)).undoableAdoption, null);
  assert.deepEqual((await saved(project.id)).candidate_adoptions, []);
  await assert.rejects(createCandidate(owner, project.id, { ...input, name: '不同请求' }), { code: 'IDEMPOTENCY_CONFLICT' });
});
test('edit idempotency and candidate optimistic concurrency prevent duplicate or lost changes', async () => {
  const project = await create(), candidate = await draft(project.id);
  const request = { operationId: op(), expectedCandidateRevision: 1, command: { type: 'move-furniture', objectId: 'sofa-a', x: 4, z: 1.2, yaw: .1 } };
  const [a, b] = await Promise.all([editCandidate(owner, project.id, candidate.id, request), editCandidate(owner, project.id, candidate.id, request)]);
  assert.equal(a.revision, 2); assert.equal(b.revision, 2);
  await assert.rejects(editCandidate(owner, project.id, candidate.id, { ...request, operationId: op() }), { code: 'CANDIDATE_REVISION_CONFLICT' });
  await assert.rejects(editCandidate(owner, project.id, candidate.id, { ...request, command: { ...request.command, x: 3.5 } }), { code: 'IDEMPOTENCY_CONFLICT' });
});
test('ownership, strict fields, fixed facts, lock and bounded edit angles remain enforced', async () => {
  const project = await create(); await executeCommand(owner, project.id, { operationId: op(), expectedRevision: 1, command: { type: 'set-lock', objectId: 'sofa-a', locked: true } });
  const candidate = await draft(project.id, 2), baseline = await saved(project.id);
  await assert.rejects(getCandidate(outsider, project.id, candidate.id), { code: 'NOT_FOUND' });
  await assert.rejects(listCandidates(outsider, project.id), { code: 'NOT_FOUND' });
  await assert.rejects(createCandidate(outsider, project.id, { operationId: op(), expectedRevision: 2, name: '越权' }), { code: 'NOT_FOUND' });
  await assert.rejects(edit(candidate, 4), { code: 'OBJECT_LOCKED' });
  await assert.rejects(edit(candidate, 1, 1, 'fixed-a'), { code: 'FIXED_FACT' });
  await assert.rejects(edit(candidate, 1, 1, 'unknown'), { code: 'OBJECT_NOT_FOUND' });
  const command = { type: 'move-furniture', objectId: 'table-a', x: 4, z: 3, yaw: 0 };
  for (const addition of [{ approved: true }, { size: { width: .1 } }, { locked: false }, { y: 1 }])
    await assert.rejects(editCandidate(owner, project.id, candidate.id, { operationId: op(), expectedCandidateRevision: 1, command: { ...command, ...addition } }));
  await assert.rejects(edit(candidate, 4, 3, 'table-a', 7));
  assert.deepEqual(await saved(project.id), baseline);
});
test('draft overlaps can be corrected and the entire final layout is validated together', async () => {
  const project = await create(), initial = await draft(project.id);
  const overlap = await edit(initial, 3, 3); const failed = await check(overlap);
  assert.equal(failed.adoptable, false); assert.ok(failed.issues.some(i => i.code === 'FURNITURE_COLLISION'));
  const swapped = await edit(overlap, 3, 1.2, 'table-a', .15), report = await check(swapped);
  assert.equal(report.adoptable, true); assert.ok(report.checks.some(c => !c.required && c.status === 'not-checked'));
  assert.equal((await getProject(owner, project.id)).revision, 1);
  const choice = await selected(swapped), result = await adoptCandidate(owner, project.id, swapped.id, choice.input);
  assert.equal(result.project.revision, 2); assert.notEqual(result.project.currentLayout.id, project.currentLayout.id);
  assert.equal(result.project.scene.objects.find(o => o.id === 'sofa-a')!.position.z, 3);
  assert.equal(result.project.scene.objects.find(o => o.id === 'table-a')!.position.z, 1.2);
  assert.deepEqual(result.project.fixedFacts, project.fixedFacts);
  assert.equal((await listCommands(owner, project.id)).length, 0);
});
test('unknown scale and missing necessary door coverage do not authorize adoption', async () => {
  for (const problem of ['scale', 'door']) {
    const project = await create();
    if (problem === 'scale') await pool.query("UPDATE projects SET snapshot=jsonb_set(snapshot,'{scale}','\"missing\"') WHERE id=$1", [project.id]);
    else await pool.query("UPDATE projects SET snapshot=jsonb_set(snapshot,'{fixedFacts,openingClearances}','[]') WHERE id=$1", [project.id]);
    const candidate = await edit(await draft(project.id), 4), report = await check(candidate);
    assert.equal(report.adoptable, false); assert.ok(report.checks.some(c => c.required && c.status === 'not-checked'));
    await assert.rejects(presentCandidate(browser, project.id, candidate.id, { operationId: op(), expectedCandidateRevision: 2, expectedRevision: 1, checkId: report.id }), { code: 'CANDIDATE_NOT_ADOPTABLE' });
    assert.equal((await getProject(owner, project.id)).revision, 1);
  }
});
test('old checks, presentations and selections expire when candidate content changes', async () => {
  const project = await create(), first = await edit(await draft(project.id), 4), choice = await selected(first);
  const changed = await edit(first, 4.1);
  await assert.rejects(presentCandidate(browser, project.id, changed.id, { operationId: op(), expectedCandidateRevision: changed.revision, expectedRevision: 1, checkId: choice.report.id }), { code: 'STALE_CHECK' });
  await assert.rejects(selectCandidate(browser, project.id, changed.id, { operationId: op(), presentationId: choice.presentation.id }), { code: 'STALE_PRESENTATION' });
  await assert.rejects(adoptCandidate(owner, project.id, changed.id, choice.input), { code: 'STALE_SELECTION' });
  assert.equal((await getProject(owner, project.id)).revision, 1);
});
test('a changed project invalidates preview authorization and is reported stale', async () => {
  const project = await create(), candidate = await edit(await draft(project.id), 4), choice = await selected(candidate);
  await executeCommand(owner, project.id, { operationId: op(), expectedRevision: 1, command: { type: 'set-lock', objectId: 'sofa-a', locked: true } });
  assert.equal((await getCandidate(owner, project.id, candidate.id)).stale, true);
  for (const work of [() => edit(candidate, 4.1), () => check(candidate), () => selectCandidate(browser, project.id, candidate.id, { operationId: op(), presentationId: choice.presentation.id }), () => adoptCandidate(owner, project.id, candidate.id, { ...choice.input, expectedRevision: 2 })])
    await assert.rejects(work(), { code: 'REVISION_CONFLICT' });
});
test('worker-like principals cannot mint user choices and preview never implies approval', async () => {
  const project = await create(), candidate = await edit(await draft(project.id), 4), { presentation } = await presented(candidate);
  const baseline = await saved(project.id);
  await assert.rejects(selectCandidate({ userId: owner.userId, sessionHash: browser.sessionHash }, project.id, candidate.id, { operationId: op(), presentationId: presentation.id }), { code: 'USER_SELECTION_REQUIRED' });
  await assert.rejects(adoptCandidate(owner, project.id, candidate.id, { operationId: op(), expectedRevision: 1, selectionId: randomUUID() }), { code: 'USER_SELECTION_REQUIRED' });
  await assert.rejects(adoptCandidate(owner, project.id, candidate.id, { operationId: op(), expectedRevision: 1, selectionId: randomUUID(), approved: true }));
  await assert.rejects(browserUser(new Request(authOrigin, { headers: { Origin: 'https://invalid.example' } })), { code: 'ORIGIN_REJECTED' });
  assert.deepEqual(await saved(project.id), baseline);
});
test('missing persisted coverage cannot be passed as a valid check', async () => {
  const project = await create(), candidate = await edit(await draft(project.id), 4), report = await check(candidate);
  const incomplete = { adoptable: true, issues: report.issues, checks: report.checks.filter(c => c.code !== 'walls') };
  await pool.query('UPDATE candidate_checks SET report=$1 WHERE id=$2', [incomplete, report.id]);
  await assert.rejects(presentCandidate(browser, project.id, candidate.id, { operationId: op(), expectedCandidateRevision: 2, expectedRevision: 1, checkId: report.id }), { code: 'STALE_CHECK' });
});
test('concurrent identical adoption commits once and replay returns current authoritative state', async () => {
  const project = await create(), candidate = await edit(await draft(project.id), 4), choice = await selected(candidate);
  const results = await Promise.all([adoptCandidate(owner, project.id, candidate.id, choice.input), adoptCandidate(owner, project.id, candidate.id, choice.input)]);
  assert.equal(results[0].project.revision, 2); assert.equal(results[1].project.revision, 2);
  assert.equal(results[0].adoption.operationId, choice.input.operationId);
  await executeCommand(owner, project.id, { operationId: op(), expectedRevision: 2, command: { type: 'move-furniture', objectId: 'sofa-a', x: 4.1, z: 1.2, yaw: 0 } });
  const replay = await adoptCandidate(owner, project.id, candidate.id, choice.input);
  assert.equal(replay.project.revision, 3); assert.equal(replay.adoption.revision, 2); assert.equal(replay.undoableAdoption, null);
  assert.equal((await getCandidate(owner, project.id, candidate.id)).revision, 2);
  await assert.rejects(edit(candidate, 4.2), { code: 'CANDIDATE_ADOPTED' });
});
test('competing candidates can only adopt one from the same base revision', async () => {
  const project = await create(), a = await edit(await draft(project.id), 4), b = await edit(await draft(project.id), 3.8);
  const sa = await selected(a), sb = await selected(b);
  const results = await Promise.allSettled([adoptCandidate(owner, project.id, a.id, sa.input), adoptCandidate(owner, project.id, b.id, sb.input)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code, 'REVISION_CONFLICT');
  assert.equal((await getProject(owner, project.id)).revision, 2);
});
test('whole adoption undo restores all poses with new layout identity and stable retry', async () => {
  const project = await create();
  const earlier = await executeCommand(owner, project.id, { operationId: op(), expectedRevision: 1, command: { type: 'move-furniture', objectId: 'sofa-a', x: 3.3, z: 1.2, yaw: .05 } });
  const original = await getProject(owner, project.id), candidate = await edit(await edit(await draft(project.id, 2), 3, 3), 3, 1.2, 'table-a', .15);
  const choice = await selected(candidate), adopted = await adoptCandidate(owner, project.id, candidate.id, choice.input);
  assert.ok((await listCommands(owner, project.id)).every(c => !c.undoable));
  const input = { operationId: op(), expectedRevision: 3 };
  const undone = await undoAdoption(owner, project.id, adopted.adoption.operationId, input);
  assert.equal(undone.project.revision, 4); assert.deepEqual(undone.project.scene.objects, original.scene.objects);
  assert.notEqual(undone.project.currentLayout.id, adopted.project.currentLayout.id); assert.notEqual(undone.project.currentLayout.id, original.currentLayout.id);
  assert.equal(undone.adoption.undoneBy, input.operationId); assert.equal(undone.undoableAdoption, null);
  assert.equal((await undoAdoption(owner, project.id, adopted.adoption.operationId, input)).project.revision, 4);
  await assert.rejects(undoAdoption(owner, project.id, adopted.adoption.operationId, { operationId: op(), expectedRevision: 4 }), { code: 'UNDO_ADOPTION_CONFLICT' });
  await assert.rejects(executeCommand(owner, project.id, { operationId: op(), expectedRevision: 4, command: { type: 'undo', targetOperationId: earlier.operation.id } }), { code: 'UNDO_DEPENDENCY' });
  assert.equal((await getCandidate(owner, project.id, candidate.id)).status, 'adopted');
});
test('any subsequent project revision prevents whole-layout undo without overwriting it', async () => {
  const project = await create(), candidate = await edit(await draft(project.id), 4), choice = await selected(candidate);
  const adopted = await adoptCandidate(owner, project.id, candidate.id, choice.input);
  await renameProject(owner, project.id, { operationId: op(), expectedRevision: 2, name: '保留后续修改' });
  const baseline = await saved(project.id);
  assert.equal((await listCandidates(owner, project.id)).undoableAdoption, null);
  await assert.rejects(undoAdoption(owner, project.id, adopted.adoption.operationId, { operationId: op(), expectedRevision: 3 }), { code: 'UNDO_ADOPTION_CONFLICT' });
  assert.deepEqual(await saved(project.id), baseline);
});
test('adoption and undo faults after snapshot UPDATE roll back all tables and authorization consumption', async () => {
  const project = await create(), candidate = await edit(await draft(project.id), 4), choice = await selected(candidate);
  const snapshot = (await pool.query('SELECT snapshot FROM projects WHERE id=$1', [project.id])).rows[0].snapshot;
  await pool.query('INSERT INTO project_revisions(project_id,revision,snapshot,operation_id) VALUES($1,2,$2,$3)', [project.id, snapshot, op()]);
  const baseline = await saved(project.id);
  await assert.rejects(adoptCandidate(owner, project.id, candidate.id, choice.input), { code: '23505' });
  assert.deepEqual(await saved(project.id), baseline);
  await pool.query('DELETE FROM project_revisions WHERE project_id=$1 AND revision=2', [project.id]);
  const adopted = await adoptCandidate(owner, project.id, candidate.id, choice.input);
  await pool.query('INSERT INTO project_revisions(project_id,revision,snapshot,operation_id) VALUES($1,3,$2,$3)', [project.id, snapshot, op()]);
  const beforeUndo = await saved(project.id);
  await assert.rejects(undoAdoption(owner, project.id, adopted.adoption.operationId, { operationId: op(), expectedRevision: 2 }), { code: '23505' });
  assert.deepEqual(await saved(project.id), beforeUndo);
  await pool.query('DELETE FROM project_revisions WHERE project_id=$1 AND revision=3', [project.id]);
});

const catalogOptions = (assetId: string, materialId = 'prototype-wood') => {
  const asset = getCatalog().assets.find(asset => asset.id === assetId)!;
  return { assetId: asset.id, assetVersion: asset.version, materialId, materialVersion: 1, size: asset.defaultSize };
};
const catalogEdit = (candidate: CandidateView, command: unknown) => editCandidate(owner, candidate.projectId, candidate.id, { operationId: op(), expectedCandidateRevision: candidate.revision, command });
test('T15 add/replace/remove preserve explicit complete differences and survive adoption/reopen/whole undo', async () => {
  const project = await create(), baseline = await getProject(owner, project.id);
  let candidate = await draft(project.id);
  candidate = await catalogEdit(candidate, { type: 'add-furniture', ...catalogOptions('prototype-reading-chair'), x: 5, z: 4, yaw: .2 });
  const added = candidate.objectChanges.find(change => change.kind === 'added')!;
  assert.ok(added.objectId.startsWith('furniture-')); assert.equal(added.before, null); assert.equal(added.after!.dimensionSource, 'catalog');
  candidate = await catalogEdit(candidate, { type: 'replace-furniture', objectId: 'sofa-a', ...catalogOptions('prototype-sofa', 'prototype-cream') });
  candidate = await catalogEdit(candidate, { type: 'remove-furniture', objectId: 'table-a' });
  assert.deepEqual(candidate.objectChanges.map(change => change.kind).sort(), ['added', 'removed', 'replaced']);
  const replacement = candidate.objectChanges.find(change => change.kind === 'replaced')!;
  assert.deepEqual(replacement.before!.size, baseline.scene.objects.find(object => object.id === 'sofa-a')!.size);
  assert.equal(replacement.before!.dimensionSource, undefined); assert.equal(replacement.after!.catalog!.assetId, 'prototype-sofa');
  assert.deepEqual(replacement.after!.position, replacement.before!.position);
  assert.deepEqual(await getProject(owner, project.id), baseline);
  const choice = await selected(candidate), adopted = await adoptCandidate(owner, project.id, candidate.id, choice.input);
  assert.equal(adopted.project.scene.objects.some(object => object.id === 'table-a'), false);
  assert.equal(adopted.project.scene.objects.find(object => object.id === 'sofa-a')!.catalog!.materialId, 'prototype-cream');
  assert.deepEqual((await getProject(owner, project.id)).scene.objects, adopted.project.scene.objects);
  const undone = await undoAdoption(owner, project.id, adopted.adoption.operationId, { operationId: op(), expectedRevision: 2 });
  assert.deepEqual(undone.project.scene.objects, baseline.scene.objects);
  const history = await getCandidate(owner, project.id, candidate.id);
  assert.equal(history.status, 'adopted'); assert.equal(history.objectChanges.find(change => change.kind === 'added')!.after!.catalog!.assetVersion, 1);
});
test('T15 add retries keep the generated instance ID and reject made-up assets, materials, versions and dimensions', async () => {
  const project = await create(), candidate = await draft(project.id);
  const command = { type: 'add-furniture', ...catalogOptions('prototype-reading-chair'), x: 5, z: 4, yaw: 0 };
  const input = { operationId: op(), expectedCandidateRevision: 1, command };
  const [a, b] = await Promise.all([editCandidate(owner, project.id, candidate.id, input), editCandidate(owner, project.id, candidate.id, input)]);
  assert.equal(a.revision, 2); assert.equal(b.revision, 2); assert.equal(a.objectChanges[0].objectId, b.objectChanges[0].objectId);
  const before = await saved(project.id);
  for (const patch of [{ assetId: 'invented' }, { assetVersion: 99 }, { materialId: 'invented' }, { materialVersion: 99 }, { size: { ...command.size, width: .1 } }, { size: { ...command.size, width: .701 } }, { objectId: 'fixed-a' }, { dimensionSource: 'measured' }])
    await assert.rejects(catalogEdit(a, { ...command, ...patch }));
  assert.deepEqual(await saved(project.id), before);
});
test('T15 measured and locked furniture cannot be replaced, deleted or relabeled; fixed facts cannot be removed and re-added', async () => {
  const project = await create(); await executeCommand(owner, project.id, { operationId: op(), expectedRevision: 1, command: { type: 'set-lock', objectId: 'table-a', locked: true } });
  await pool.query("UPDATE projects SET snapshot=jsonb_set(snapshot,'{currentLayout,objects,0,dimensionSource}','\"measured\"') WHERE id=$1", [project.id]);
  const candidate = await draft(project.id, 2), baseline = await saved(project.id);
  for (const [objectId, code] of [['sofa-a', 'MEASURED_FURNITURE_PROTECTED'], ['table-a', 'OBJECT_LOCKED'], ['fixed-a', 'FIXED_FACT']]) {
    await assert.rejects(catalogEdit(candidate, { type: 'remove-furniture', objectId }), { code });
    await assert.rejects(catalogEdit(candidate, { type: 'replace-furniture', objectId, ...catalogOptions('prototype-reading-chair') }), { code });
  }
  await assert.rejects(catalogEdit(candidate, { type: 'move-furniture', objectId: 'sofa-a', x: 4, z: 1.2, yaw: 0, size: { width: .2, height: .2, depth: .2 } }));
  assert.deepEqual(await saved(project.id), baseline);
  const moved = await edit(candidate, 3.2); assert.equal(moved.scene.objects.find(object => object.id === 'sofa-a')!.dimensionSource, 'measured'); assert.equal((await check(moved)).adoptable, true);
});
test('T15 newly added geometry is checked against final layout and stale user selection cannot authorize later composition edits', async () => {
  const project = await create(), candidate = await draft(project.id);
  const overlap = await catalogEdit(candidate, { type: 'add-furniture', ...catalogOptions('prototype-reading-chair'), x: 3, z: 1.2, yaw: 0 });
  const report = await check(overlap); assert.equal(report.adoptable, false); assert.ok(report.issues.some(issue => issue.code === 'FURNITURE_COLLISION'));
  const objectId = overlap.objectChanges.find(change => change.kind === 'added')!.objectId;
  const valid = await edit(overlap, 5, 4, objectId), choice = await selected(valid);
  const changed = await catalogEdit(valid, { type: 'remove-furniture', objectId: 'table-a' });
  await assert.rejects(adoptCandidate(owner, project.id, changed.id, choice.input), { code: 'STALE_SELECTION' });
  assert.equal((await getProject(owner, project.id)).revision, 1);
});
test('T16 palette-only replacement must use the separate style command instead of a furniture layout', async () => {
  const project = await create();
  const initial = await catalogEdit(await draft(project.id), { type: 'replace-furniture', objectId: 'sofa-a', ...catalogOptions('prototype-sofa') });
  const choice = await selected(initial), adopted = await adoptCandidate(owner, project.id, initial.id, choice.input);
  const candidate = await draft(project.id, adopted.project.revision);
  await assert.rejects(catalogEdit(candidate, { type: 'replace-furniture', objectId: 'sofa-a', ...catalogOptions('prototype-sofa', 'prototype-cream') }), { code: 'STYLE_REQUIRES_OVERRIDE' });
  assert.equal((await getCandidate(owner, project.id, candidate.id)).revision, 1);
});
