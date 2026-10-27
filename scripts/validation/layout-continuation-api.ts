import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { createInvitation } from '../../packages/identity/src/service';
import { pool, transaction } from '../../packages/persistence/src/client';
import { syntheticPlanningInput } from '../../packages/layout-planner/src/fixtures';
import { productionConfigurations } from '../../packages/conversation/src/configurations';
import { runTask } from '../../packages/tasks/src/runner';
import { fixtureModel, toolChunks } from '../../packages/model-validation/src/protocol-fixture';
import type { TaskView } from '../../packages/contracts/src/tasks';
import type { CandidateView } from '../../packages/contracts/src/candidates';
import type { ProjectView } from '../../packages/contracts/src/project';

// Finite synthetic validation; the flag is a test harness limit, not a product budget.
const args = process.argv.slice(2), live = args.includes('--live-synthetic');
if (args.some(arg => arg !== '--live-synthetic' && !/^--evidence-tag=[a-z0-9-]{1,40}$/.test(arg))) throw new Error('Unsupported validation argument');
const tag = args.find(arg => arg.startsWith('--evidence-tag='))?.split('=')[1] ?? 'initial';
const directory = new URL('../../.impeccable/review/t19/', import.meta.url);
await mkdir(directory, { recursive: true });
const evidencePath = new URL(`continuation-${live ? 'live' : 'fixture'}-${tag}.json`, directory);
const file = await open(evidencePath, 'wx');
await file.writeFile(JSON.stringify({ status: 'started', synthetic: true, maximumNetworkDispatches: live ? 2 : 0, maximumPerRound: live ? 1 : 0 })); await file.close();
const origin = new URL(process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000').origin;
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Only the existing local application is supported');
const email = `continuation-http-${randomUUID()}@example.test`, password = randomUUID();
let cookie = '', taskId: string | null = null, dispatches = 0, roundDispatches = 0, check = 'setup';
const evidence: Record<string, unknown> = { synthetic: true, live, maximumNetworkDispatches: live ? 2 : 0, maximumPerRound: live ? 1 : 0, rounds: [] };
async function request(path: string, method = 'GET', payload?: unknown) {
  return fetch(origin + path, { method, headers: { Cookie: cookie,
    ...(payload === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }) },
    body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
}
async function json(response: Response, expected = 200) { assert.equal(response.status, expected, check); return response.json(); }
try {
  const invitation = await createInvitation(email);
  await json(await request('/api/invitations/accept', 'POST', { token: invitation.token, name: '合成需求续作验收', password }));
  const login = await request('/api/auth/sign-in/email', 'POST', { email, password }); assert.equal(login.status, 200);
  cookie = login.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
  const project: ProjectView = (await json(await request('/api/projects', 'POST', { name: '单房间续作合成验收', template: 'empty', operationId: randomUUID() }), 201)).project;
  const synthetic = syntheticPlanningInput();
  await pool.query('UPDATE projects SET snapshot=$2 WHERE id=$1', [project.id, synthetic.state]);
  const projectPath = `/api/projects/${project.id}`, path = `${projectPath}/tasks`;
  const before: ProjectView = (await json(await request(projectPath))).project;
  const initialPayload = { protocol: 'conversation-v1', operationId: randomUUID(), expectedRevision: 1,
    message: synthetic.brief.inputs[0].text, referenceFrame: 'plan' };
  let task: TaskView = (await json(await request(path, 'POST', initialPayload), 202)).task; taskId = task.id;
  const taskPath = `${path}/${task.id}`;
  const stream = await request(`${taskPath}/events?after=0`); assert.equal(stream.status, 200); await stream.body?.cancel();
  const configurations = live ? productionConfigurations() : [];
  async function runRound(current: TaskView) {
    roundDispatches = 0;
    if (live) {
      const config = configurations[0];
      await runTask(current.id, { intentVersion: current.conversation!.brief!.intentVersion,
        conversation: { configurations: [{ ...config, createModel: onDispatch => config.createModel(() => {
          // Called immediately before fetch; retries cannot exceed either cap.
          if (roundDispatches >= 1 || dispatches >= 2) throw new Error('SYNTHETIC_LIVE_CALL_LIMIT');
          roundDispatches++; dispatches++; onDispatch();
        }) }] } });
    } else {
      const brief = current.conversation!.brief!, last = brief.inputs.at(-1)!;
      await runTask(current.id, { intentVersion: brief.intentVersion, conversation: { model: fixtureModel(toolChunks({
        reply: '固定协议样本：检查当前要求并提出候选，应用后才记录实际结果。',
        decision: { ...synthetic.decision, sourceInputIds: [last.id], requirementIds: brief.requirements.filter(item => item.sourceKind !== 'assistant_suggestion').map(item => item.id) },
        brief: { summary: '会客和办公，保留现有家具与本轮条件。', requirements: [{ content: last.text, sourceKind: 'user_explicit', sourceInputIds: [last.id] }], questions: [] },
      }, 'resolve_turn')) } });
    }
    const saved: TaskView = (await json(await request(taskPath))).task;
    const internal = (await pool.query('SELECT conversation FROM design_tasks WHERE id=$1', [current.id])).rows[0].conversation;
    const outcome = saved.conversation?.outcome;
    let candidate: CandidateView | null = null;
    if (outcome?.candidateId) candidate = (await json(await request(`${projectPath}/candidates/${outcome.candidateId}`))).candidate;
    (evidence.rounds as unknown[]).push({ task: saved, response: internal.response, configuration: internal.configuration,
      effectiveDecision: internal.effectiveDecision, candidate, networkDispatches: roundDispatches });
    return { saved, candidate, outcome, response: internal.response };
  }
  check = 'first round creates one unadopted candidate';
  const first = await runRound(task);
  assert.equal(first.saved.status, 'waiting_selection'); assert.equal(first.outcome?.kind, 'candidate');
  assert.equal(first.outcome?.planReport?.status, 'recommended'); assert.ok(first.candidate?.check?.adoptable);
  if (live) assert.equal(roundDispatches, 1);
  const oldPath = `${projectPath}/candidates/${first.candidate!.id}`;
  const presentation = (await json(await request(`${oldPath}/presentations`, 'POST', { operationId: randomUUID(),
    expectedCandidateRevision: first.candidate!.revision, expectedRevision: 1, checkId: first.outcome!.checkId }))).presentation;
  const selection = (await json(await request(`${oldPath}/selections`, 'POST', { operationId: randomUUID(), presentationId: presentation.id }))).selection;
  check = 'supplement advances intent and invalidates the old selection';
  const message = '原位保留沙发', operationId = randomUUID();
  task = (await json(await request(`${taskPath}/inputs`, 'POST', { kind: 'message', operationId, expectedIntentVersion: 1, expectedRevision: 1, message }), 202)).task;
  assert.equal(task.id, taskId); assert.equal(task.conversation!.brief!.intentVersion, 2);
  assert.equal((await json(await request(oldPath))).candidate.stale, true);
  const oldAdoption = await request(`${oldPath}/adopt`, 'POST', { operationId: randomUUID(), expectedRevision: 1, selectionId: selection.id });
  const rejected = await json(oldAdoption, 409); assert.equal(rejected.error.code, 'STALE_PLANNER_INTENT');
  check = 'second round continues the earlier scope under the new original-pose constraint';
  const second = await runRound(task); evidence.oldAdoption = { status: oldAdoption.status, code: rejected.error.code };
  assert.equal(second.saved.status, 'waiting_selection'); assert.equal(second.outcome?.kind, 'candidate');
  assert.equal(second.outcome?.planReport?.status, 'recommended'); assert.ok(second.candidate?.check?.adoptable);
  assert.notEqual(second.candidate!.id, first.candidate!.id); assert.notEqual(second.outcome!.checkId, first.outcome!.checkId);
  assert.equal(second.saved.id, first.saved.id); assert.equal(second.saved.conversation!.brief!.intentVersion, 2);
  const provenance = second.outcome!.planReport!.source.inputIds, inputs = second.saved.conversation!.brief!.inputs;
  assert.ok(provenance.includes(inputs[0].id) && provenance.includes(inputs[1].id));
  const originalSofa = before.scene.objects.find(item => item.id === 'existing-sofa')!;
  const afterSofa = second.candidate!.scene.objects.find(item => item.id === originalSofa.id)!;
  assert.deepEqual(afterSofa, originalSofa);
  for (const role of ['prototype-study-desk', 'prototype-reading-chair'])
    assert.ok(second.candidate!.scene.objects.some(item => item.catalog?.assetId === role));
  const after: ProjectView = (await json(await request(projectPath))).project;
  assert.equal(after.revision, before.revision); assert.deepEqual(after.scene, before.scene);
  assert.equal(second.saved.usage.used, 2); if (live) assert.equal(roundDispatches, 1);
  evidence.beforeScene = before.scene; evidence.afterScene = after.scene; evidence.passed = true; evidence.networkDispatches = dispatches;
  console.log(JSON.stringify({ passed: true, live, synthetic: true, networkDispatches: dispatches, taskId,
    firstCandidate: first.candidate!.id, secondCandidate: second.candidate!.id, oldSelectionRejected: true, projectRevision: after.revision,
    rounds: [first, second].map(round => ({ intentVersion: round.saved.conversation!.brief!.intentVersion, usage: round.response?.usage,
      elapsedMs: round.response?.elapsedMs, firstReplyMs: round.response?.firstReplyMs, metrics: round.outcome?.planReport?.metrics })) }));
} catch (error) {
  evidence.passed = false; evidence.networkDispatches = dispatches; evidence.failedCheck = check;
  evidence.failure = { type: error instanceof Error ? error.name : 'unknown', code: typeof error === 'object' && error !== null && 'code' in error ? error.code : null };
  console.error(JSON.stringify({ passed: false, live, check, networkDispatches: dispatches, failure: evidence.failure })); process.exitCode = 1;
} finally {
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  try { await transaction(async client => {
    const users = (await client.query('SELECT id FROM hestia_auth_user WHERE email=$1', [email])).rows.map(row => row.id);
    const projects = (await client.query('SELECT id FROM projects WHERE owner_id=ANY($1::text[])', [users])).rows.map(row => row.id);
    if (taskId) await client.query("DELETE FROM hestia_jobs.job WHERE data->>'taskId'=$1", [taskId]);
    await client.query('DELETE FROM operations WHERE owner_id=ANY($1::text[])', [users]);
    await client.query('DELETE FROM project_revisions WHERE project_id=ANY($1::uuid[])', [projects]);
    await client.query('DELETE FROM projects WHERE owner_id=ANY($1::text[])', [users]);
    await client.query('DELETE FROM hestia_invitation WHERE email=$1', [email]);
    await client.query('DELETE FROM hestia_auth_user WHERE email=$1', [email]);
  }); } finally { await pool.end(); }
}
