import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { pool, transaction } from '../../packages/persistence/src/client';
import { createInvitation, acceptInvitation } from '../../packages/identity/src/service';
import { privateStore } from '../../packages/files/src/storage';
import { initializeRenderQueue, RENDER_QUEUE } from '../../packages/renders/src/queue';
import { runRender } from '../../packages/renders/src/runner';

// Bounded calls only: this script never starts a queue consumer or an HTTP server.
const base = process.env.BETTER_AUTH_URL!;
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Local verification only');
const queue = await initializeRenderQueue();
const email = `render-ui-${randomUUID()}@example.test`, password = randomUUID();
const invitation = await createInvitation(email), user = await acceptInvitation(invitation.token, '静态成果验收', password);
const browser = await chromium.launch(), context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
let page = await context.newPage(); const errors: string[] = [], projects: string[] = [], renderIds: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const output = '.impeccable/review/t20'; await mkdir(output, { recursive: true });
const post = async (path: string, data: unknown, status = 200) => { const response = await context.request.post(base + path, { headers: { Origin: base }, data }); assert.equal(response.status(), status, await response.text()); return response.json(); };
try {
  await page.goto(base); await page.getByLabel('邮箱', { exact: true }).fill(email); await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page.getByRole('button', { name: '创建第一个项目' })).toBeVisible();
  const project = (await post('/api/projects', { name: '静态成果测试空间', template: 'courtyard', operationId: randomUUID() }, 201)).project;
  projects.push(project.id);
  await page.goto(`${base}/?project=${project.id}&view=renders`);
  await expect(page.getByText('第一张空间图，从这里开始。')).toBeVisible();
  await page.screenshot({ path: `${output}/empty-desktop.png`, fullPage: true });
  let dropped = false; const ids: string[] = [];
  await page.route('**/renders', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    ids.push(route.request().postDataJSON().operationId);
    if (dropped) { await route.continue(); return; }
    dropped = true; const response = await route.fetch(); assert.equal(response.status(), 202);
    renderIds.push((await response.json()).render.id); await route.abort('failed');
  });
  await page.getByRole('button', { name: '生成静态图', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试同一次生成', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重试同一次生成', exact: true }).click();
  await expect(page.locator('.render-state h4')).toHaveText('等待生成');
  assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM project_renders WHERE project_id=$1', [project.id])).rows[0].n, 1);
  await page.screenshot({ path: `${output}/queued-desktop.png`, fullPage: true });
  await page.close();
  const renamed = await context.request.patch(`${base}/api/projects/${project.id}`, { headers: { Origin: base }, data: { operationId: randomUUID(), expectedRevision: 1, name: '继续编辑后的空间' } });
  assert.equal(renamed.status(), 200);
  await runRender(renderIds[0]);
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/?project=${project.id}&view=renders&render=${renderIds[0]}`);
  await expect(page.locator('.render-state h4')).toHaveText('已生成');
  await expect(page.getByText('来源方案已有更新。这张图保留的是提交时的版本。')).toBeVisible();
  const completed = (await (await context.request.get(`${base}/api/projects/${project.id}/renders/${renderIds[0]}`)).json()).render;
  assert.equal(completed.source.revision, 1); assert.equal(completed.currentProjectRevision, 2); assert.equal(completed.stale, true);
  const content = await context.request.get(base + completed.downloadHref);
  assert.equal(content.status(), 200); assert.match(content.headers()['content-disposition'], /attachment/);
  const png = await content.body(); const meta = await sharp(png).metadata(); assert.equal(meta.format, 'png'); assert.ok(meta.height! > 836);
  const visual = await sharp(png).extract({ left: 0, top: 112, width: meta.width!, height: meta.height! - 112 }).stats();
  assert.ok(visual.channels.slice(0, 3).some(channel => channel.stdev > 10), 'The image must contain rendered scene pixels, not only a valid PNG/banner');
  await writeFile(`${output}/courtyard-static.png`, png);
  for (const [name, width, height] of [['desktop',1440,1000],['1100',1100,900],['mobile',390,844]] as const) {
    await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('.render-image img')).toBeVisible();
    await expect.poll(() => page.locator('.render-image img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/completed-${name}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`${base}/?project=${project.id}`);
  await expect(page.locator('[data-scene-ready=true]')).toBeVisible(); await page.locator('canvas').screenshot({ path: `${output}/courtyard-interactive.png` });

  const angled = (await post('/api/projects', { name: '凹形概念空间', template: 'angled', operationId: randomUUID() }, 201)).project; projects.push(angled.id);
  await pool.query("UPDATE projects SET snapshot=jsonb_set(snapshot,'{scale}','\"estimated\"') WHERE id=$1 AND created_by=$2", [angled.id, user.userId]);
  const candidate = (await post(`/api/projects/${angled.id}/candidates`, { operationId: randomUUID(), expectedRevision: 1, name: '凹形候选图' }, 201)).candidate;
  const created = (await post(`/api/projects/${angled.id}/renders`, { operationId: randomUUID(), source: { kind: 'candidate', candidateId: candidate.id, revision: candidate.revision } }, 202)).render; renderIds.push(created.id);
  await page.close(); await runRender(created.id);
  const candidateResult = (await (await context.request.get(`${base}/api/projects/${angled.id}/renders/${created.id}`)).json()).render;
  assert.equal(candidateResult.status, 'completed'); assert.equal(candidateResult.concept, true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM candidate_selections s JOIN candidate_presentations p ON p.id=s.presentation_id WHERE p.candidate_id=$1', [candidate.id])).rows[0].n, 0);
  assert.equal((await pool.query('SELECT revision FROM projects WHERE id=$1', [angled.id])).rows[0].revision, 1);
  await writeFile(`${output}/angled-concept-static.png`, await (await context.request.get(base + candidateResult.contentHref)).body());
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/?project=${angled.id}&view=renders&render=${created.id}`);
  await expect(page.getByText('概念图 · 尺寸未校准', { exact: true })).toBeVisible();
  await expect(page.locator('.render-image img')).toBeVisible();
  await page.screenshot({ path: `${output}/concept-desktop.png`, fullPage: true });
  await page.goto(`${base}/?project=${angled.id}`); await expect(page.locator('[data-scene-ready=true]')).toBeVisible();
  await page.locator('canvas').screenshot({ path: `${output}/angled-interactive.png` });
  const broken = (await post(`/api/projects/${angled.id}/renders`, { operationId: randomUUID(), source: { kind: 'current', revision: 1 } }, 202)).render; renderIds.push(broken.id);
  await pool.query('UPDATE project_renders SET snapshot_hash=$2 WHERE id=$1 AND actor_id=$3', [broken.id, 'injected-invalid-digest', user.userId]);
  await runRender(broken.id);
  await page.setViewportSize({ width:390, height:844 });
  await page.goto(`${base}/?project=${angled.id}&view=renders&render=${broken.id}`);
  await expect(page.locator('.render-state h4')).toHaveText('生成未完成');
  await expect(page.getByRole('link', { name: '下载图片', exact: true })).toHaveCount(0);
  await expect(page.locator('.render-detail [role=alert]')).toContainText('来源快照校验失败');
  await page.screenshot({ path: `${output}/failed-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(`${output}/browser-result.json`, JSON.stringify({ passed: true, widths: [1440,1100,390], queuedRequestLostResponseExactlyOnce: true, closedPageBeforeBoundedRender: true, standaloneWorkerProcess: false, sourceRevisionFrozen: true, candidateNotAdopted: true, conceptLabelInPng: 'manual inspection required', houses: 2, pageErrors: errors }, null, 2));
  console.log('T20 bounded UI passed: retry, closed page, frozen versions, PNG download, candidate concept, two spaces and responsive screenshots. No service started.');
} catch (error) {
  if (!page.isClosed()) { await page.screenshot({ path: `${output}/failure.png`, fullPage: true }); console.log((await page.locator('main').textContent().catch(() => '') || '').slice(0, 2000)); }
  throw error;
} finally {
  await browser.close();
  for (const id of renderIds) await queue.deleteJob(RENDER_QUEUE, id);
  const files = projects.length ? (await pool.query('SELECT object_key FROM resources WHERE project_id=ANY($1::uuid[])', [projects])).rows : [];
  await transaction(async client => {
    for (const id of projects) {
      await client.query('DELETE FROM project_renders WHERE project_id=$1 AND actor_id=$2', [id,user.userId]);
      await client.query('DELETE FROM resources WHERE project_id=$1', [id]);
      await client.query('DELETE FROM operations WHERE project_id=$1 AND actor_id=$2', [id,user.userId]);
      await client.query('DELETE FROM project_revisions WHERE project_id=$1', [id]);
      await client.query('DELETE FROM projects WHERE id=$1 AND created_by=$2', [id,user.userId]);
    }
    await client.query('DELETE FROM hestia_invitation WHERE id=$1 AND email=$2', [invitation.id,email]);
    await client.query('DELETE FROM hestia_auth_user WHERE id=$1 AND email=$2', [user.userId,email]);
  });
  for (const file of files) await privateStore().remove(file.object_key);
  await pool.end();
}
