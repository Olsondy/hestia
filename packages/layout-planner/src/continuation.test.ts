import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { pool } from '../../persistence/src/client';
import { createProject, getProject } from '../../projects/src/service';
import { executeCommand } from '../../commands/src/service';
import { createTask, getTask, appendConversationInput, readTaskEvents } from '../../tasks/src/service';
import { initializeQueue } from '../../tasks/src/queue';
import { runTask } from '../../tasks/src/runner';
import { getCandidate, listCandidates, checkCandidate } from '../../candidates/src/service';
import { fixtureModel, toolChunks } from '../../model-validation/src/protocol-fixture';
import type { TaskView } from '../../contracts/src/tasks';
import { syntheticPlanningInput } from './fixtures';

const owner = { userId: `continuation-${randomUUID()}` }, schema = `continuation_${randomUUID().replaceAll('-', '')}`;
let producer: PgBoss;
before(async () => { producer = await initializeQueue(schema); });
after(async () => {
  try {
    await pool.query('DELETE FROM operations WHERE actor_id=$1', [owner.userId]);
    await pool.query('DELETE FROM project_revisions WHERE project_id IN (SELECT id FROM projects WHERE created_by=$1)', [owner.userId]);
    await pool.query('DELETE FROM projects WHERE created_by=$1', [owner.userId]);
    assert.match(schema, /^continuation_[a-f0-9]{32}$/); await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  } finally { await pool.end(); }
});
async function create() {
  const fixture = syntheticPlanningInput();
  const project = await createProject(owner, { name: '合成任务续作', template: 'empty', operationId: randomUUID() });
  await pool.query('UPDATE projects SET snapshot=$2 WHERE id=$1', [project.id, fixture.state]);
  const task = await createTask(owner, project.id, { protocol: 'conversation-v1', operationId: randomUUID(), expectedRevision: 1,
    message: fixture.brief.inputs[0].text, referenceFrame: 'plan' }, producer);
  return { fixture, project, task };
}
const proposal = (task: TaskView, fixture: ReturnType<typeof syntheticPlanningInput>) => {
  const brief = task.conversation!.brief!, last = brief.inputs.at(-1)!;
  return fixtureModel(toolChunks({ reply: '固定协议测试：按已有目标与最新要求检查候选。',
    decision: { ...fixture.decision, sourceInputIds: [last.id], requirementIds: brief.requirements.filter(item => item.sourceKind !== 'assistant_suggestion').map(item => item.id) },
    brief: { summary: '会客办公与用户补充条件', requirements: [{ content: last.text, sourceKind: 'user_explicit', sourceInputIds: [last.id] }], questions: [] } }, 'resolve_turn'));
};
const append = (task: TaskView, message: string, expectedRevision = task.checkpoint.expectedRevision) =>
  appendConversationInput(owner, task.projectId, task.id, { kind: 'message', operationId: randomUUID(),
    expectedIntentVersion: task.conversation!.brief!.intentVersion, expectedRevision, message }, producer);

test('supplement keeps the earlier goal and rechecks unchanged candidate as a new candidate without reusing its approval', async () => {
  const { project, task, fixture } = await create();
  await runTask(task.id, { conversation: { model: proposal(task, fixture) } });
  const first = await getTask(owner, project.id, task.id), firstOutcome = first.conversation!.outcome!;
  assert.equal(first.status, 'waiting_selection'); assert.ok(firstOutcome.candidateId);
  const oldCandidate = await getCandidate(owner, project.id, firstOutcome.candidateId!);
  const next = await append(first, '保留现有家具');
  assert.equal(next.conversation!.brief!.intentVersion, 2);
  assert.equal((await getCandidate(owner, project.id, firstOutcome.candidateId!)).stale, true);
  await assert.rejects(checkCandidate(owner, project.id, firstOutcome.candidateId!, { operationId: randomUUID(), expectedCandidateRevision: 1 }), { code: 'STALE_PLANNER_INTENT' });
  await runTask(task.id, { intentVersion: 2, conversation: { model: proposal(next, fixture) } });
  const current = await getTask(owner, project.id, task.id), outcome = current.conversation!.outcome!;
  assert.equal(current.status, 'waiting_selection'); assert.notEqual(outcome.candidateId, firstOutcome.candidateId);
  assert.notEqual(outcome.checkId, firstOutcome.checkId); assert.equal(outcome.planReport!.source.intentVersion, 2);
  assert.deepEqual(outcome.planReport!.source.reusedFromCandidate, { id: firstOutcome.candidateId, revision: 1 });
  assert.ok(outcome.planReport!.source.inputIds.includes(first.conversation!.brief!.inputs[0].id));
  assert.ok(outcome.planReport!.source.inputIds.includes(next.conversation!.brief!.inputs[1].id));
  const revised = await getCandidate(owner, project.id, outcome.candidateId!);
  assert.equal(revised.check!.adoptable, true); assert.deepEqual(revised.scene.objects, oldCandidate.scene.objects);
  assert.equal((await getProject(owner, project.id)).revision, 1); assert.equal(current.usage.used, 2);
  assert.equal((await listCandidates(owner, project.id)).candidates.length, 2);
});

