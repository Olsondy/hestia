import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInvitation } from '../../packages/identity/src/service';
import { pool, transaction } from '../../packages/persistence/src/client';
import { runTask } from '../../packages/tasks/src/runner';
import { fixtureModel, toolChunks } from '../../packages/model-validation/src/protocol-fixture';
import type { TaskView } from '../../packages/contracts/src/tasks';
import type { ProjectView } from '../../packages/contracts/src/project';

const mixed = process.argv.includes('--live-mixed');
const live = process.argv.includes('--live-synthetic') || mixed;
if (process.argv.slice(2).some(arg => !['--live-synthetic', '--live-mixed'].includes(arg)) || (mixed && process.argv.includes('--live-synthetic')))
  throw new Error('Use either --live-synthetic (three original cases) or --live-mixed (one additional case)');
const origin = new URL(process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000').origin;
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Only the existing local application may be used');
const emails = [0, 1].map(i => `conversation-http-${randomUUID()}-${i}@example.test`), password = randomUUID();
let cookie = '', otherCookie = '', current = 'setup'; const ids: string[] = [], checks: string[] = [], evidence: unknown[] = [];
async function call(path: string, method = 'GET', payload?: unknown, selectedCookie = cookie, selectedOrigin = origin) {
  return fetch(origin + path, { method, headers: { ...(selectedCookie ? { Cookie: selectedCookie } : {}), ...(payload === undefined ? {} : { Origin: selectedOrigin, 'Content-Type': 'application/json' }) },
    body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
}
async function status(response: Response, expected = 200) { assert.equal(response.status, expected, current); return response.json(); }
try {
  for (const [index, email] of emails.entries()) {
    const invitation = await createInvitation(email);
    await status(await call('/api/invitations/accept', 'POST', { token: invitation.token, name: '合成对话验收', password }, ''));
    const login = await call('/api/auth/sign-in/email', 'POST', { email, password }, ''); assert.equal(login.status, 200);
    const value = login.headers.getSetCookie().map(item => item.split(';')[0]).join('; '); if (index === 0) cookie = value; else otherCookie = value;
  }
  const cases = mixed ? [
    { name: 'one turn answers the unit question and applies the exact selected desk movement', template: 'angled', selected: 'desk-b',
      message: '20厘米等于多少米？把选中的书桌沿图纸向右移动20厘米',
      decision: { kind: 'move', userAct: 'explicit_request', evidenceQuote: '把选中的书桌沿图纸向右移动20厘米', direction: 'right', distanceText: '20', unit: 'cm' }, expected: 'applied' },
  ] : [
    { name: 'selected desk moves exactly twenty centimetres', template: 'angled', selected: 'desk-b', message: '把选中的书桌沿图纸向右移动20厘米',
      decision: { kind: 'move', userAct: 'explicit_request', evidenceQuote: '把选中的书桌沿图纸向右移动20厘米', direction: 'right', distanceText: '20', unit: 'cm' }, expected: 'applied' },
    { name: 'collision preserves all original geometry', template: 'courtyard', selected: 'sofa-a', message: '把选中的沙发沿图纸向下移动180厘米',
      decision: { kind: 'move', userAct: 'explicit_request', evidenceQuote: '把选中的沙发沿图纸向下移动180厘米', direction: 'down', distanceText: '180', unit: 'cm' }, expected: 'collision' },
    { name: 'ambiguous movement asks rather than guessing', template: 'angled', selected: 'desk-b', message: '把它移动一点',
      decision: { kind: 'clarification', message: '请说明沿图纸哪个方向、移动多少距离。' }, expected: 'clarification' },
  ];
  for (const example of cases) {
    current = example.name;
    const project: ProjectView = (await status(await call('/api/projects', 'POST', { name: '合成对话验收', template: example.template, operationId: randomUUID() }), 201)).project;
    const path = `/api/projects/${project.id}/tasks`, request = { protocol: 'conversation-v1', operationId: randomUUID(), expectedRevision: 1,
      message: example.message, selectedObjectId: example.selected, referenceFrame: 'plan' };
    await status(await call(path, 'GET', undefined, ''), 401); await status(await call(path, 'POST', request, otherCookie), 404);
    await status(await call(path, 'POST', request, cookie, 'https://invalid.example'), 403);
    await status(await call(path, 'POST', { ...request, approved: true }), 400);
    const task: TaskView = (await status(await call(path, 'POST', request), 202)).task; ids.push(task.id);
    assert.equal((await status(await call(path, 'POST', request), 202)).task.id, task.id);
    // Detach the event reader before the finite runner starts. This is not a Worker process test.
    const stream = await call(`${path}/${task.id}/events?after=0`); assert.equal(stream.status, 200); await stream.body?.cancel();
    await runTask(task.id, live ? {} : { conversation: { model: fixtureModel(toolChunks({ reply: '这是合成 SDK 协议答复，实际操作以应用结果为准。', decision: example.decision }, 'resolve_turn')) } });
    const saved: TaskView = (await status(await call(`${path}/${task.id}`))).task;
    const after: ProjectView = (await status(await call(`/api/projects/${project.id}`))).project;
    const row = (await pool.query('SELECT conversation FROM design_tasks WHERE id=$1', [task.id])).rows[0].conversation;
    evidence.push({ case: example.name, status: saved.status, outcome: saved.conversation?.outcome, error: saved.error, model: row.configuration?.model,
      configuration: row.configuration, response: row.response, projectRevision: after.revision });
    if (example.expected === 'applied') {
      assert.equal(saved.conversation?.outcome?.kind, 'applied'); assert.equal(after.revision, 2);
      if (mixed) assert.match(row.response?.reply ?? '', /(?:0[.．]20*|零点二)\s*(?:米|m\b)/u, 'the same real response must answer the unit question, not just perform the edit');
      const beforeObject = project.scene.objects.find(o => o.id === example.selected)!, afterObject = after.scene.objects.find(o => o.id === example.selected)!;
      assert.ok(Math.abs(afterObject.position.x - beforeObject.position.x - .2) < 1e-9);
      assert.deepEqual(afterObject.size, beforeObject.size); assert.equal(afterObject.yaw, beforeObject.yaw);
      assert.deepEqual(after.scene.objects.filter(o => o.id !== example.selected), project.scene.objects.filter(o => o.id !== example.selected));
      await runTask(task.id); assert.equal((await status(await call(`/api/projects/${project.id}`))).project.revision, 2);
      const events = await call(`${path}/${task.id}/events?after=0`); const replay = await events.text(); assert.ok(replay.includes('event: operation'));
      await status(await call(`/api/projects/${project.id}/commands`, 'POST', { operationId: randomUUID(), expectedRevision: 2, command: { type: 'undo', targetOperationId: saved.conversation!.outcome!.operationId } }));
      assert.deepEqual((await status(await call(`/api/projects/${project.id}`))).project.scene.objects, project.scene.objects);
    } else {
      assert.equal(after.revision, 1); assert.deepEqual(after.scene.objects, project.scene.objects);
      if (example.expected === 'collision') assert.equal(saved.error?.code, 'PLACEMENT_REJECTED');
      else assert.equal(saved.conversation?.outcome?.kind, 'clarification');
    }
    checks.push(example.name);
  }
  console.log(JSON.stringify({ status: 'passed', evidence: live ? 'real-model-synthetic-projects' : 'protocol-substitute-real-http-db', checks, realModelCalls: live ? cases.length : 0, workerProcesses: 0 }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', check: current, passed: checks, errorType: error instanceof Error ? error.name : 'unknown' })); process.exitCode = 1;
} finally {
  const directory = new URL('../../.impeccable/review/t08/', import.meta.url); await mkdir(directory, { recursive: true });
  await writeFile(new URL(mixed ? 'backend-live-mixed-result.json' : live ? 'backend-live-result.json' : 'backend-api-result.json', directory), JSON.stringify({ passed: !process.exitCode, checks, evidence }, null, 2));
  try { await transaction(async client => {
    const users = (await client.query('SELECT id FROM hestia_auth_user WHERE email=ANY($1::text[])', [emails])).rows.map(row => row.id);
    const projects = (await client.query('SELECT id FROM projects WHERE created_by=ANY($1::text[])', [users])).rows.map(row => row.id);
    await client.query('DELETE FROM hestia_jobs.job WHERE id=ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM operations WHERE actor_id=ANY($1::text[])', [users]);
    await client.query('DELETE FROM project_revisions WHERE project_id=ANY($1::uuid[])', [projects]);
    await client.query('DELETE FROM projects WHERE created_by=ANY($1::text[])', [users]);
    await client.query('DELETE FROM hestia_invitation WHERE email=ANY($1::text[])', [emails]);
    await client.query('DELETE FROM hestia_auth_user WHERE email=ANY($1::text[])', [emails]);
  }); } finally { await pool.end(); }
}
