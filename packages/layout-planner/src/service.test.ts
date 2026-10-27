import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { pool, transaction } from '../../persistence/src/client';
import { createInvitation, acceptInvitation } from '../../identity/src/service';
import { auth, authOrigin } from '../../identity/src/auth';
import { browserUser, type BrowserUser } from '../../candidates/src/browser-user';
import { createProject, getProject } from '../../projects/src/service';
import { createTask, getTask, appendConversationInput, readTaskEvents } from '../../tasks/src/service';
import { claimTask, fenced } from '../../tasks/src/runner';
import { initializeQueue } from '../../tasks/src/queue';
import { getCandidate, editCandidate, checkCandidate, presentCandidate, selectCandidate, adoptCandidate, undoAdoption, listCandidates } from '../../candidates/src/service';
import { syntheticPlanningInput } from './fixtures';
import { planRoomCandidateInTransaction } from './service';

const email = `planner-${randomUUID()}@example.test`, password = randomUUID(), schema = `planner_${randomUUID().replaceAll('-', '')}`;
let owner: { userId: string }, browser: BrowserUser, invitationId: string, producer: PgBoss;
before(async () => {
  producer = await initializeQueue(schema);
  const invitation = await createInvitation(email); invitationId = invitation.id;
  owner = { userId: (await acceptInvitation(invitation.token, '合成布局验收', password)).userId };
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  browser = await browserUser(new Request(authOrigin, { headers: { Origin: authOrigin, Cookie: response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') } }));
});
after(async () => {
  try { await transaction(async client => {
    if (owner) {
      await client.query('DELETE FROM operations WHERE owner_id=$1', [owner.userId]);
      await client.query('DELETE FROM project_revisions WHERE project_id IN(SELECT id FROM projects WHERE owner_id=$1)', [owner.userId]);
      await client.query('DELETE FROM projects WHERE owner_id=$1', [owner.userId]);
      await client.query('DELETE FROM hestia_auth_user WHERE id=$1 AND email=$2', [owner.userId, email]);
    }
    if (invitationId) await client.query('DELETE FROM hestia_invitation WHERE id=$1 AND email=$2', [invitationId, email]);
    assert.match(schema, /^planner_[a-f0-9]{32}$/); await client.query(`DROP SCHEMA ${schema} CASCADE`);
  }); } finally { await pool.end(); }
});
async function prepared() {
  const fixture = syntheticPlanningInput(), project = await createProject(owner, { name: '单房间合成布局', template: 'empty', operationId: randomUUID() });
  await pool.query('UPDATE projects SET snapshot=$2 WHERE id=$1', [project.id, fixture.state]);
  const task = await createTask(owner, project.id, { protocol: 'conversation-v1', operationId: randomUUID(), expectedRevision: 1,
    message: fixture.brief.inputs[0].text, referenceFrame: 'plan' }, producer);
  const claim = (await claimTask(task.id))!;
  const input = { ownerId: owner.userId, projectId: project.id, baseRevision: 1, operationId: randomUUID(), taskId: task.id, intentVersion: 1,
    input: task.conversation!.input, brief: task.conversation!.brief!, decision: { ...fixture.decision, sourceInputIds: [task.conversation!.brief!.inputs[0].id] } };
  return { fixture, project, task, claim, input };
}
async function generate(item: Awaited<ReturnType<typeof prepared>>) {
  return transaction(async client => { await fenced(client, item.claim); const result = await planRoomCandidateInTransaction(client, item.input); await fenced(client, item.claim); return result; });
}
async function waitSelection(item: Awaited<ReturnType<typeof prepared>>, result: Awaited<ReturnType<typeof generate>>) {
  await pool.query("UPDATE design_tasks SET status='waiting_selection',lease_until=NULL,conversation=jsonb_set(conversation,'{outcome}',$2::jsonb) WHERE id=$1", [item.task.id, JSON.stringify({ kind: 'candidate', candidateId: result.candidateId, candidateRevision: result.candidateRevision, message: '合成推荐待选择' })]);
}
test('planner candidate + check commit once; replay retains metrics and does not change current project', async () => {
  const item = await prepared(), result = await generate(item); assert.equal(result.status, 'recommended', result.report.reason);
  const replay = await generate(item); assert.deepEqual(replay, result);
  const candidate = await getCandidate(owner, item.project.id, result.candidateId!);
  assert.equal(candidate.check!.adoptable, true); assert.equal(candidate.check!.id, result.checkId);
  assert.ok(candidate.check!.checks.some(c => c.code === 'planner-entry-functional-route-0.7m' && c.status === 'passed'));
  assert.equal((await listCandidates(owner, item.project.id)).candidates.length, 1);
  assert.equal((await getProject(owner, item.project.id)).revision, 1);
  assert.deepEqual((await getProject(owner, item.project.id)).scene.objects, item.fixture.state.currentLayout.objects);
});
test('caller fence expiry rolls back planned candidate, check and operation together', async () => {
  const item = await prepared();
  await assert.rejects(transaction(async client => {
    await fenced(client, item.claim); const result = await planRoomCandidateInTransaction(client, item.input); assert.equal(result.status, 'recommended');
    await client.query("UPDATE design_tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [item.task.id]);
    await fenced(client, item.claim);
  }), { code: 'TASK_FENCE_LOST' });
  assert.equal((await listCandidates(owner, item.project.id)).candidates.length, 0);
  assert.equal((await pool.query('SELECT 1 FROM operations WHERE owner_id=$1 AND id=$2', [owner.userId, item.input.operationId])).rowCount, 0);
});
test('source intent change makes old candidate stale even without any project revision change', async () => {
  const item = await prepared(), result = await generate(item); await waitSelection(item, result);
  const candidate = await getCandidate(owner, item.project.id, result.candidateId!);
  const presentation = await presentCandidate(browser, item.project.id, candidate.id, { operationId: randomUUID(), expectedCandidateRevision: 1, expectedRevision: 1, checkId: result.checkId });
  const selection = await selectCandidate(browser, item.project.id, candidate.id, { operationId: randomUUID(), presentationId: presentation.id });
  await appendConversationInput(owner, item.project.id, item.task.id, { kind: 'message', operationId: randomUUID(), expectedRevision: 1, expectedIntentVersion: 1, message: '只整理需求，暂不生成方案' }, producer);
  assert.equal((await getCandidate(owner, item.project.id, candidate.id)).stale, true);
  assert.equal((await listCandidates(owner, item.project.id)).candidates[0].stale, true);
  await assert.rejects(checkCandidate(owner, item.project.id, candidate.id, { operationId: randomUUID(), expectedCandidateRevision: 1 }), { code: 'STALE_PLANNER_INTENT' });
  await assert.rejects(adoptCandidate(owner, item.project.id, candidate.id, { operationId: randomUUID(), expectedRevision: 1, selectionId: selection.id }), { code: 'STALE_PLANNER_INTENT' });
  assert.equal((await getProject(owner, item.project.id)).revision, 1); assert.equal((await getTask(owner, item.project.id, item.task.id)).status, 'queued');
});
test('actual browser selection adopts one whole candidate, releases matching task and supports whole undo', async () => {
  const item = await prepared(), result = await generate(item); await waitSelection(item, result);
  const presentation = await presentCandidate(browser, item.project.id, result.candidateId!, { operationId: randomUUID(), expectedCandidateRevision: 1, expectedRevision: 1, checkId: result.checkId });
  const selection = await selectCandidate(browser, item.project.id, result.candidateId!, { operationId: randomUUID(), presentationId: presentation.id });
  const operationId = randomUUID(), request = { operationId, expectedRevision: 1, selectionId: selection.id };
  await adoptCandidate(owner, item.project.id, result.candidateId!, request);
  await adoptCandidate(owner, item.project.id, result.candidateId!, request);
  assert.equal((await getProject(owner, item.project.id)).revision, 2);
  assert.equal((await getTask(owner, item.project.id, item.task.id)).status, 'completed');
  const events = (await readTaskEvents(owner, item.project.id, item.task.id, 0)).events.filter(e => e.data.adoptedOperationId === operationId);
  assert.equal(events.length, 1);
  await undoAdoption(owner, item.project.id, operationId, { operationId: randomUUID(), expectedRevision: 2 });
  assert.equal((await getProject(owner, item.project.id)).revision, 3);
  assert.deepEqual((await getProject(owner, item.project.id)).scene.objects, item.fixture.state.currentLayout.objects);
});

test('adopting a user-edited recommendation releases its matching task without relabelling the original plan report', async () => {
  const item = await prepared(), result = await generate(item); await waitSelection(item, result);
  const edited = await editCandidate(owner, item.project.id, result.candidateId!, { operationId: randomUUID(), expectedCandidateRevision: 1,
    command: { type: 'set-display-lighting', presetId: 'display-neutral', presetVersion: 1 } });
  assert.equal(edited.revision, 2);
  const check = await checkCandidate(owner, item.project.id, edited.id, { operationId: randomUUID(), expectedCandidateRevision: 2 });
  assert.equal(check.adoptable, true);
  const presentation = await presentCandidate(browser, item.project.id, edited.id, { operationId: randomUUID(), expectedCandidateRevision: 2,
    expectedRevision: 1, checkId: check.id });
  const selection = await selectCandidate(browser, item.project.id, edited.id, { operationId: randomUUID(), presentationId: presentation.id });
  const operationId = randomUUID();
  await adoptCandidate(owner, item.project.id, edited.id, { operationId, expectedRevision: 1, selectionId: selection.id });
  const task = await getTask(owner, item.project.id, item.task.id);
  assert.equal(task.status, 'completed'); assert.equal(task.conversation!.outcome!.candidateRevision, 1);
  assert.equal(task.conversation!.outcome!.projectRevision, 2); assert.equal(task.conversation!.outcome!.operationId, operationId);
  const adopted = (await readTaskEvents(owner, item.project.id, item.task.id, 0)).events.find(event => event.data.adoptedOperationId === operationId)!;
  assert.equal(adopted.data.candidateRevision, 2);
  const next = await createTask(owner, item.project.id, { protocol: 'conversation-v1', operationId: randomUUID(), expectedRevision: 2,
    message: '解释当前候选与原布局的差别', referenceFrame: 'plan' }, producer);
  assert.equal(next.status, 'queued');
});
