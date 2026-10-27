import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// This gate runs before loading database/auth/browser modules. This script must never run in CI.
if (!process.argv.includes('--allow-worker-process')) {
  throw new Error('Requires explicit user permission and --allow-worker-process; this script starts and restarts its own test Worker.');
}
const { chromium } = await import('@playwright/test');
const { createInvitation, acceptInvitation } = await import('../../packages/identity/src/service');
const { pool } = await import('../../packages/persistence/src/client');
const { createProject, getProject } = await import('../../packages/projects/src/service');
const { createTask, getTask, cancelTask, readTaskEvents } = await import('../../packages/tasks/src/service');
const { initializeQueue, TASK_QUEUE, validatedQueueSchema } = await import('../../packages/tasks/src/queue');

const root = fileURLToPath(new URL('../../', import.meta.url));
const run = randomUUID(), schema = validatedQueueSchema(`task_process_${run.replaceAll('-', '')}`);
const email = `worker-process-${run}@example.test`, password = `synthetic-${randomUUID()}-A9!`;
const base = process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000';
const children = new Set<ChildProcess>(), childPids: number[] = [];
const projects: string[] = [], taskIds: string[] = [];
let invitation: Awaited<ReturnType<typeof createInvitation>> | undefined;
let identity: Awaited<ReturnType<typeof acceptInvitation>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

async function until<T>(read: () => Promise<T>, matches: (value: T) => boolean, timeoutMs = 15000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const result = await read();
    if (matches(result)) return result;
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the isolated Worker verification condition.');
    await delay(40);
  }
}
function startOwnWorker() {
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/worker/main.ts'], {
    cwd: root, env: { ...process.env, HESTIA_TASK_QUEUE_SCHEMA: schema },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  children.add(child);
  // Drain pipes without printing environment values or raw database/driver diagnostics.
  child.stdout?.resume(); child.stderr?.resume();
  return new Promise<ChildProcess>((resolve, reject) => {
    child.once('error', () => reject(new Error('Could not start the explicitly authorized test Worker.')));
    child.once('spawn', () => { assert.ok(child.pid); childPids.push(child.pid); resolve(child); });
  });
}
async function stopOwnWorker(child: ChildProcess) {
  assert.ok(children.has(child) && child.pid && childPids.includes(child.pid), 'Only this script\'s exact child handle may be stopped');
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The owned Worker did not stop; preserving its test data.')), 10000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
    if (!child.kill('SIGKILL')) { clearTimeout(timeout); reject(new Error('Could not terminate the owned Worker.')); }
  });
}

