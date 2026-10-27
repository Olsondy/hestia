import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createInvitation } from '../../packages/identity/src/service';
import { pool, transaction } from '../../packages/persistence/src/client';
import type { CandidateView, CandidateCheck, CandidatePresentation, CandidateSelection, AdoptionResult } from '../../packages/contracts/src/candidates';
import type { CatalogView } from '../../packages/contracts/src/catalog';

const origin = new URL(process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000').origin;
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Only local synthetic validation is allowed.');
const emails = [0, 1].map(i => `candidate-http-${randomUUID()}-${i}@example.test`), password = randomUUID();
let cookie = '', otherCookie = '', current = 'setup', projectId = '';
const checks: string[] = [], op = () => randomUUID();
async function call(path: string, method = 'GET', payload?: unknown, selectedCookie = cookie, selectedOrigin = origin) {
  return fetch(origin + path, { method, headers: { ...(selectedCookie ? { Cookie: selectedCookie } : {}), ...(payload === undefined ? {} : { 'Content-Type': 'application/json', Origin: selectedOrigin }) }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
}
async function status(response: Response, expected = 200) { assert.equal(response.status, expected, `${current}: HTTP status`); return response.json(); }
async function check(name: string, run: () => Promise<void>) { current = name; await run(); checks.push(name); }
const root = () => `/api/projects/${projectId}/candidates`;
const endpoint = (candidate: CandidateView, action = '') => `${root()}/${candidate.id}${action ? `/${action}` : ''}`;
async function create(revision: number) { return (await status(await call(root(), 'POST', { operationId: op(), expectedRevision: revision, name: 'HTTP候选' }), 201)).candidate as CandidateView; }
async function edit(candidate: CandidateView, x: number, z = 1.2, objectId = 'sofa-a') {
  return (await status(await call(endpoint(candidate, 'commands'), 'POST', { operationId: op(), expectedCandidateRevision: candidate.revision, command: { type: 'move-furniture', objectId, x, z, yaw: 0 } }))).candidate as CandidateView;
}
async function validated(candidate: CandidateView) { return (await status(await call(endpoint(candidate, 'checks'), 'POST', { operationId: op(), expectedCandidateRevision: candidate.revision }))).check as CandidateCheck; }
async function presented(candidate: CandidateView) {
  const report = await validated(candidate); assert.equal(report.adoptable, true);
  return (await status(await call(endpoint(candidate, 'presentations'), 'POST', { operationId: op(), expectedCandidateRevision: candidate.revision, expectedRevision: candidate.baseRevision, checkId: report.id }))).presentation as CandidatePresentation;
}
async function selected(candidate: CandidateView) {
  const presentation = await presented(candidate);
  const selection = (await status(await call(endpoint(candidate, 'selections'), 'POST', { operationId: op(), presentationId: presentation.id }))).selection as CandidateSelection;
  return { presentation, selection, input: { operationId: op(), expectedRevision: candidate.baseRevision, selectionId: selection.id } };
}
async function currentProject() { return (await status(await call(`/api/projects/${projectId}`))).project; }
async function adoptionCount() { return Number((await pool.query('SELECT count(*) FROM candidate_adoptions WHERE project_id=$1', [projectId])).rows[0].count); }
try {
  for (const [i, email] of emails.entries()) {
    const invitation = await createInvitation(email);
    await status(await call('/api/invitations/accept', 'POST', { token: invitation.token, name: '合成候选验证', password }, ''));
    const login = await call('/api/auth/sign-in/email', 'POST', { email, password }, ''); assert.equal(login.status, 200);
    const value = login.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
    if (i === 0) cookie = value; else otherCookie = value;
  }
  projectId = (await status(await call('/api/projects', 'POST', { name: '候选 HTTP 验证', template: 'courtyard', operationId: op() }), 201)).project.id;
  let candidate = await create(1);
  await check('anonymous and cross-account candidate endpoints deny access', async () => {
    await status(await call(root(), 'GET', undefined, ''), 401);
    await status(await call(root(), 'GET', undefined, otherCookie), 404);
    await status(await call(endpoint(candidate), 'GET', undefined, otherCookie), 404);
    await status(await call(endpoint(candidate, 'checks'), 'POST', { operationId: op(), expectedCandidateRevision: 1 }, otherCookie), 404);
    await status(await call(endpoint(candidate, 'selections'), 'POST', { operationId: op(), presentationId: op() }, otherCookie), 404);
  });
  await check('strict candidate edit scope rejects fixed facts, extra payload and unauthorized identity', async () => {
    const command = { type: 'move-furniture', objectId: 'sofa-a', x: 4, z: 1.2, yaw: 0 };
    for (const body of [
      { operationId: op(), expectedCandidateRevision: 1, command: { ...command, objectId: 'fixed-a' } },
      { operationId: op(), expectedCandidateRevision: 1, command: { ...command, size: { width: .1 } } },
      { operationId: op(), expectedCandidateRevision: 1, command, ownerId: 'forged' },
    ]) await status(await call(endpoint(candidate, 'commands'), 'POST', body), 400);
    assert.equal((await status(await call(endpoint(candidate)))).candidate.revision, 1);
    assert.equal((await currentProject()).revision, 1);
  });
  await check('hard conflicts remain draft-only and cannot become a presented adoptable version', async () => {
    candidate = await edit(candidate, -1); const report = await validated(candidate);
    assert.equal(report.adoptable, false); assert.ok(report.issues.some(issue => issue.code === 'OUT_OF_BOUNDS'));
    await status(await call(endpoint(candidate, 'presentations'), 'POST', { operationId: op(), expectedCandidateRevision: candidate.revision, expectedRevision: 1, checkId: report.id }), 400);
    assert.equal((await currentProject()).scene.objects.find((o: { id: string }) => o.id === 'sofa-a').position.x, 3);
    assert.equal(await adoptionCount(), 0);
    candidate = await edit(candidate, 4);
  });
  await check('real user presentation is separate from selection and rejects wrong origin or fabricated approval', async () => {
    const presentation = await presented(candidate);
    assert.equal(await adoptionCount(), 0); assert.equal((await currentProject()).revision, 1);
    await status(await call(endpoint(candidate, 'selections'), 'POST', { operationId: op(), presentationId: presentation.id }, cookie, 'https://invalid.example'), 403);
    await status(await call(endpoint(candidate, 'selections'), 'POST', { operationId: op(), presentationId: presentation.id }, ''), 401);
    await status(await call(endpoint(candidate, 'adopt'), 'POST', { operationId: op(), expectedRevision: 1, selectionId: op() }), 403);
    await status(await call(endpoint(candidate, 'adopt'), 'POST', { operationId: op(), expectedRevision: 1, selectionId: op(), approved: true }), 400);
    const old = (await status(await call(endpoint(candidate, 'selections'), 'POST', { operationId: op(), presentationId: presentation.id }))).selection as CandidateSelection;
    candidate = await edit(candidate, 4.1);
    const rejected = await status(await call(endpoint(candidate, 'adopt'), 'POST', { operationId: op(), expectedRevision: 1, selectionId: old.id }), 409);
    assert.equal(rejected.error.code, 'STALE_SELECTION'); assert.equal(await adoptionCount(), 0);
  });
  let adoption: AdoptionResult;
  await check('concurrent user adoption commits one revision and replays the same operation', async () => {
    const before = await currentProject(), choice = await selected(candidate);
    const responses = await Promise.all([call(endpoint(candidate, 'adopt'), 'POST', choice.input), call(endpoint(candidate, 'adopt'), 'POST', choice.input)]);
    adoption = await status(responses[0]); const retry = await status(responses[1]);
    assert.equal(adoption.project.revision, 2); assert.equal(retry.project.revision, 2);
    assert.notEqual(adoption.project.currentLayout.id, before.currentLayout.id);
    assert.equal(adoption.adoption.operationId, choice.input.operationId); assert.equal(adoption.undoableAdoption!.operationId, choice.input.operationId);
    assert.equal(await adoptionCount(), 1);
    assert.equal((await status(await call(endpoint(candidate)))).candidate.status, 'adopted');
    assert.equal((await status(await call(`/api/projects/${projectId}/commands`))).operations.length, 0);
    await status(await call(endpoint(candidate, 'commands'), 'POST', { operationId: op(), expectedCandidateRevision: candidate.revision, command: { type: 'move-furniture', objectId: 'sofa-a', x: 4.2, z: 1.2, yaw: 0 } }), 409);
  });
  await check('whole adoption undo has an independent endpoint, new layout identity and stable retries', async () => {
    const path = `/api/projects/${projectId}/adoptions/${adoption.adoption.operationId}/undo`, input = { operationId: op(), expectedRevision: 2 };
    await status(await call(path, 'POST', input, otherCookie), 404);
    const undone = await status(await call(path, 'POST', input)) as AdoptionResult;
    assert.equal(undone.project.revision, 3); assert.equal(undone.undoableAdoption, null);
    assert.notEqual(undone.project.currentLayout.id, adoption.project.currentLayout.id);
    assert.equal(undone.project.scene.objects.find(o => o.id === 'sofa-a')!.position.x, 3);
    assert.equal((await status(await call(path, 'POST', input))).project.revision, 3);
    await status(await call(path, 'POST', { operationId: op(), expectedRevision: 3 }), 409);
    assert.equal((await status(await call(root()))).undoableAdoption, null);
  });
  await check('later single-object changes disable whole adoption undo and preserve the new result', async () => {
    const next = await edit(await create(3), 3.8), choice = await selected(next);
    const adopted = await status(await call(endpoint(next, 'adopt'), 'POST', choice.input)) as AdoptionResult;
    await status(await call(`/api/projects/${projectId}/commands`, 'POST', { operationId: op(), expectedRevision: 4, command: { type: 'move-furniture', objectId: 'sofa-a', x: 4, z: 1.2, yaw: 0 } }));
    assert.equal((await status(await call(root()))).undoableAdoption, null);
    await status(await call(`/api/projects/${projectId}/adoptions/${adopted.adoption.operationId}/undo`, 'POST', { operationId: op(), expectedRevision: 5 }), 409);
    assert.equal((await currentProject()).revision, 5); assert.equal((await currentProject()).scene.objects.find((o: { id: string }) => o.id === 'sofa-a').position.x, 4);
  });
  let catalog: CatalogView, composition: CandidateView;
  const options = (id: string) => { const asset = catalog.assets.find(asset => asset.id === id)!; return { assetId: id, assetVersion: asset.version, materialId: asset.defaultMaterialId, materialVersion: 1, size: asset.defaultSize }; };
  await check('T15 catalog is authenticated and reports only source-backed versioned assets/materials', async () => {
    await status(await call('/api/catalog', 'GET', undefined, ''), 401);
    catalog = await status(await call('/api/catalog'));
    assert.equal(catalog.version, 1); assert.equal(catalog.assets.length, 4); assert.equal(catalog.materials.length, 3);
    assert.ok(catalog.assets.every(asset => asset.source.kind === 'builtin-prototype' && asset.source.dimensionBasis === 'synthetic-template' && asset.source.path.endsWith('/model.js')));
    composition = await create(5);
  });
  await check('T15 unsupported assets, versions, materials, dimensions and forged instance IDs fail atomically', async () => {
    const command = { type: 'add-furniture', ...options('prototype-reading-chair'), x: 5, z: 4, yaw: 0 };
    for (const patch of [{ assetId: 'invented' }, { assetVersion: 999 }, { materialId: 'invented' }, { materialVersion: 99 }, { size: { width: .1, height: 1, depth: .1 } }, { objectId: 'fixed-a' }, { dimensionSource: 'measured' }])
      await status(await call(endpoint(composition, 'commands'), 'POST', { operationId: op(), expectedCandidateRevision: 1, command: { ...command, ...patch } }), 400);
    assert.equal((await status(await call(endpoint(composition)))).candidate.revision, 1); assert.equal((await currentProject()).revision, 5);
  });
  await check('T15 add/replace/remove stay draft-only with explicit differences and idempotent new identity', async () => {
    const add = { operationId: op(), expectedCandidateRevision: 1, command: { type: 'add-furniture', ...options('prototype-reading-chair'), x: 5, z: 4, yaw: 0 } };
    const results = await Promise.all([call(endpoint(composition, 'commands'), 'POST', add), call(endpoint(composition, 'commands'), 'POST', add)]);
    composition = (await status(results[0])).candidate; const replay = (await status(results[1])).candidate;
    assert.equal(composition.revision, 2); assert.equal(replay.objectChanges[0].objectId, composition.objectChanges[0].objectId);
    composition = (await status(await call(endpoint(composition, 'commands'), 'POST', { operationId: op(), expectedCandidateRevision: 2, command: { type: 'replace-furniture', objectId: 'sofa-a', ...options('prototype-sofa') } }))).candidate;
    composition = (await status(await call(endpoint(composition, 'commands'), 'POST', { operationId: op(), expectedCandidateRevision: 3, command: { type: 'remove-furniture', objectId: 'table-a' } }))).candidate;
    assert.deepEqual(composition.objectChanges.map(change => change.kind).sort(), ['added', 'removed', 'replaced']);
    assert.equal(composition.objectChanges.find(change => change.kind === 'replaced')!.after!.catalog!.assetId, 'prototype-sofa');
    assert.equal((await currentProject()).revision, 5);
  });
  await check('T15 adopted catalog identities and versions reopen consistently and whole undo restores original furniture', async () => {
    const before = await currentProject(), choice = await selected(composition);
    const adopted = await status(await call(endpoint(composition, 'adopt'), 'POST', choice.input)) as AdoptionResult;
    assert.equal(adopted.project.revision, 6); assert.deepEqual((await currentProject()).scene.objects, adopted.project.scene.objects);
    assert.equal(adopted.project.scene.objects.find(object => object.id === 'sofa-a')!.catalog!.assetVersion, 1);
    const undone = await status(await call(`/api/projects/${projectId}/adoptions/${adopted.adoption.operationId}/undo`, 'POST', { operationId: op(), expectedRevision: 6 })) as AdoptionResult;
    assert.equal(undone.project.revision, 7); assert.deepEqual(undone.project.scene.objects, before.scene.objects);
    const historical = (await status(await call(endpoint(composition)))).candidate as CandidateView;
    assert.equal(historical.status, 'adopted'); assert.equal(historical.objectChanges.find(change => change.kind === 'added')!.after!.catalog!.materialVersion, 1);
  });
  await check('T15 HTTP rejects removing/replacing measured, locked or fixed objects and direct measured resizing', async () => {
    await status(await call(`/api/projects/${projectId}/commands`, 'POST', { operationId: op(), expectedRevision: 7, command: { type: 'set-lock', objectId: 'table-a', locked: true } }));
    // Mark only this test-owned synthetic sofa as a measured fixture. No production measurement endpoint is implied.
    await pool.query("UPDATE projects SET snapshot=jsonb_set(snapshot,'{currentLayout,objects,0,dimensionSource}','\"measured\"') WHERE id=$1", [projectId]);
    const protectedCandidate = await create(8);
    for (const [objectId, code] of [['sofa-a', 'MEASURED_FURNITURE_PROTECTED'], ['table-a', 'OBJECT_LOCKED'], ['fixed-a', 'FIXED_FACT']]) {
      for (const command of [{ type: 'remove-furniture', objectId }, { type: 'replace-furniture', objectId, ...options('prototype-reading-chair') }]) {
        const result = await status(await call(endpoint(protectedCandidate, 'commands'), 'POST', { operationId: op(), expectedCandidateRevision: 1, command }), 400); assert.equal(result.error.code, code);
      }
    }
    await status(await call(endpoint(protectedCandidate, 'commands'), 'POST', { operationId: op(), expectedCandidateRevision: 1, command: { type: 'move-furniture', objectId: 'sofa-a', x: 4, z: 1.2, yaw: 0, size: { width: .1, height: .1, depth: .1 } } }), 400);
    assert.equal((await status(await call(endpoint(protectedCandidate)))).candidate.revision, 1); assert.equal((await currentProject()).revision, 8);
  });
  console.log(JSON.stringify({ evidence: 'real-local-http-and-postgresql', status: 'passed', count: checks.length, checks, modelCalls: 0, realUserSamples: 0 }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', check: current, passed: checks.length,
    ...(error instanceof assert.AssertionError && typeof error.actual === 'number' ? { actual: error.actual, expected: error.expected } : {}), errorType: error instanceof Error ? error.name : 'unknown', detail: 'Sensitive response details suppressed.' })); process.exitCode = 1;
} finally {
  try {
    await transaction(async client => {
      const users = (await client.query('SELECT id FROM hestia_auth_user WHERE email=ANY($1::text[])', [emails])).rows.map(row => row.id);
      const projects = (await client.query('SELECT id FROM projects WHERE owner_id=ANY($1::text[])', [users])).rows.map(row => row.id);
      await client.query('DELETE FROM operations WHERE owner_id=ANY($1::text[])', [users]);
      await client.query('DELETE FROM resources WHERE project_id=ANY($1::uuid[])', [projects]);
      await client.query('DELETE FROM project_revisions WHERE project_id=ANY($1::uuid[])', [projects]);
      await client.query('DELETE FROM projects WHERE owner_id=ANY($1::text[])', [users]);
      await client.query('DELETE FROM hestia_invitation WHERE email=ANY($1::text[])', [emails]);
      await client.query('DELETE FROM hestia_auth_user WHERE email=ANY($1::text[])', [emails]);
    });
  } finally { await pool.end(); }
}