test('new preserve-pose input fences a late proposal and continues the original task with unchanged real sofa position', async () => {
  const { project, task, fixture } = await create(); let next!: TaskView;
  await runTask(task.id, { conversation: { model: proposal(task, fixture), afterResponsePersisted: async () => { next = await append(task, '原位保留沙发'); } } });
  assert.equal(next.status, 'queued'); assert.equal((await listCandidates(owner, project.id)).candidates.length, 0);
  assert.equal(next.conversation!.brief!.history[0].status, 'superseded'); assert.equal(next.usage.used, 1);
  await runTask(task.id, { intentVersion: 2, conversation: { model: proposal(next, fixture) } });
  const saved = await getTask(owner, project.id, task.id), outcome = saved.conversation!.outcome!;
  assert.equal(saved.status, 'waiting_selection', saved.error?.message); assert.equal(saved.usage.used, 2);
  assert.equal((await listCandidates(owner, project.id)).candidates.length, 1);
  const candidate = await getCandidate(owner, project.id, outcome.candidateId!);
  assert.deepEqual(candidate.scene.objects.find(object => object.id === 'existing-sofa'), fixture.state.currentLayout.objects[0]);
  assert.equal(outcome.planReport!.source.intentVersion, 2); assert.equal((await getProject(owner, project.id)).revision, 1);
  const events = (await readTaskEvents(owner, project.id, task.id, 0)).events;
  assert.equal(events.filter(event => event.type === 'operation').length, 0);
});

test('a manual project edit during model generation rejects the old candidate and preserves the manual revision', async () => {
  const { project, task, fixture } = await create();
  await runTask(task.id, { conversation: { model: proposal(task, fixture), afterResponsePersisted: async () => {
    await executeCommand(owner, project.id, { operationId: randomUUID(), expectedRevision: 1,
      command: { type: 'move-furniture', objectId: 'existing-sofa', x: 3.3, z: 1.2, yaw: 0 } });
  } } });
  const saved = await getTask(owner, project.id, task.id), after = await getProject(owner, project.id);
  assert.equal(saved.status, 'failed'); assert.equal(saved.error?.code, 'REVISION_CONFLICT');
  assert.equal(after.revision, 2); assert.equal(after.scene.objects.find(object => object.id === 'existing-sofa')!.position.x, 3.3);
  assert.equal((await listCandidates(owner, project.id)).candidates.length, 0);
});

test('a manual edit before the supplement uses the new project pose rather than an older candidate or snapshot', async () => {
  const { project, task, fixture } = await create();
  await runTask(task.id, { conversation: { model: proposal(task, fixture) } });
  const first = await getTask(owner, project.id, task.id); assert.equal(first.status, 'waiting_selection');
  const oldId = first.conversation!.outcome!.candidateId!;
  await executeCommand(owner, project.id, { operationId: randomUUID(), expectedRevision: 1,
    command: { type: 'move-furniture', objectId: 'existing-sofa', x: 3.3, z: 1.2, yaw: 0 } });
  const next = await append(first, '原位保留沙发', 2);
  await runTask(task.id, { intentVersion: 2, conversation: { model: proposal(next, fixture) } });
  const saved = await getTask(owner, project.id, task.id), outcome = saved.conversation!.outcome!;
  assert.equal(saved.status, 'waiting_selection', saved.error?.message);
  assert.equal(outcome.planReport!.source.reusedFromCandidate, undefined);
  const candidate = await getCandidate(owner, project.id, outcome.candidateId!);
  assert.equal(candidate.baseRevision, 2);
  assert.equal(candidate.scene.objects.find(object => object.id === 'existing-sofa')!.position.x, 3.3);
  assert.equal((await getProject(owner, project.id)).revision, 2);
  assert.equal((await getCandidate(owner, project.id, oldId)).stale, true);
});