try {
  // Existing servers only. Never start Next.js, PostgreSQL, a preview or a test HTTP listener.
  const live = await fetch(new URL('/api/session', base), { signal: AbortSignal.timeout(5000) });
  assert.ok(live.status < 500, 'An existing Next.js server is required');
  const producer = await initializeQueue(schema);
  invitation = await createInvitation(email);
  identity = await acceptInvitation(invitation.token, '隔离后台测试', password);
  const principal = { userId: identity.userId };
  const project = await createProject(principal, { name: '独立进程协议验证', template: 'courtyard', operationId: randomUUID() });
  projects.push(project.id);
  const task = await createTask(principal, project.id, { operationId: randomUUID(), expectedRevision: 1, protocol: 'deterministic-v1',
    steps: [{ type: 'command', command: { type: 'set-lock', objectId: 'sofa-a', locked: true } },
      ...Array.from({ length: 7 }, (_, i) => ({ type: 'text', text: `确定性恢复测试片段 ${i + 1}；非模型回答。` }))] }, producer);
  taskIds.push(task.id);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(base); await page.getByLabel('邮箱').fill(email); await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click(); await page.locator('.folio').waitFor();
  const initialEvent = await page.evaluate(async ({ projectId, taskId }) => {
    const response = await fetch(`/api/projects/${projectId}/tasks/${taskId}/events?after=0`);
    if (!response.ok) throw new Error('Initial authenticated SSE failed');
    const reader = response.body!.getReader(), part = await reader.read(); await reader.cancel();
    return new TextDecoder().decode(part.value);
  }, { projectId: project.id, taskId: task.id });
  assert.match(initialEvent, /id: 1\nevent: status/);
  await page.close(); // No browser page or SSE subscriber exists while the Worker advances.

  const firstWorker = await startOwnWorker();
  const committed = await until(() => getTask(principal, project.id, task.id), value => value.checkpoint.nextStep >= 1);
  assert.equal(committed.status, 'running', 'The test needs an unfinished task after its committed command');
  assert.equal((await getProject(principal, project.id)).revision, 2);
  await stopOwnWorker(firstWorker); // Crash only the exact process this script just created.
  const stopped = await getTask(principal, project.id, task.id);
  assert.equal(stopped.status, 'running'); assert.ok(stopped.checkpoint.nextStep < 8);
  assert.equal((await producer.getJobById(TASK_QUEUE, task.id))?.state, 'active');

  const secondWorker = await startOwnWorker();
  // Real pg-boss expiration/retry; do not edit leases or invoke the domain runner in this script.
  const completed = await until(() => getTask(principal, project.id, task.id), value => value.status === 'completed', 120000);
  assert.ok(completed.generation >= 2); assert.equal(completed.checkpoint.nextStep, 8);
  assert.deepEqual(completed.usage, { limit: 8, used: 8, reserved: 0, unit: 'protocol-step' });
  const job = await until(() => producer.getJobById(TASK_QUEUE, task.id), value => value?.state === 'completed');
  assert.ok(job && job.retryCount >= 1, 'Actual pg-boss retry must have taken place');
  assert.equal((await getProject(principal, project.id)).revision, 2);
  assert.equal((await pool.query('SELECT 1 FROM project_commands WHERE project_id=$1', [project.id])).rowCount, 1);
  const allEvents = (await readTaskEvents(principal, project.id, task.id, 0)).events;
  assert.equal(allEvents.filter(event => event.type === 'operation').length, 1);

  const reopened = await context.newPage(); await reopened.goto(base);
  const resumed = await reopened.evaluate(async ({ projectId, taskId }) => {
    const taskResponse = await fetch(`/api/projects/${projectId}/tasks/${taskId}`);
    const eventResponse = await fetch(`/api/projects/${projectId}/tasks/${taskId}/events?after=0`, { headers: { 'Last-Event-ID': '1' } });
    if (!taskResponse.ok || !eventResponse.ok) throw new Error('Authenticated reopen failed');
    return { body: await taskResponse.json(), events: await eventResponse.text() };
  }, { projectId: project.id, taskId: task.id });
  assert.equal(resumed.body.task.id, task.id); assert.equal(resumed.body.task.status, 'completed');
  assert.ok(!/(?:^|\n)id: 1\n/.test(resumed.events)); assert.match(resumed.events, /event: operation/);
  await reopened.close();

  const cancelled = await createTask(principal, project.id, { operationId: randomUUID(), expectedRevision: 2, protocol: 'deterministic-v1',
    steps: [{ type: 'text', text: '确定性取消测试。' }, { type: 'text', text: '此时取消应停止后续修改。' },
      { type: 'command', command: { type: 'set-lock', objectId: 'sofa-a', locked: false } }] }, producer);
  taskIds.push(cancelled.id);
  await until(() => getTask(principal, project.id, cancelled.id), value => value.status === 'running');
  await cancelTask(principal, project.id, cancelled.id);
  await until(() => producer.getJobById(TASK_QUEUE, cancelled.id), value => value?.state === 'completed');
  assert.equal((await getTask(principal, project.id, cancelled.id)).status, 'cancelled');
  assert.equal((await getProject(principal, project.id)).revision, 2);
  await stopOwnWorker(secondWorker);
  await mkdir(new URL('../../.impeccable/review/t07/', import.meta.url), { recursive: true });
  await writeFile(new URL('../../.impeccable/review/t07/worker-process-result.json', import.meta.url), JSON.stringify({
    passed: true, scope: 'isolated real Worker processes; existing Next/Postgres; deterministic protocol only',
    closedPageBeforeExecution: true, workerProcesses: childPids.length, killedOnlyOwnedProcesses: true,
    recoveredSameTask: true, retryCount: job.retryCount, commandsApplied: 1, eventsCursor: completed.eventsCursor,
    cancellationPassed: true, usedUnits: completed.usage.used,
  }, null, 2));
  console.log('Isolated Worker verification passed: closed-page execution, actual crash/restart and pg-boss retry, cursor replay, one command effect, cancellation.');
} finally {
  const stopped = await Promise.allSettled([...children].filter(child => child.pid).map(stopOwnWorker));
  await browser?.close();
  if (stopped.some(result => result.status === 'rejected')) {
    await pool.end();
    throw new Error('An owned Worker could not be stopped; test records were preserved instead of deleting data under an active process.');
  }
  try {
    if (identity) {
      for (const projectId of projects) {
        for (const taskId of taskIds) await pool.query('DELETE FROM design_tasks WHERE id=$1 AND project_id=$2 AND owner_id=$3', [taskId, projectId, identity.userId]);
        await pool.query('DELETE FROM operations WHERE project_id=$1 AND owner_id=$2', [projectId, identity.userId]);
        await pool.query('DELETE FROM project_revisions WHERE project_id=$1', [projectId]);
        await pool.query('DELETE FROM projects WHERE id=$1 AND owner_id=$2', [projectId, identity.userId]);
      }
    }
    if (invitation) await pool.query('DELETE FROM hestia_invitation WHERE id=$1 AND email=$2', [invitation.id, email]);
    if (identity) await pool.query('DELETE FROM hestia_auth_user WHERE id=$1 AND email=$2', [identity.userId, email]);
    assert.match(schema, /^task_process_[a-f0-9]{32}$/);
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); // This script's isolated job storage only.
  } finally { await pool.end(); }
}
