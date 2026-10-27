import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { createInvitation } from '../../packages/identity/src/service';
import { pool, transaction } from '../../packages/persistence/src/client';
import { runTask } from '../../packages/tasks/src/runner';
import { fixtureModel, toolChunks } from '../../packages/model-validation/src/protocol-fixture';
import type { TaskView } from '../../packages/contracts/src/tasks';
import type { ProjectView } from '../../packages/contracts/src/project';

const args = process.argv.slice(2), live = args.includes('--live-synthetic');
if (args.some(arg => arg !== '--live-synthetic' && !/^--evidence-tag=[a-z0-9-]{1,40}$/.test(arg))) throw new Error('Unsupported validation argument');
const tag = args.find(arg => arg.startsWith('--evidence-tag='))?.split('=')[1] ?? 'initial';
const directory = new URL('../../.impeccable/review/t10/', import.meta.url);
await mkdir(directory, { recursive: true });
const evidencePath = new URL(`backend-${live ? 'live' : 'fixture'}-${tag}.json`, directory);
// Refuse to replace any earlier evidence before authentication, database mutation or model calls.
const evidenceFile = await open(evidencePath, 'wx'); await evidenceFile.writeFile(JSON.stringify({ status: 'started', live, maxCalls: live ? 2 : 0 })); await evidenceFile.close();
const origin = new URL(process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000').origin;
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Only an existing local application is supported');
const emails = [0, 1].map(i => `requirements-http-${randomUUID()}-${i}@example.test`), password = randomUUID();
let cookie = '', otherCookie = '', check = 'setup', calls = 0;
const ids: string[] = [], checks: string[] = [], evidence: unknown[] = [];
async function call(path: string, method = 'GET', payload?: unknown, selectedCookie = cookie, selectedOrigin = origin) {
  return fetch(origin + path, { method, headers: { ...(selectedCookie ? { Cookie: selectedCookie } : {}), ...(payload === undefined ? {} : { Origin: selectedOrigin, 'Content-Type': 'application/json' }) },
    body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
}
async function status(response: Response, expected = 200) { assert.equal(response.status, expected, check); return response.json(); }
async function record(task: TaskView) {
  const row = (await pool.query('SELECT conversation FROM design_tasks WHERE id=$1', [task.id])).rows[0].conversation;
  evidence.push({ check, task, configuration: row.configuration, response: row.response });
}
try {
  for (const [index, email] of emails.entries()) {
    const invitation = await createInvitation(email);
    await status(await call('/api/invitations/accept', 'POST', { token: invitation.token, name: '合成需求验收', password }, ''));
    const login = await call('/api/auth/sign-in/email', 'POST', { email, password }, ''); assert.equal(login.status, 200);
    const value = login.headers.getSetCookie().map(item => item.split(';')[0]).join('; '); if (index === 0) cookie = value; else otherCookie = value;
  }
  const project: ProjectView = (await status(await call('/api/projects', 'POST', { name: '合成需求验收', template: 'courtyard', operationId: randomUUID() }), 201)).project;
  const path = `/api/projects/${project.id}/tasks`;
  const message = '请只整理居住需求，暂不生成方案或改动空间。我需要会客和办公，并保留现有书桌。先回答20厘米等于多少米；阅读发生在白天还是夜间会影响照明，这项信息我还没给，请只问我这一项。';
  const request = { protocol: 'conversation-v1', operationId: randomUUID(), expectedRevision: 1, message, referenceFrame: 'plan' };
  let task: TaskView = (await status(await call(path, 'POST', request), 202)).task; ids.push(task.id);
  const taskPath = `${path}/${task.id}`, inputPath = `${taskPath}/inputs`;
  const firstInputId = task.conversation!.brief!.inputs[0].id;
  const firstFixture = { reply: '20厘米等于0.2米。先整理会客、办公和保留书桌的需求；阅读通常在白天还是夜间？',
    decision: { kind: 'answer', message: '先整理已有需求，未修改空间。' },
    brief: { summary: '会客、办公并保留书桌；阅读时间待补充。', requirements: [{ content: '会客、办公并保留现有书桌', sourceKind: 'assistant_suggestion', sourceInputIds: [firstInputId] }],
      questions: [{ key: 'reading_time', prompt: '通常在白天还是夜间阅读？' }] } };
  check = 'known requirements and independent question answered before waiting';
  const events = await call(`${taskPath}/events?after=0`); assert.equal(events.status, 200); await events.body?.cancel();
  if (live) calls++;
  await runTask(task.id, live ? {} : { conversation: { model: fixtureModel(toolChunks(firstFixture, 'resolve_turn')) } });
  task = (await status(await call(taskPath))).task; await record(task);
  assert.equal(task.status, 'waiting_input'); assert.equal(task.conversation!.brief!.intentVersion, 1);
  const row = (await pool.query('SELECT conversation,lease_until FROM design_tasks WHERE id=$1', [task.id])).rows[0];
  assert.match(row.conversation.response.reply, /(?:0[.．]20*|零点二)\s*(?:米|m\b)/u);
  assert.equal(row.lease_until, null); assert.equal(task.usage.reserved, 0); assert.equal(task.usage.used, 1);
  assert.ok(task.conversation!.brief!.requirements.length > 0); assert.ok(task.conversation!.brief!.requirements.some(item => item.sourceInputIds.includes(firstInputId)));
  const questions = task.conversation!.brief!.questions.filter(item => item.status === 'open'); assert.equal(questions.length, 1);
  assert.match(questions[0].prompt, /阅读|读书/u); assert.ok(task.conversation!.brief!.workCompleted.length > 0);
  checks.push(check);

  check = 'input identity, ownership, strict schema and same-origin checks';
  const followup = { kind: 'message', operationId: randomUUID(), expectedIntentVersion: 1, expectedRevision: 1,
    questionId: questions[0].id, message: '主要在晚上阅读，每晚1小时。' };
  await status(await call(inputPath, 'POST', followup, ''), 401);
  await status(await call(inputPath, 'POST', followup, otherCookie), 404);
  await status(await call(inputPath, 'POST', followup, cookie, 'https://invalid.example'), 403);
  await status(await call(inputPath, 'POST', { ...followup, sourceKind: 'user_confirmed' }), 400);
  task = (await status(await call(inputPath, 'POST', followup), 202)).task;
  const repeated: TaskView = (await status(await call(inputPath, 'POST', followup), 202)).task;
  assert.equal(task.id, repeated.id); assert.equal(repeated.conversation!.brief!.inputs.length, 2); assert.equal(task.conversation!.brief!.intentVersion, 2);
  assert.equal(task.conversation!.brief!.questions[0].answerInputId, task.conversation!.brief!.inputs[1].id);
  assert.equal(task.conversation!.brief!.history.length, 1); assert.ok(task.conversation!.brief!.history[0].reply);
  checks.push(check);

  check = 'second round preserves answer provenance without repeating answered question or expanding scope';
  const secondFixture = { reply: '已记录夜间阅读，每晚1小时。可据此整理独立照明建议，尚未生成设计方案。', decision: { kind: 'answer', message: '已整理需求。' },
    brief: { summary: '会客、办公、保留书桌；夜间阅读每晚1小时。', requirements: [{ content: followup.message, sourceKind: 'user_explicit', sourceInputIds: [task.conversation!.brief!.inputs[1].id] }], questions: [] } };
  if (live) calls++;
  await runTask(task.id, live ? {} : { conversation: { model: fixtureModel(toolChunks(secondFixture, 'resolve_turn')) } });
  task = (await status(await call(taskPath))).task; await record(task);
  assert.equal(task.status, 'completed'); assert.equal(task.conversation!.brief!.questions.filter(item => item.status === 'open').length, 0);
  assert.equal(task.conversation!.brief!.questions[0].status, 'answered'); assert.equal(task.conversation!.brief!.intentVersion, 2);
  assert.equal(task.conversation!.brief!.scope, 'requirements_and_local_changes'); assert.equal(task.usage.used, 2);
  assert.ok(task.conversation!.brief!.requirements.some(item => item.sourceInputIds.includes(task.conversation!.brief!.inputs[1].id)));
  assert.ok(task.conversation!.brief!.requirements.every(item => item.sourceKind !== 'user_confirmed'));
  const after: ProjectView = (await status(await call(`/api/projects/${project.id}`))).project;
  assert.equal(after.revision, 1); assert.deepEqual(after.scene.objects, project.scene.objects);
  assert.equal((await pool.query("SELECT 1 FROM task_events WHERE task_id=$1 AND type='operation'", [task.id])).rowCount, 0);
  const replay = await call(`${taskPath}/events?after=0`); assert.match(await replay.text(), /waiting_input/);
  checks.push(check);
  console.log(JSON.stringify({ status: 'passed', evidence: live ? 'real-model-synthetic-two-rounds' : 'real-http-db-sdk-substitute', checks, realModelInvocationAttempts: calls, workerProcesses: 0 }));
} catch (error) {
  evidence.push({ failedCheck: check, errorType: error instanceof Error ? error.name : 'unknown', errorCode: typeof error === 'object' && error !== null && 'code' in error ? error.code : null });
  console.error(JSON.stringify({ status: 'failed', check, passed: checks, errorType: error instanceof Error ? error.name : 'unknown', realModelInvocationAttempts: calls })); process.exitCode = 1;
} finally {
  await writeFile(evidencePath, JSON.stringify({ passed: !process.exitCode, live, realModelInvocationAttempts: calls, checks, evidence }, null, 2));
  try { await transaction(async client => {
    const users = (await client.query('SELECT id FROM hestia_auth_user WHERE email=ANY($1::text[])', [emails])).rows.map(row => row.id);
    const projects = (await client.query('SELECT id FROM projects WHERE created_by=ANY($1::text[])', [users])).rows.map(row => row.id);
    await client.query("DELETE FROM hestia_jobs.job WHERE data->>'taskId'=ANY($1::text[])", [ids]);
    await client.query('DELETE FROM operations WHERE actor_id=ANY($1::text[])', [users]);
    await client.query('DELETE FROM project_revisions WHERE project_id=ANY($1::uuid[])', [projects]);
    await client.query('DELETE FROM projects WHERE created_by=ANY($1::text[])', [users]);
    await client.query('DELETE FROM hestia_invitation WHERE email=ANY($1::text[])', [emails]);
    await client.query('DELETE FROM hestia_auth_user WHERE email=ANY($1::text[])', [emails]);
  }); } finally { await pool.end(); }
}
