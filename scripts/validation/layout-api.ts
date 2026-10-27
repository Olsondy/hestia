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
import type { ProjectView } from '../../packages/contracts/src/project';

const args = process.argv.slice(2), live = args.includes('--live-synthetic');
if (args.some(arg => arg !== '--live-synthetic' && !/^--evidence-tag=[a-z0-9-]{1,40}$/.test(arg))) throw new Error('Unsupported validation argument');
const tag = args.find(arg => arg.startsWith('--evidence-tag='))?.split('=')[1] ?? 'initial';
const directory = new URL('../../.impeccable/review/t17-t21/', import.meta.url);
await mkdir(directory, { recursive: true });
const evidencePath = new URL(`layout-${live ? 'live' : 'fixture'}-${tag}.json`, directory);
const file = await open(evidencePath, 'wx');
await file.writeFile(JSON.stringify({ status: 'started', synthetic: true, maximumNetworkDispatches: live ? 1 : 0 })); await file.close();
const origin = new URL(process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000').origin;
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Only the existing local application is supported');
const email = `layout-http-${randomUUID()}@example.test`, password = randomUUID();
let cookie = '', taskId: string | null = null, networkDispatches = 0;
let evidence: Record<string, unknown> = { synthetic: true, live, maximumNetworkDispatches: live ? 1 : 0 };
async function request(path: string, method = 'GET', payload?: unknown) {
  return fetch(origin + path, { method, headers: { Cookie: cookie,
    ...(payload === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }) },
    body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
}
async function json(response: Response, expected = 200) { assert.equal(response.status, expected); return response.json(); }
try {
  const invitation = await createInvitation(email);
  await json(await request('/api/invitations/accept', 'POST', { token: invitation.token, name: '合成布局验收', password }));
  const login = await request('/api/auth/sign-in/email', 'POST', { email, password }); assert.equal(login.status, 200);
  cookie = login.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
  const project: ProjectView = (await json(await request('/api/projects', 'POST', { name: '单房间合成布局验收', template: 'empty', operationId: randomUUID() }), 201)).project;
  const synthetic = syntheticPlanningInput();
  // This exact owned test project receives generated geometry, never a user's drawing.
  await pool.query('UPDATE projects SET snapshot=$2 WHERE id=$1', [project.id, synthetic.state]);
  const before: ProjectView = (await json(await request(`/api/projects/${project.id}`))).project;
  const path = `/api/projects/${project.id}/tasks`;
  const payload = { protocol: 'conversation-v1', operationId: randomUUID(), expectedRevision: 1,
    message: synthetic.brief.inputs[0].text, referenceFrame: 'plan' };
  const task: TaskView = (await json(await request(path, 'POST', payload), 202)).task; taskId = task.id;
  assert.equal((await json(await request(path, 'POST', payload), 202)).task.id, task.id);
  const stream = await request(`${path}/${task.id}/events?after=0`); assert.equal(stream.status, 200); await stream.body?.cancel();
  if (live) {
    const config = productionConfigurations()[0];
    await runTask(task.id, { conversation: { configurations: [{ ...config, createModel: onDispatch => config.createModel(() => {
      if (networkDispatches >= 1) throw new Error('SYNTHETIC_LIVE_CALL_LIMIT');
      networkDispatches++; onDispatch();
    }) }] } });
  } else {
    await runTask(task.id, { conversation: { model: fixtureModel(toolChunks({ reply: '合成协议测试：提出会客办公候选，实际检查以应用结果为准。',
      decision: { ...synthetic.decision, sourceInputIds: [task.conversation!.brief!.inputs[0].id] } }, 'resolve_turn')) } });
  }
  const saved: TaskView = (await json(await request(`${path}/${task.id}`))).task;
  const after: ProjectView = (await json(await request(`/api/projects/${project.id}`))).project;
  const internal = (await pool.query('SELECT conversation FROM design_tasks WHERE id=$1', [task.id])).rows[0].conversation;
  evidence = { ...evidence, task: saved, response: internal.response, configuration: internal.configuration,
    effectiveDecision: internal.effectiveDecision, networkDispatches, beforeScene: before.scene, afterScene: after.scene };
  assert.equal(saved.status, 'waiting_selection'); assert.equal(saved.conversation?.outcome?.kind, 'candidate');
  const outcome = saved.conversation!.outcome!;
  assert.ok(outcome.candidateId); assert.equal(outcome.planReport?.status, 'recommended');
  assert.equal(after.revision, before.revision); assert.deepEqual(after.scene, before.scene);
  const candidate = (await json(await request(`/api/projects/${project.id}/candidates/${outcome.candidateId}`))).candidate;
  evidence.candidate = candidate;
  assert.equal(candidate.check.adoptable, true); assert.equal(candidate.check.id, outcome.checkId);
  assert.ok(candidate.check.checks.some((item: { code: string; status: string }) => item.code === 'planner-entry-functional-route-0.7m' && item.status === 'passed'));
  assert.ok(candidate.objectChanges.length); assert.ok(candidate.scene.objects.length > before.scene.objects.length);
  assert.equal(candidate.synthetic, true); assert.equal(saved.usage.used, 1);
  if (live) assert.equal(networkDispatches, 1);
  const completeReply = internal.response.reply;
  assert.ok(typeof completeReply === 'string' && completeReply.trim());
  evidence.passed = true;
  console.log(JSON.stringify({ passed: true, synthetic: true, live, networkDispatches, candidateGenerated: true, currentProjectUnchanged: true,
    modelUsage: internal.response.usage, elapsedMs: internal.response.elapsedMs, firstReplyMs: internal.response.firstReplyMs, search: outcome.planReport?.metrics }));
} catch (error) {
  evidence.passed = false; evidence.networkDispatches = networkDispatches;
  evidence.failure = { type: error instanceof Error ? error.name : 'unknown', code: typeof error === 'object' && error !== null && 'code' in error ? error.code : null };
  console.error(JSON.stringify({ passed: false, live, networkDispatches, failure: evidence.failure })); process.exitCode = 1;
} finally {
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  try { await transaction(async client => {
    const users = (await client.query('SELECT id FROM hestia_auth_user WHERE email=$1', [email])).rows.map(row => row.id);
    const projects = (await client.query('SELECT id FROM projects WHERE created_by=ANY($1::text[])', [users])).rows.map(row => row.id);
    if (taskId) await client.query("DELETE FROM hestia_jobs.job WHERE data->>'taskId'=$1", [taskId]);
    await client.query('DELETE FROM operations WHERE actor_id=ANY($1::text[])', [users]);
    await client.query('DELETE FROM project_revisions WHERE project_id=ANY($1::uuid[])', [projects]);
    await client.query('DELETE FROM projects WHERE created_by=ANY($1::text[])', [users]);
    await client.query('DELETE FROM hestia_invitation WHERE email=$1', [email]);
    await client.query('DELETE FROM hestia_auth_user WHERE email=$1', [email]);
  }); } finally { await pool.end(); }
}
