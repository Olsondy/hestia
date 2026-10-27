import { chromium, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createInvitation, acceptInvitation } from '../../packages/identity/src/service';
import { pool, transaction } from '../../packages/persistence/src/client';

const origin = process.env.BETTER_AUTH_URL!;
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Local validation only.');
const email = `editing-ui-${randomUUID()}@example.test`, password = randomUUID();
const invite = await createInvitation(email);
const identity = await acceptInvitation(invite.token, '编辑验证', password);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const pageErrors: string[] = [];
page.on('pageerror', error => pageErrors.push(error.message));
const output = '.impeccable/review/t05';
await mkdir(output, { recursive: true });
let projectId: string | undefined;
async function commandClick(label: string, expectedStatus = 200) {
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/commands') && response.request().method() === 'POST'),
    page.getByRole('button', { name: label, exact: true }).click(),
  ]);
  assert.equal(response.status(), expectedStatus);
  return response.json();
}
async function selectSofa(currentPage: Page) { await currentPage.getByRole('button', { name: /^沙发/ }).click(); }
try {
  await page.goto(origin);
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '创建第一个项目' })).toBeVisible();
  const created = await context.request.post(`${origin}/api/projects`, { headers: { Origin: origin }, data: { name: '原木会客', template: 'courtyard', operationId: randomUUID() } });
  assert.equal(created.status(), 201);
  const project = (await created.json()).project; projectId = project.id;
  await page.goto(`${origin}/?project=${projectId}`);
  await expect(page.locator('[data-scene-ready=true]')).toBeVisible();
  await selectSofa(page);
  const beforeCanvas = await page.locator('canvas').screenshot();
  await page.getByLabel('X 位置（米）').fill('3.3');
  const moved = await commandClick('应用位置');
  assert.equal(moved.project.revision, 2);
  assert.equal(moved.project.scene.objects.find((o: { id: string }) => o.id === 'sofa-a').position.x, 3.3);
  await expect(page.getByText('服务端版本 2', { exact: false })).toBeVisible();
  await expect(page.locator('[data-scene-ready=true]')).toBeVisible();
  assert.ok(!beforeCanvas.equals(await page.locator('canvas').screenshot()), 'the saved movement updates the rendered canvas');
  await page.getByLabel('X 位置（米）').fill('-0.2');
  const boundary = await commandClick('应用位置', 400);
  assert.equal(boundary.error.code, 'PLACEMENT_REJECTED');
  await expect(page.locator('.furniture-inspector').getByRole('alert')).toBeVisible();
  await page.screenshot({ path: `${output}/rejected-desktop.png`, fullPage: true });
  assert.equal((await (await context.request.get(`${origin}/api/projects/${projectId}`)).json()).project.revision, 2);
  await page.getByLabel('X 位置（米）').fill('1.6');
  await page.getByLabel('Z 位置（米）').fill('0.7');
  const conflict = await commandClick('应用位置', 400);
  assert.ok(conflict.error.details.issues.some((issue: { relatedObjectId?: string }) => issue.relatedObjectId === 'fixed-a'));
  await page.getByRole('button', { name: '定位固定柜' }).click();
  await expect(page.getByText('这是固定事实，普通家具调整不能改变它的位置。')).toBeVisible();
  await selectSofa(page);
  await commandClick('锁定这件家具');
  await expect(page.getByLabel('X 位置（米）')).toBeDisabled();
  await commandClick('解锁这件家具');
  for (let i = 0; i < 3; i++) {
    await expect(page.getByRole('button', { name: '撤销最近修改' })).toBeEnabled();
    await commandClick('撤销最近修改');
  }
  await expect(page.getByLabel('X 位置（米）')).toHaveValue('3');
  let intercepted = false, savedId = '';
  const submittedIds: string[] = [];
  await page.route('**/commands', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    submittedIds.push(route.request().postDataJSON().operationId);
    if (intercepted) { await route.continue(); return; }
    intercepted = true;
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    savedId = (await response.json()).operation.id;
    await route.abort('failed');
  });
  await page.getByLabel('X 位置（米）').fill('3.2');
  await page.getByRole('button', { name: '应用位置', exact: true }).click();
  await expect(page.locator('.furniture-inspector').getByRole('alert')).toContainText('连接中断');
  const recovered = await commandClick('应用位置');
  assert.equal(recovered.operation.id, savedId);
  assert.equal(recovered.project.revision, 8);
  assert.deepEqual(submittedIds, [savedId, savedId]);
  await page.unroute('**/commands');
  await page.reload();
  await expect(page.locator('[data-scene-ready=true]')).toBeVisible();
  await selectSofa(page);
  await expect(page.getByLabel('X 位置（米）')).toHaveValue('3.2');
  for (const [name, width, height] of [['desktop', 1440, 1000], ['1100', 1100, 900], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('[data-scene-ready=true]')).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${output}/editing-${name}.png`, fullPage: true });
  }
  // Existing imported snapshots may retain multiple full turns. UI must still permit a position edit,
  // while undo restores the original stored angle exactly (not just an equivalent orientation).
  const rawYaw = Math.PI * 2 + .15;
  await pool.query(`UPDATE projects SET snapshot=jsonb_set(snapshot,'{currentLayout,objects}',
    (SELECT jsonb_agg(CASE WHEN item->>'id'='sofa-a' THEN jsonb_set(item,'{yaw}',$2::jsonb) ELSE item END)
     FROM jsonb_array_elements(snapshot->'currentLayout'->'objects') AS item)) WHERE id=$1 AND created_by=$3`,
    [projectId, JSON.stringify(rawYaw), identity.userId]);
  await page.reload(); await selectSofa(page);
  await expect(page.getByLabel('旋转角度（度）')).toHaveValue('8.59');
  await page.getByLabel('X 位置（米）').fill('3.3');
  await commandClick('应用位置');
  await expect(page.getByRole('button', { name: '撤销最近修改' })).toBeEnabled();
  const restored = await commandClick('撤销最近修改');
  assert.equal(restored.project.scene.objects.find((item: { id: string }) => item.id === 'sofa-a').yaw, rawYaw);
  assert.deepEqual(pageErrors, []);
  console.log('T05 UI passed: persisted movement, geometry refusal, fixed-object location, locking, three-step undo, lost-response retry, reopening and 1440/1100/390 layouts.');
} finally {
  await browser.close();
  await transaction(async client => {
    if (projectId) {
      await client.query('DELETE FROM project_commands WHERE project_id=$1 AND actor_id=$2', [projectId, identity.userId]);
      await client.query('DELETE FROM operations WHERE project_id=$1 AND actor_id=$2', [projectId, identity.userId]);
      await client.query('DELETE FROM project_revisions WHERE project_id=$1 AND project_id IN (SELECT id FROM projects WHERE created_by=$2)', [projectId, identity.userId]);
      await client.query('DELETE FROM projects WHERE id=$1 AND created_by=$2', [projectId, identity.userId]);
    }
    await client.query('DELETE FROM hestia_invitation WHERE id=$1 AND email=$2', [invite.id, email]);
    await client.query('DELETE FROM hestia_auth_user WHERE id=$1 AND email=$2', [identity.userId, email]);
  });
  await pool.end();
}
