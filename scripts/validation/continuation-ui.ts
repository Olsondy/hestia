import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect as baseExpect } from '@playwright/test';
import { createInvitation, acceptInvitation } from '../../packages/identity/src/service';
import { createProject, getProject } from '../../packages/projects/src/service';
import { pool } from '../../packages/persistence/src/client';
import { syntheticPlanningInput } from '../../packages/layout-planner/src/fixtures';
import { runTask } from '../../packages/tasks/src/runner';
import { fixtureModel, toolChunks } from '../../packages/model-validation/src/protocol-fixture';
import type { TaskView } from '../../packages/contracts/src/tasks';

// Uses only the user-started local Next/PostgreSQL and finite SDK fixtures; no model or daemon.
const base = process.env.BETTER_AUTH_URL || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Existing local service only');
assert.equal((await fetch(base, { signal: AbortSignal.timeout(5000) })).ok, true);
const out = '.impeccable/review/t19', email = `t19-ui-${randomUUID()}@example.test`, password = randomUUID();
await mkdir(out, { recursive: true });
const invitation = await createInvitation(email), identity = await acceptInvitation(invitation.token, '合成续作验收', password), principal = { userId: identity.userId };
const errors: string[] = []; let projectId: string | undefined;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage(), expect = baseExpect.configure({ timeout: 20000 });
page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
const capture = async (name: string) => {
  for (const [suffix, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready);
    if (await page.locator('.conversation-brief').count()) await expect(page.locator('.conversation-brief')).toHaveJSProperty('open', width > 700);
    await expect(page.locator('[data-scene-ready=true]')).toBeVisible();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.evaluate(() => scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${out}/${name}-${suffix}.png`, fullPage: true });
  }
};
const read = async (taskId: string): Promise<TaskView> => (await (await context.request.get(`${base}/api/projects/${projectId}/tasks/${taskId}`)).json()).task;
const submit = async (message: string) => {
  await page.locator('.conversation-compose textarea').fill(message); await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.conversation-state h4')).toHaveText('等待回复'); return new URL(page.url()).searchParams.get('task')!;
};
try {
  await page.goto(base); await page.getByLabel('邮箱', { exact: true }).fill(email); await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click(); await page.locator('.empty-studio').waitFor();
  const project = await createProject(principal, { name: '合成续作空间', template: 'empty', operationId: randomUUID() }); projectId = project.id;
  const synthetic = syntheticPlanningInput();
  await pool.query('UPDATE projects SET snapshot=$1 WHERE id=$2 AND owner_id=$3', [synthetic.state, projectId, identity.userId]);
  await pool.query('UPDATE project_revisions SET snapshot=$1 WHERE project_id=$2 AND revision=1', [synthetic.state, projectId]);
  const original = await getProject(principal, projectId);
  await page.goto(`${base}/?project=${projectId}&view=tasks`);
  const taskId = await submit('请为这个房间生成会客和办公布局，保留现有家具');
  async function runCurrent() {
    const current = await read(taskId), brief = current.conversation!.brief!, last = brief.inputs.at(-1)!;
    await runTask(taskId, { intentVersion: brief.intentVersion, conversation: { model: fixtureModel(toolChunks({
      reply: '固定协议样本：按本轮要求检查候选，尚未采用。',
      decision: { ...synthetic.decision, sourceInputIds: [last.id], requirementIds: brief.requirements.filter(item => item.sourceKind !== 'assistant_suggestion').map(item => item.id) },
      brief: { summary: '会客和办公，保留现有家具与本轮条件。', requirements: [{ content: last.text, sourceKind: 'user_explicit', sourceInputIds: [last.id] }], questions: [] },
    }, 'resolve_turn').slice(1)) } });
    await expect(page.locator('.conversation-state h4')).toHaveText('候选已保存，等待你决定');
    return read(taskId);
  }
  const first = await runCurrent(), firstId = first.conversation!.outcome!.candidateId!;
  assert.equal(first.conversation!.brief!.intentVersion, 1); assert.ok(firstId); await capture('first');
  assert.equal(await submit('保留现有家具'), taskId);
  const second = await runCurrent(), secondOutcome = second.conversation!.outcome!, secondId = secondOutcome.candidateId!;
  assert.equal(second.conversation!.brief!.intentVersion, 2); assert.notEqual(secondId, firstId);
  assert.deepEqual(secondOutcome.planReport!.source.reusedFromCandidate, { id: firstId, revision: 1 });
  await expect(page.locator('.conversation-question')).toContainText('保留现有家具');
  await expect(page.getByRole('button', { name: '查看推荐候选' })).toBeVisible(); await capture('reused');
  await page.reload(); await expect(page.getByRole('button', { name: '查看推荐候选' })).toBeVisible();
  await page.goto(`${base}/?project=${projectId}&view=candidates&candidate=${firstId}&task=${taskId}`);
  await expect(page.getByText('空间或需求已更新。这份历史候选仅供参考，原推荐与检查不能沿用于当前要求；请回到空间对话重新生成。')).toBeVisible();
  await expect(page.getByRole('button', { name: '采用这版方案', exact: true })).toBeDisabled(); await capture('stale');
  await page.goto(`${base}/?project=${projectId}&view=tasks&task=${taskId}`);
  await expect(page.locator('.conversation-state h4')).toHaveText('候选已保存，等待你决定');
  assert.equal(await submit('原位保留沙发'), taskId);
  const third = await runCurrent(), outcome = third.conversation!.outcome!, newId = outcome.candidateId!;
  assert.equal(third.conversation!.brief!.intentVersion, 3); assert.notEqual(newId, secondId);
  assert.ok(outcome.planReport!.source.inputIds.includes(third.conversation!.brief!.inputs[0].id));
  assert.ok(outcome.planReport!.source.inputIds.includes(third.conversation!.brief!.inputs[2].id));
  assert.equal((await getProject(principal, projectId)).revision, 1);
  await expect(page.locator('.conversation-question')).toContainText('原位保留沙发'); await capture('revised');
  await page.getByRole('button', { name: '查看推荐候选' }).click();
  await expect(page.locator('.candidate-recommendation')).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get('candidate'), newId);
  const candidateData = (await (await context.request.get(`${base}/api/projects/${projectId}/candidates/${newId}`)).json()).candidate;
  assert.equal(candidateData.scene.objects.length, 3);
  assert.equal(candidateData.scene.objects.filter((object: { id: string }) => object.id !== 'existing-sofa').length, 2);
  await page.locator('.layout-plan-report summary').click();
  await expect(page.locator('.layout-plan-report')).toContainText('请为这个房间生成会客和办公布局');
  await expect(page.locator('.layout-plan-report')).toContainText('原位保留沙发');
  await expect(page.getByRole('button', { name: '采用这版方案', exact: true })).toBeEnabled(); await capture('candidate');
  const canvas = page.locator('.candidate-scene canvas');
  const candidateCanvas = await canvas.screenshot();
  const previousCanvas = await canvas.elementHandle();
  await page.getByRole('button', { name: '当前方案', exact: true }).click();
  await page.waitForFunction(previous => document.querySelector('.candidate-scene canvas') !== previous, previousCanvas);
  await expect(page.locator('[data-scene-ready=true]')).toBeVisible();
  assert.notDeepEqual(await canvas.screenshot(), candidateCanvas);
  const currentCanvas = await canvas.elementHandle();
  await page.getByRole('button', { name: '候选预览', exact: true }).click();
  await page.waitForFunction(previous => document.querySelector('.candidate-scene canvas') !== previous, currentCanvas);
  await expect(page.locator('[data-scene-ready=true]')).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const beforeRotate = await canvas.screenshot();
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .85, bounds.y + bounds.height / 2, { steps: 12 }); await page.mouse.up();
  await page.screenshot({ path: `${out}/candidate-rotated.png`, fullPage: true });
  const rotated = await canvas.screenshot();
  assert.notDeepEqual(rotated, beforeRotate);
  const rotatedCanvas = await canvas.elementHandle();
  await page.getByRole('button', { name: '当前方案', exact: true }).click();
  await page.waitForFunction(previous => document.querySelector('.candidate-scene canvas') !== previous, rotatedCanvas);
  await expect(page.locator('[data-scene-ready=true]')).toBeVisible();
  const comparedCanvas = await canvas.elementHandle();
  await page.getByRole('button', { name: '候选预览', exact: true }).click();
  await page.waitForFunction(previous => document.querySelector('.candidate-scene canvas') !== previous, comparedCanvas);
  await expect(page.locator('[data-scene-ready=true]')).toBeVisible();
  assert.deepEqual(await canvas.screenshot(), rotated);
  await page.reload(); await expect(page.locator('.candidate-recommendation')).toBeVisible();
  await page.getByRole('button', { name: '采用这版方案', exact: true }).click();
  await expect(page.getByText('这版方案已采用并保存，可整体撤销。')).toBeVisible();
  const adopted = await getProject(principal, projectId); assert.equal(adopted.revision, 2);
  assert.deepEqual(adopted.scene.objects.find(item => item.id === 'existing-sofa'), original.scene.objects.find(item => item.id === 'existing-sofa'));
  await expect(page.locator('.candidate-recommendation .layout-plan-report > p')).toContainText('生成时：');
  await expect(page.locator('.candidate-recommendation .candidate-reference')).toContainText('已采用记录');
  await expect(page.locator('.candidate-list button[aria-pressed=true]')).toContainText('已采用记录');
  await capture('adopted');
  await page.getByRole('button', { name: '整体撤销上次采用', exact: true }).click();
  await expect(page.getByText('已整体撤销采用，恢复为新的当前方案版本。')).toBeVisible();
  await expect(page.locator('.candidate-recommendation .layout-plan-report > p')).toContainText('生成时：');
  await expect(page.locator('.candidate-recommendation .candidate-reference')).toContainText('已采用记录');
  await expect(page.locator('.candidate-list button[aria-pressed=true]')).toContainText('已采用记录');
  const undone = await getProject(principal, projectId); assert.equal(undone.revision, 3); assert.deepEqual(undone.scene.objects, original.scene.objects);
  await capture('undone'); assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => document.fonts.check('400 14px "Tsanger YuYang"')), true);
  assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length), 0);
  await writeFile(`${out}/browser-result.json`, JSON.stringify({ passed: true, existingServicesOnly: true, synthetic: true, sdkFixtureOnly: true,
    oneTaskThreeIntents: true, validCandidateReusedAndRechecked: true, staleCandidateCannotAdopt: true, originalAndNewInputVisible: true,
    projectUnchangedBeforeExplicitAdoption: true, originalSofaPreserved: true, adoptedReasonIsHistorical: true, adoptionListIsHistorical: true,
    candidateHasThreeObjects: true, currentAndCandidateCanvasesDiffer: true, manualCameraSurvivesComparison: true, undo: true, reload: true, pageErrors: errors }, null, 2));
  console.log('T19 browser validation passed; SDK fixture only.');
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {});
  console.log((await page.locator('main').textContent().catch(() => ''))?.slice(-2200)); throw error;
} finally {
  await browser.close();
  if (projectId) {
    const tasks = (await pool.query('SELECT id FROM design_tasks WHERE project_id=$1 AND owner_id=$2', [projectId, identity.userId])).rows;
    for (const task of tasks) await pool.query("DELETE FROM hestia_jobs.job WHERE data->>'taskId'=$1", [task.id]);
    await pool.query('DELETE FROM design_tasks WHERE project_id=$1 AND owner_id=$2', [projectId, identity.userId]);
    await pool.query('DELETE FROM candidate_adoptions WHERE project_id=$1 AND owner_id=$2', [projectId, identity.userId]);
    await pool.query('DELETE FROM operations WHERE project_id=$1 AND owner_id=$2', [projectId, identity.userId]);
    await pool.query('DELETE FROM project_revisions WHERE project_id=$1', [projectId]);
    await pool.query('DELETE FROM projects WHERE id=$1 AND owner_id=$2', [projectId, identity.userId]);
  }
  await pool.query('DELETE FROM hestia_invitation WHERE id=$1 AND user_id=$2', [invitation.id, identity.userId]);
  await pool.query('DELETE FROM hestia_auth_user WHERE id=$1 AND email=$2', [identity.userId, email]); await pool.end();
}
