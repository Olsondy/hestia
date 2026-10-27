import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInvitation, acceptInvitation } from '../../packages/identity/src/service';
import { pool, transaction } from '../../packages/persistence/src/client';

const origin = process.env.BETTER_AUTH_URL!;
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Local verification only');
const email = `candidate-ui-${randomUUID()}@example.test`, password = randomUUID();
const invitation = await createInvitation(email), user = await acceptInvitation(invitation.token, '候选验收', password);
const browser = await chromium.launch(), context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage(), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const output = '.impeccable/review/t06'; await mkdir(output, { recursive: true });
let projectId = '';
try {
  await page.goto(origin); await page.getByLabel('邮箱', { exact: true }).fill(email); await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '创建第一个项目' })).toBeVisible();
  const created = await context.request.post(`${origin}/api/projects`, { headers: { Origin: origin }, data: { name: '两种生活安排', template: 'courtyard', operationId: randomUUID() } });
  assert.equal(created.status(), 201); const original = (await created.json()).project; projectId = original.id;
  const readProject = async () => (await (await context.request.get(`${origin}/api/projects/${projectId}`)).json()).project;
  await page.goto(`${origin}/?project=${projectId}&view=candidates`);
  await page.getByLabel('新候选名称').fill('靠窗会客');
  await page.getByRole('button', { name: '从当前方案创建', exact: true }).click();
  await expect(page.getByLabel('候选中的家具')).toBeVisible();
  await page.getByLabel('候选中的家具').selectOption('sofa-a');
  await page.getByLabel('X 位置（米）', { exact: true }).fill('-0.2');
  await page.getByRole('button', { name: '保存候选调整', exact: true }).click();
  await expect(page.getByText('候选已保存，采用前需要重新检查。')).toBeVisible();
  await page.getByRole('button', { name: '检查这版方案', exact: true }).click();
  await expect(page.getByText('这版暂时不能采用。')).toBeVisible();
  await expect(page.getByRole('button', { name: '采用这版方案', exact: true })).toBeDisabled();
  assert.equal((await readProject()).revision, original.revision);
  await page.screenshot({ path: `${output}/rejected-desktop.png`, fullPage: true });
  await page.getByLabel('X 位置（米）', { exact: true }).fill('3.3');
  await page.getByRole('button', { name: '保存候选调整', exact: true }).click();
  await expect(page.getByText('内容变化后需要重新检查，旧检查不会继续生效。')).toBeVisible();
  await page.getByRole('button', { name: '检查这版方案', exact: true }).click();
  await expect(page.getByText('本版必要检查已通过。')).toBeVisible();
  await expect(page.getByRole('button', { name: '采用这版方案', exact: true })).toBeEnabled();
  await page.getByLabel('X 位置（米）', { exact: true }).fill('3.4');
  await expect(page.getByRole('button', { name: '采用这版方案', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '检查这版方案', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '还原未保存调整', exact: true }).click();
  await expect(page.getByRole('button', { name: '采用这版方案', exact: true })).toBeEnabled();
  const candidateScene = await page.locator('canvas').screenshot();
  await page.getByRole('button', { name: '当前方案', exact: true }).click();
  await expect(page.locator('[data-scene-ready=true]')).toBeVisible();
  assert.ok(!candidateScene.equals(await page.locator('canvas').screenshot()), 'candidate and current show different saved poses');
  await expect(page.getByRole('button', { name: '采用这版方案', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '候选预览', exact: true }).click();
  await expect(page.getByRole('button', { name: '采用这版方案', exact: true })).toBeEnabled();
  assert.equal((await readProject()).scene.objects.find((item: { id: string }) => item.id === 'sofa-a').position.x, 3);
  const noChoice = await pool.query('SELECT count(*)::int AS count FROM candidate_selections s JOIN candidate_presentations p ON p.id=s.presentation_id JOIN candidates c ON c.id=p.candidate_id WHERE c.project_id=$1', [projectId]);
  assert.equal(noChoice.rows[0].count, 0, 'preview and check are not an adoption choice');
  for (const [name, width, height] of [['desktop',1440,1000],['1100',1100,900],['mobile',390,844]] as const) {
    await page.setViewportSize({width,height}); await page.evaluate(() => document.fonts.ready); await expect(page.locator('[data-scene-ready=true]')).toBeVisible();
    await page.evaluate(() => scrollTo(0,0)); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/candidate-${name}.png`, fullPage:true });
  }
  let intercepted = false; const operationIds: string[] = [];
  await page.route('**/adopt', async route => {
    operationIds.push(route.request().postDataJSON().operationId);
    if (intercepted) { await route.continue(); return; }
    intercepted = true; const response = await route.fetch(); assert.equal(response.status(),200); await route.abort('failed');
  });
  await page.getByRole('button', { name: '采用这版方案', exact: true }).click();
  await expect(page.locator('.candidate-panel [role=alert]')).toContainText('连接中断');
  await page.getByRole('button', { name: '采用这版方案', exact: true }).click();
  await expect(page.getByText('这版方案已采用并保存，可整体撤销。')).toBeVisible();
  assert.equal(operationIds.length,2); assert.equal(operationIds[0],operationIds[1]);
  const adopted = await readProject(); assert.equal(adopted.revision,2); assert.notEqual(adopted.currentLayout.id, original.currentLayout.id);
  assert.equal(adopted.scene.objects.find((item: { id: string }) => item.id === 'sofa-a').position.x,3.3);
  await page.reload(); await expect(page.getByRole('button', { name: '整体撤销上次采用', exact:true })).toBeVisible();
  await page.getByRole('button', { name: '整体撤销上次采用', exact:true }).click();
  await expect(page.getByText('已整体撤销采用，恢复为新的当前方案版本。')).toBeVisible();
  const reverted = await readProject(); assert.equal(reverted.revision,3); assert.notEqual(reverted.currentLayout.id, adopted.currentLayout.id);
  assert.deepEqual(reverted.scene.objects,original.scene.objects);
  // An imported multi-turn angle must not prevent editing only the candidate's position.
  await pool.query(`UPDATE projects SET snapshot=jsonb_set(snapshot,'{currentLayout,objects}',
    (SELECT jsonb_agg(CASE WHEN item->>'id'='sofa-a' THEN jsonb_set(item,'{yaw}',$2::jsonb) ELSE item END)
     FROM jsonb_array_elements(snapshot->'currentLayout'->'objects') AS item)) WHERE id=$1 AND owner_id=$3`,
    [projectId, JSON.stringify(Math.PI * 2 + .15), user.userId]);
  await page.reload(); await page.getByLabel('新候选名称').fill('多圈朝向测试');
  await page.getByRole('button', { name: '从当前方案创建', exact:true }).click();
  await page.getByLabel('候选中的家具').selectOption('sofa-a');
  await expect(page.getByLabel('旋转角度（度）', { exact:true })).toHaveValue('8.59');
  await page.getByLabel('X 位置（米）', { exact:true }).fill('3.2');
  const [poseResponse] = await Promise.all([page.waitForResponse(response => response.url().includes('/candidates/') && response.url().endsWith('/commands') && response.request().method() === 'POST'),page.getByRole('button', { name: '保存候选调整', exact:true }).click()]);
  assert.equal(poseResponse.status(),200);
  await page.getByLabel('X 位置（米）', { exact:true }).fill('0');
  const [zeroResponse] = await Promise.all([page.waitForResponse(response => response.url().includes('/candidates/') && response.url().endsWith('/commands') && response.request().method() === 'POST'),page.getByRole('button', { name: '保存候选调整', exact:true }).click()]);
  assert.equal(zeroResponse.status(),200);
  await expect(page.getByRole('button', { name: '检查这版方案', exact:true })).toBeEnabled();
  await page.getByLabel('X 位置（米）', { exact:true }).fill('');
  await expect(page.getByRole('button', { name: '检查这版方案', exact:true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '采用这版方案', exact:true })).toBeDisabled();
  await page.screenshot({ path: `${output}/unsaved-empty-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: '还原未保存调整', exact:true }).click();
  await expect(page.getByLabel('X 位置（米）', { exact:true })).toHaveValue('0');
  await expect(page.getByRole('button', { name: '检查这版方案', exact:true })).toBeEnabled();
  assert.deepEqual(errors,[]);
  await writeFile(`${output}/browser-result.json`,JSON.stringify({passed:true,widths:[1440,1100,390],previewDoesNotAdopt:true,invalidCandidateRejected:true,lostResponseExactlyOnce:true,undoRevision:3,pageErrors:errors},null,2));
  console.log('T06 browser passed: isolated edits, rejection, current/candidate comparison, explicit selection, lost-response retry, reload, batch undo, three widths.');
} finally {
  await browser.close();
  await transaction(async client => {
    if (projectId) {
      await client.query('DELETE FROM candidate_adoptions WHERE project_id=$1 AND owner_id=$2',[projectId,user.userId]);
      await client.query('DELETE FROM operations WHERE project_id=$1 AND owner_id=$2',[projectId,user.userId]);
      await client.query('DELETE FROM project_revisions WHERE project_id=$1',[projectId]);
      await client.query('DELETE FROM projects WHERE id=$1 AND owner_id=$2',[projectId,user.userId]);
    }
    await client.query('DELETE FROM hestia_invitation WHERE id=$1 AND email=$2',[invitation.id,email]);
    await client.query('DELETE FROM hestia_auth_user WHERE id=$1 AND email=$2',[user.userId,email]);
  });
  await pool.end();
}
