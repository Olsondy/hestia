import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--allow-render-worker-process')) {
  throw new Error('Requires explicit user permission and --allow-render-worker-process; this starts its own isolated Render Worker.');
}
const { chromium } = await import('@playwright/test');
const { createInvitation, acceptInvitation } = await import('../../packages/identity/src/service');
const { pool } = await import('../../packages/persistence/src/client');
const { createProject, renameProject } = await import('../../packages/projects/src/service');
const { createCandidate } = await import('../../packages/candidates/src/service');
const { createRender, getRender } = await import('../../packages/renders/src/service');
const { initializeRenderQueue, RENDER_QUEUE } = await import('../../packages/renders/src/queue');
const { privateStore } = await import('../../packages/files/src/storage');
const sharp = (await import('sharp')).default;

const base = process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Existing local Next.js required');
const run = randomUUID(), schema = `render_process_${run.replaceAll('-', '')}`;
const email = `render-process-${run}@example.test`, password = `synthetic-${randomUUID()}-A9!`;
const projects: string[] = [], renderIds: string[] = [];
let invitation: Awaited<ReturnType<typeof createInvitation>> | undefined, identity: Awaited<ReturnType<typeof acceptInvitation>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined, worker: ChildProcess | undefined, ownedPid: number | undefined;
async function stopOwnWorker() {
  if (!worker || !ownedPid) return;
  assert.equal(worker.pid, ownedPid);
  if (worker.exitCode !== null || worker.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Owned Render Worker did not stop; preserving test records.')), 10000);
    worker!.once('exit', () => { clearTimeout(timer); resolve(); });
    if (!worker!.kill('SIGKILL')) { clearTimeout(timer); reject(new Error('Could not stop owned Render Worker.')); }
  });
}
try {
  const live = await fetch(new URL('/api/session', base), { signal: AbortSignal.timeout(5000) });
  assert.ok(live.status < 500, 'Existing Next/PostgreSQL services are required');
  const queue = await initializeRenderQueue(schema);
  invitation = await createInvitation(email); identity = await acceptInvitation(invitation.token, '隔离出图测试', password);
  const principal = { userId: identity.userId };
  const a = await createProject(principal, { name: '方形空间出图', template: 'courtyard', operationId: randomUUID() }); projects.push(a.id);
  const b = await createProject(principal, { name: '凹形空间出图', template: 'angled', operationId: randomUUID() }); projects.push(b.id);
  await pool.query("UPDATE projects SET snapshot=jsonb_set(snapshot,'{scale}','\"estimated\"') WHERE id=$1 AND owner_id=$2", [b.id, identity.userId]);
  const candidate = await createCandidate(principal, b.id, { operationId: randomUUID(), expectedRevision: 1, name: '概念候选' });
  const aImage = await createRender(principal, a.id, { operationId: randomUUID(), source: { kind: 'current', revision: 1 } }, queue); renderIds.push(aImage.id);
  const bImage = await createRender(principal, b.id, { operationId: randomUUID(), source: { kind: 'candidate', candidateId: candidate.id, revision: 1 } }, queue); renderIds.push(bImage.id);
  await renameProject(principal, a.id, { operationId: randomUUID(), expectedRevision: 1, name: '已继续编辑的方形空间' });
  browser = await chromium.launch({ headless: true }); const context = await browser.newContext(), page = await context.newPage();
  await page.goto(base); await page.getByLabel('邮箱').fill(email); await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click(); await page.locator('.folio').waitFor();
  const queued = await context.request.get(`${base}/api/projects/${a.id}/renders/${aImage.id}`);
  assert.equal(queued.status(), 200); assert.equal((await queued.json()).render.status, 'queued');
  await page.close();
  worker = spawn(process.execPath, ['--import', 'tsx', 'apps/worker/render.ts'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), env: { ...process.env, HESTIA_RENDER_QUEUE_SCHEMA: schema },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  worker.stdout?.resume(); worker.stderr?.resume();
  await new Promise<void>((resolve, reject) => {
    worker!.once('error', () => reject(new Error('Could not start the explicitly authorized Render Worker.')));
    worker!.once('spawn', () => { ownedPid = worker!.pid; assert.ok(ownedPid); resolve(); });
  });
  const deadline = Date.now() + 120000;
  for (const [projectId, renderId] of [[a.id, aImage.id], [b.id, bImage.id]]) {
    while (true) {
      const result = await getRender(principal, projectId, renderId);
      if (result.status === 'completed') break;
      assert.notEqual(result.status, 'failed', result.error?.message ?? 'Render failed');
      if (Date.now() >= deadline) throw new Error('Isolated Render Worker verification timed out');
      await delay(150);
    }
  }
  const first = await getRender(principal, a.id, aImage.id), second = await getRender(principal, b.id, bImage.id);
  assert.equal(first.source.revision, 1); assert.equal(first.currentProjectRevision, 2); assert.equal(first.stale, true);
  assert.equal(second.concept, true); assert.match(second.label, /候选方案.*未采用.*尺寸未校准/);
  assert.equal((await pool.query('SELECT status FROM candidates WHERE id=$1', [candidate.id])).rows[0].status, 'draft');
  assert.equal((await pool.query('SELECT revision FROM projects WHERE id=$1', [b.id])).rows[0].revision, 1);
  const output = new URL('../../.impeccable/review/t20/', import.meta.url); await mkdir(output, { recursive: true });
  for (const [name, result] of [['worker-courtyard.png', first], ['worker-angled-concept.png', second]] as const) {
    const response = await context.request.get(base + result.downloadHref);
    assert.equal(response.status(), 200); assert.match(response.headers()['content-disposition'], /attachment/);
    const png = await response.body(), meta = await sharp(png).metadata(); assert.equal(meta.format, 'png');
    assert.equal(meta.width, result.width); assert.equal(meta.height, result.height);
    // Reject blank canvas artifacts even when their rasterized labels are valid.
    const stats = await sharp(png).extract({ left: 0, top: 112, width: meta.width!, height: meta.height! - 112 }).stats();
    assert.ok(stats.entropy > 1, 'Rendered scene is blank or not meaningful');
    await writeFile(new URL(name, output), png);
  }
  const settlementDeadline = Date.now() + 10000;
  while (true) {
    const jobs = await Promise.all(renderIds.map(id => queue.getJobById(RENDER_QUEUE, id)));
    if (jobs.every(job => job?.state === 'completed')) break;
    if (Date.now() >= settlementDeadline) throw new Error('Render queue settlement did not finish');
    await delay(100);
  }
  await stopOwnWorker();
  await writeFile(new URL('render-process-result.json', output), JSON.stringify({ passed: true,
    scope: 'isolated real Render Worker; existing Next/PostgreSQL; synthetic scenes', workerProcesses: 1,
    closedPageBeforeExecution: true, images: 2, frozenSourceAndStaleStatus: true, candidateNotAdopted: true,
    conceptLabelRasterized: true, authenticatedDownload: true, humanImageComparison: 'required separately' }, null, 2));
  console.log('Isolated Render Worker verification passed; two images, closed page, frozen versions and private downloads.');
} finally {
  try { await stopOwnWorker(); }
  catch { await browser?.close(); await pool.end(); throw new Error('Owned Worker stop failed; test data preserved.'); }
  await browser?.close();
  try {
    if (identity) {
      const files = (await pool.query('SELECT s.object_key FROM resources s JOIN projects p ON p.id=s.project_id WHERE p.owner_id=$1 AND p.id=ANY($2::uuid[])', [identity.userId, projects])).rows;
      for (const projectId of projects) {
        await pool.query('DELETE FROM project_renders WHERE project_id=$1 AND owner_id=$2', [projectId, identity.userId]);
        await pool.query('DELETE FROM resources WHERE project_id=$1', [projectId]);
        await pool.query('DELETE FROM operations WHERE project_id=$1 AND owner_id=$2', [projectId, identity.userId]);
        await pool.query('DELETE FROM project_revisions WHERE project_id=$1', [projectId]);
        await pool.query('DELETE FROM projects WHERE id=$1 AND owner_id=$2', [projectId, identity.userId]);
      }
      for (const file of files) await privateStore().remove(file.object_key);
    }
    if (invitation) await pool.query('DELETE FROM hestia_invitation WHERE id=$1 AND email=$2', [invitation.id, email]);
    if (identity) await pool.query('DELETE FROM hestia_auth_user WHERE id=$1 AND email=$2', [identity.userId, email]);
    assert.match(schema, /^render_process_[a-f0-9]{32}$/); await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally { await pool.end(); }
}
