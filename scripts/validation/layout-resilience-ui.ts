import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 20000 });
import { createInvitation, acceptInvitation } from '../../packages/identity/src/service';
import { createProject, getProject } from '../../packages/projects/src/service';
import { pool } from '../../packages/persistence/src/client';
import { syntheticPlanningInput } from '../../packages/layout-planner/src/fixtures';
import { runTask } from '../../packages/tasks/src/runner';
import { fixtureModel, toolChunks } from '../../packages/model-validation/src/protocol-fixture';
import type { TaskView } from '../../packages/contracts/src/tasks';

// Existing Next.js/PostgreSQL only. Finite SDK transport fixtures; no real model calls.
const base = process.env.BETTER_AUTH_URL || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Existing local service only');
const out = '.impeccable/review/t17-t21', run = randomUUID(), email = `layout-ui-${run}@example.test`, password = randomUUID();
await mkdir(out, { recursive: true });
// Reachability check only: this script never starts or repairs the existing application.
assert.equal((await fetch(base, { signal: AbortSignal.timeout(5000) })).ok, true, 'Existing Next.js service must be reachable');
const invitation = await createInvitation(email), identity = await acceptInvitation(invitation.token, '布局验收', password), principal = { userId: identity.userId };
const projectIds: string[] = [], errors: string[] = [];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
const capture = async (prefix: string, sizes = ['desktop', '1100', 'mobile']) => {
  for (const [name, width, height] of [['desktop', 1440, 1000], ['1100', 1100, 900], ['mobile', 390, 844]] as const) {
    if (!sizes.includes(name)) continue;
    await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready);
    if (await page.locator('.conversation-brief').count()) await expect(page.locator('.conversation-brief')).toHaveJSProperty('open', width > 700);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.locator('[data-scene-ready=true]')).toBeVisible(); await page.evaluate(() => scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${out}/${prefix}-${name}.png`, fullPage: true });
  }
};
const model = (reply: string, decision: unknown = { kind: 'answer', message: reply }, brief?: unknown) => fixtureModel(toolChunks({ reply, decision, ...(brief ? { brief } : {}) }, 'resolve_turn').slice(1));
const read = async (projectId: string, taskId: string): Promise<TaskView> => (await (await context.request.get(`${base}/api/projects/${projectId}/tasks/${taskId}`)).json()).task;
const submit = async (message: string) => { await page.locator('.conversation-compose textarea').fill(message); await page.getByRole('button', { name: '发送', exact: true }).click(); await expect(page.locator('.conversation-state h4')).toHaveText('等待回复'); return new URL(page.url()).searchParams.get('task')!; };
try {
  await page.goto(base); await page.getByLabel('邮箱', { exact: true }).fill(email); await page.getByLabel('密码', { exact: true }).fill(password); await page.getByRole('button', { name: '登录', exact: true }).click(); await page.locator('.empty-studio').waitFor();
  const project = await createProject(principal, { name: '会客与办公之间', template: 'empty', operationId: randomUUID() }); projectIds.push(project.id);
  const synthetic = syntheticPlanningInput();
  // Seed only this test's synthetic geometry, never task results, checks, candidates or model outcomes.
  await pool.query('UPDATE projects SET snapshot=$1 WHERE id=$2 AND owner_id=$3', [synthetic.state, project.id, identity.userId]);
  await pool.query('UPDATE project_revisions SET snapshot=$1 WHERE project_id=$2 AND revision=1', [synthetic.state, project.id]);
  const original = await getProject(principal, project.id);
  await page.goto(`${base}/?project=${project.id}&view=tasks`);
  const taskId = await submit('保留现有家具。'); const sourced = await read(project.id, taskId);
  await runTask(taskId, { conversation: { model: model('固定协议样本：保留家具的要求已经记录。', undefined, { summary: '保留现有家具。', requirements: [{ content: '保留现有家具。', sourceKind: 'user_explicit', sourceInputIds: [sourced.conversation!.brief!.inputs[0].id] }], questions: [] }) } });
  await expect(page.locator('.conversation-state h4')).toHaveText('回答已完成');
  await submit('请为这个房间生成会客和办公布局，保留现有家具');
  const initial = await read(project.id, taskId), input = initial.conversation!.brief!.inputs.at(-1)!;
  await runTask(taskId, { conversation: { model: model('固定协议样本：根据你的要求生成会客与办公候选，采用前请查看实际检查结果。', { ...synthetic.decision, sourceInputIds: [input.id], requirementIds: initial.conversation!.brief!.requirements.map(item => item.id) }) } });
  await expect(page.locator('.conversation-state h4')).toHaveText('候选已保存，等待你决定');
  const recommended = await read(project.id, taskId), outcome = recommended.conversation!.outcome!;
  assert.equal(outcome.planReport?.status, 'recommended'); assert.ok(outcome.candidateId); assert.equal((await getProject(principal, project.id)).revision, 1);
  await capture('recommendation'); await page.reload(); await expect(page.getByRole('button', { name: '查看推荐候选' })).toBeVisible();
  await page.getByRole('button', { name: '查看推荐候选' }).click(); await expect(page.locator('.candidate-recommendation')).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get('candidate'), outcome.candidateId);
  await page.locator('.layout-plan-report summary').click(); await capture('candidate');
  await page.reload(); await expect(page.locator('.candidate-recommendation')).toBeVisible();
  await page.getByRole('button', { name: '采用这版方案', exact: true }).click(); await expect(page.getByText('这版方案已采用并保存，可整体撤销。')).toBeVisible();
  assert.equal((await getProject(principal, project.id)).revision, 2); await capture('adopted', ['mobile']);
  await page.getByRole('button', { name: '整体撤销上次采用', exact: true }).click(); await expect(page.getByText('已整体撤销采用，恢复为新的当前方案版本。')).toBeVisible();
  assert.deepEqual((await getProject(principal, project.id)).scene.objects, original.scene.objects);
  assert.equal((await getProject(principal, project.id)).revision, 3);
  await page.getByRole('button', { name: '空间对话', exact: true }).click(); await expect(page.locator('.conversation-compose textarea')).toBeEnabled();
  await expect(page.locator('.conversation-state h4')).toHaveText('候选采用已记录');
  await expect(page.getByText('仅生成候选，不代表已采用或完成整套设计。', { exact: true })).toHaveCount(0);
  await capture('adoption-record', ['mobile']);
  await submit('先保留刚才的推荐，继续回答我的问题。');
  await runTask(taskId, { conversation: { model: fixtureModel([]) } });
  await expect(page.locator('.conversation-state h4')).toHaveText('部分完成');
  const partial = await read(project.id, taskId); assert.ok(partial.conversation!.execution!.unresolvedAttempts > 0); assert.ok(partial.conversation!.execution!.reservedTokens > 0); assert.ok(partial.conversation!.retained!.candidateIds.includes(outcome.candidateId!));
  await expect(page.getByText(/不按零用量处理/)).toBeVisible(); await expect(page.getByRole('button', { name: '查看已保存候选', exact: true })).toBeVisible();
  await capture('partial-unknown'); await page.reload(); await expect(page.getByRole('button', { name: '查看已保存候选', exact: true })).toBeVisible();
  const empty = await createProject(principal, { name: '尚待补充的空间', template: 'empty', operationId: randomUUID() }); projectIds.push(empty.id);
  await page.goto(`${base}/?project=${empty.id}&view=tasks`); const unknownId = await submit('请为这个房间生成会客和办公布局'); const unknownInitial = await read(empty.id, unknownId);
  await runTask(unknownId, { conversation: { model: model('固定协议样本：先检查空间是否具备可靠依据。', { ...synthetic.decision, sourceInputIds: [unknownInitial.conversation!.brief!.inputs[0].id] }) } });
  await expect(page.locator('.conversation-state h4')).toHaveText('等待你补充'); await expect(page.locator('.layout-plan-report')).toBeVisible();
  assert.equal((await read(empty.id, unknownId)).conversation?.outcome?.candidateId, undefined); await capture('needs-space', ['mobile']);
  await page.getByRole('button', { name: '取消本轮', exact: true }).click(); await expect(page.locator('.conversation-state h4')).toHaveText('本轮已取消');
  const failedId = await submit('回答一下这个空间目前的情况。'); await runTask(failedId, { conversation: { model: fixtureModel([]) } });
  await expect(page.locator('.conversation-state h4')).toHaveText('本轮未完成'); assert.equal((await read(empty.id, failedId)).conversation!.retained!.answerCount, 0); await capture('failed', ['mobile']);
  const limitProject = await createProject(principal, { name: '保留下来的沟通', template: 'angled', operationId: randomUUID() }); projectIds.push(limitProject.id);
  await page.goto(`${base}/?project=${limitProject.id}&view=tasks`); let limitTask = '';
  for (let i = 0; i < 7; i++) { limitTask = await submit(`第${i + 1}次补充：请说明空间当前状态。`); await runTask(limitTask, { conversation: { model: model(`固定协议样本：第${i + 1}次回答已保存，空间保持原状。`) } }); await expect(page.locator('.conversation-state h4')).toHaveText('回答已完成'); }
  await submit('继续回答，保留前面的记录。'); await runTask(limitTask, { conversation: { model: fixtureModel([], undefined, 429) } });
  await expect(page.locator('.conversation-state h4')).toHaveText('部分完成'); const limited = await read(limitProject.id, limitTask); assert.equal(limited.usage.used, 8); assert.equal(limited.conversation!.execution!.stopReason, 'USAGE_LIMIT'); assert.ok(limited.conversation!.retained!.answerCount >= 7);
  await capture('limit', ['desktop', 'mobile']);
  const staleProject = await createProject(principal, { name: '更新后的安排', template: 'empty', operationId: randomUUID() }); projectIds.push(staleProject.id);
  const staleSpace = syntheticPlanningInput();
  await pool.query('UPDATE projects SET snapshot=$1 WHERE id=$2 AND owner_id=$3', [staleSpace.state, staleProject.id, identity.userId]);
  await pool.query('UPDATE project_revisions SET snapshot=$1 WHERE project_id=$2 AND revision=1', [staleSpace.state, staleProject.id]);
  await page.goto(`${base}/?project=${staleProject.id}&view=tasks`);
  const staleTaskId = await submit('请为这个房间生成会客和办公布局，保留现有家具'), staleInitial = await read(staleProject.id, staleTaskId);
  await runTask(staleTaskId, { conversation: { model: model('固定协议样本：生成本轮候选。', { ...staleSpace.decision, sourceInputIds: [staleInitial.conversation!.brief!.inputs[0].id] }) } });
  await expect(page.locator('.conversation-state h4')).toHaveText('候选已保存，等待你决定');
  const staleCandidateId = (await read(staleProject.id, staleTaskId)).conversation!.outcome!.candidateId!;
  await submit('先不要生成新的方案，我要补充保留条件。');
  await page.goto(`${base}/?project=${staleProject.id}&view=candidates&candidate=${staleCandidateId}&task=${staleTaskId}`);
  await expect(page.getByText('空间或需求已更新。这份历史候选仅供参考，原推荐与检查不能沿用于当前要求；请回到空间对话重新生成。')).toBeVisible();
  await expect(page.getByRole('button', { name: '采用这版方案', exact: true })).toBeDisabled();
  await capture('stale-candidate');
  assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => document.fonts.check('400 14px "Tsanger YuYang"')), true); assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length), 0);
  await writeFile(`${out}/browser-result.json`, JSON.stringify({ passed: true, fixtureOnly: true, existingServicesOnly: true, recommendationNotApplied: true, explicitAdoption: true, adoptionStatusRefreshed: true, undo: true, recommendationReopened: true, unknownRetained: true, candidateRetained: true, missingSpaceWaits: true, failedWithoutWork: true, limitPreservesHistory: true, staleCandidateCannotAdopt: true, pageErrors: errors }, null, 2));
  console.log('T17/T21 UI passed, local SDK fixtures only.');
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {});
  console.log((await page.locator('main').textContent().catch(() => ''))?.slice(-2400)); throw error;
} finally {
  await browser.close();
  for (const projectId of projectIds) {
    const tasks = (await pool.query('SELECT id FROM design_tasks WHERE project_id=$1 AND owner_id=$2', [projectId, identity.userId])).rows;
    for (const task of tasks) await pool.query("DELETE FROM hestia_jobs.job WHERE data->>'taskId'=$1", [task.id]);
    await pool.query('DELETE FROM design_tasks WHERE project_id=$1 AND owner_id=$2', [projectId, identity.userId]);
    await pool.query('DELETE FROM candidate_adoptions WHERE project_id=$1 AND owner_id=$2', [projectId, identity.userId]);
    await pool.query('DELETE FROM operations WHERE project_id=$1 AND owner_id=$2', [projectId, identity.userId]);
    await pool.query('DELETE FROM project_revisions WHERE project_id=$1', [projectId]); await pool.query('DELETE FROM projects WHERE id=$1 AND owner_id=$2', [projectId, identity.userId]);
  }
  await pool.query('DELETE FROM hestia_invitation WHERE id=$1 AND user_id=$2', [invitation.id, identity.userId]); await pool.query('DELETE FROM hestia_auth_user WHERE id=$1 AND email=$2', [identity.userId, email]); await pool.end();
}
