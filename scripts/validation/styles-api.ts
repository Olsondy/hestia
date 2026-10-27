import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createInvitation } from '../../packages/identity/src/service';
import { pool, transaction } from '../../packages/persistence/src/client';
import type { CandidateView } from '../../packages/contracts/src/candidates';
import type { StyleCommand, StyleResult } from '../../packages/contracts/src/styles';

const origin = new URL(process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000').origin;
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Only local synthetic validation is allowed');
const emails = [0, 1].map(i => `styles-http-${randomUUID()}-${i}@example.test`), password = randomUUID(), op = () => randomUUID();
let cookie = '', otherCookie = '', projectId = '', current = 'setup'; const checks: string[] = [];
async function call(path: string, method = 'GET', payload?: unknown, selectedCookie = cookie, selectedOrigin = origin) {
  return fetch(origin + path, { method, headers: { ...(selectedCookie ? { Cookie: selectedCookie } : {}), ...(payload === undefined ? {} : { Origin: selectedOrigin, 'Content-Type': 'application/json' }) }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
}
async function status(response: Response, expected = 200) { assert.equal(response.status, expected, `${current}: HTTP status`); return response.json(); }
async function check(name: string, work: () => Promise<void>) { current = name; await work(); checks.push(name); }
const root = () => `/api/projects/${projectId}`, style = () => `${root()}/styles`;
const material: StyleCommand = { type: 'set-material', objectId: 'sofa-a', materialId: 'prototype-chinese', materialVersion: 1 };
const currentProject = async () => (await status(await call(root()))).project;
try {
  for (const [index, email] of emails.entries()) {
    const invitation = await createInvitation(email);
    await status(await call('/api/invitations/accept', 'POST', { token: invitation.token, name: '合成风格验证', password }, ''));
    const login = await call('/api/auth/sign-in/email', 'POST', { email, password }, ''); assert.equal(login.status, 200);
    const value = login.headers.getSetCookie().map(item => item.split(';')[0]).join('; '); if (index === 0) cookie = value; else otherCookie = value;
  }
  const original = (await status(await call('/api/projects', 'POST', { name: '风格 HTTP 验证', template: 'courtyard', operationId: op() }), 201)).project; projectId = original.id;
  await check('authenticated controlled style catalog and project ownership', async () => {
    await status(await call('/api/styles/catalog', 'GET', undefined, ''), 401);
    const catalog = await status(await call('/api/styles/catalog')); assert.equal(catalog.materials.length, 3); assert.equal(catalog.lighting.length, 3);
    await status(await call(style(), 'GET', undefined, ''), 401); await status(await call(style(), 'GET', undefined, otherCookie), 404);
    const state = await status(await call(style())); assert.equal(state.visualStyle.materials.length, 0); assert.equal(state.visualStyle.lighting.presetId, 'display-warm');
  });
  await check('strict target, palette, version and same-origin rejection makes no project revision', async () => {
    const commandPath = `${style()}/commands`;
    for (const command of [{ ...material, objectId: 'fixed-a' }, { ...material, materialVersion: 99 }, { ...material, materialId: 'made-up' }, { ...material, color: '#123456' }, { type: 'set-display-lighting', presetId: 'display-soft', presetVersion: 99 }])
      await status(await call(commandPath, 'POST', { operationId: op(), expectedRevision: 1, command }), 400);
    await status(await call(commandPath, 'POST', { operationId: op(), expectedRevision: 1, command: material }, cookie, 'https://invalid.example'), 403);
    await status(await call(commandPath, 'POST', { operationId: op(), expectedRevision: 1, command: material }, otherCookie), 404);
    assert.equal((await currentProject()).revision, 1);
  });
  let applied: StyleResult;
  await check('explicit current material commits idempotently without changing layout, facts or furniture and reopens', async () => {
    const input = { operationId: op(), expectedRevision: 1, command: material }, path = `${style()}/commands`;
    const responses = await Promise.all([call(path, 'POST', input), call(path, 'POST', input)]);
    applied = await status(responses[0]); const replay = await status(responses[1]);
    assert.equal(applied.project.revision, 2); assert.equal(replay.project.revision, 2); assert.deepEqual(applied.project.currentLayout, original.currentLayout);
    assert.deepEqual(applied.project.scene.objects, original.scene.objects); assert.deepEqual(applied.project.fixedFacts, original.fixedFacts);
    assert.deepEqual((await currentProject()).scene.visualStyle, applied.visualStyle);
    assert.equal((await status(await call(style()))).undoableCommand.operationId, input.operationId);
  });
  await check('dedicated current-style undo restores original scene with unchanged layout identity', async () => {
    const input = { operationId: op(), expectedRevision: 2 }, path = `${style()}/commands/${applied.operationId}/undo`;
    const undone = await status(await call(path, 'POST', input)); assert.equal(undone.project.revision, 3); assert.deepEqual(undone.project.scene, original.scene); assert.deepEqual(undone.project.currentLayout, original.currentLayout);
    assert.equal((await status(await call(path, 'POST', input))).project.revision, 3); assert.equal(undone.undoableCommand, null);
  });
  let candidate: CandidateView;
  const endpoint = (action: string) => `${root()}/candidates/${candidate.id}/${action}`;
  await check('candidate style saves and previews without applying, reports style separately from furniture', async () => {
    candidate = (await status(await call(`${root()}/candidates`, 'POST', { operationId: op(), expectedRevision: 3, name: '视觉风格候选' }), 201)).candidate;
    for (const command of [material, { type: 'set-display-lighting', presetId: 'display-soft', presetVersion: 1 }])
      candidate = (await status(await call(endpoint('commands'), 'POST', { operationId: op(), expectedCandidateRevision: candidate.revision, command }))).candidate;
    assert.equal(candidate.changeKind, 'style'); assert.equal(candidate.objectChanges.length, 0); assert.equal(candidate.styleChanges.length, 2);
    assert.equal((await currentProject()).revision, 3); assert.equal((await currentProject()).scene.visualStyle, undefined);
  });
  let adoptionId = '';
  await check('explicit user receipt adopts pure style with same layout identity; content survives reload', async () => {
    const check = (await status(await call(endpoint('checks'), 'POST', { operationId: op(), expectedCandidateRevision: candidate.revision }))).check; assert.equal(check.adoptable, true);
    const presentation = (await status(await call(endpoint('presentations'), 'POST', { operationId: op(), expectedCandidateRevision: candidate.revision, expectedRevision: 3, checkId: check.id }))).presentation;
    const selection = (await status(await call(endpoint('selections'), 'POST', { operationId: op(), presentationId: presentation.id }))).selection;
    const result = await status(await call(endpoint('adopt'), 'POST', { operationId: op(), expectedRevision: 3, selectionId: selection.id })); adoptionId = result.adoption.operationId;
    assert.equal(result.project.revision, 4); assert.deepEqual(result.project.currentLayout, original.currentLayout); assert.deepEqual(result.project.scene.visualStyle, candidate.visualStyle);
    assert.deepEqual((await currentProject()).scene.visualStyle, candidate.visualStyle);
  });
  await check('whole pure-style adoption undo restores appearance and retains exact original furniture/layout', async () => {
    const result = await status(await call(`${root()}/adoptions/${adoptionId}/undo`, 'POST', { operationId: op(), expectedRevision: 4 }));
    assert.equal(result.project.revision, 5); assert.deepEqual(result.project.scene, original.scene); assert.deepEqual(result.project.currentLayout, original.currentLayout);
  });
  await check('locked current furniture blocks both material selection and reset', async () => {
    await status(await call(`${root()}/commands`, 'POST', { operationId: op(), expectedRevision: 5, command: { type: 'set-lock', objectId: 'sofa-a', locked: true } }));
    for (const command of [material, { type: 'reset-material', objectId: 'sofa-a' }]) {
      const rejected = await status(await call(`${style()}/commands`, 'POST', { operationId: op(), expectedRevision: 6, command }), 400); assert.equal(rejected.error.code, 'OBJECT_LOCKED');
    }
    assert.equal((await currentProject()).revision, 6);
  });
  console.log(JSON.stringify({ status: 'passed', evidence: 'real-local-http-and-postgresql', count: checks.length, checks, modelCalls: 0, realUserSamples: 0 }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', check: current, passed: checks.length, errorType: error instanceof Error ? error.name : 'unknown', ...(error instanceof assert.AssertionError ? { actual: error.actual, expected: error.expected } : {}) })); process.exitCode = 1;
} finally {
  try { await transaction(async client => {
    const users = (await client.query('SELECT id FROM hestia_auth_user WHERE email=ANY($1::text[])', [emails])).rows.map(row => row.id);
    const projects = (await client.query('SELECT id FROM projects WHERE owner_id=ANY($1::text[])', [users])).rows.map(row => row.id);
    await client.query('DELETE FROM operations WHERE owner_id=ANY($1::text[])', [users]);
    await client.query('DELETE FROM resources WHERE project_id=ANY($1::uuid[])', [projects]);
    await client.query('DELETE FROM project_revisions WHERE project_id=ANY($1::uuid[])', [projects]);
    await client.query('DELETE FROM projects WHERE owner_id=ANY($1::text[])', [users]);
    await client.query('DELETE FROM hestia_invitation WHERE email=ANY($1::text[])', [emails]);
    await client.query('DELETE FROM hestia_auth_user WHERE email=ANY($1::text[])', [emails]);
  }); } finally { await pool.end(); }
}
