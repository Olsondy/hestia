import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createInvitation, acceptInvitation } from '../../packages/identity/src/service';
import { createProject, getProject } from '../../packages/projects/src/service';
import { pool } from '../../packages/persistence/src/client';
import { runTask } from '../../packages/tasks/src/runner';
import { fixtureModel, toolChunks } from '../../packages/model-validation/src/protocol-fixture';
import type { TaskView } from '../../packages/contracts/src/tasks';

// Existing Next/API/PG plus finite runner calls with an injected SDK transport fixture.
// No service, daemon, queue consumer, real model request, or model key inspection.
const base = process.env.BETTER_AUTH_URL || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Existing local service only');
const out = '.impeccable/review/t08', run = randomUUID(), email = `conversation-ui-${run}@example.test`, password = randomUUID();
await mkdir(out, { recursive: true });
const invitation = await createInvitation(email), identity = await acceptInvitation(invitation.token, '对话验收', password), principal = { userId: identity.userId };
const projectIds: string[] = [], errors: string[] = [];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
let page = await context.newPage();
const attach = () => { page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message)); };
attach();
const capture = async (prefix: string) => {
  for (const [name, width, height] of [['desktop', 1440, 1000], ['1100', 1100, 900], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('[data-scene-ready=true]')).toBeVisible(); await page.evaluate(() => scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${out}/${prefix}-${name}.png`, fullPage: true });
  }
};
const submit = async (message: string) => { await page.getByLabel('说说你的想法').fill(message); await page.getByRole('button', { name: '发送', exact: true }).click(); await expect(page.locator('.conversation-state h4')).toHaveText('等待回复'); return new URL(page.url()).searchParams.get('task')!; };
const mixedReply = '这是固定协议样本：书桌靠窗时请注意眩光、开窗范围和通行空间；实际布置需要核对尺寸。移动要求已提出，是否应用以本轮记录结果为准。';
const model = (decision: unknown, reply?: string) => {
  const message = typeof decision === 'object' && decision !== null && 'message' in decision ? String(decision.message) : mixedReply;
  // Deliberately tool-only: prove reply survives even with no free-text stream deltas.
  return fixtureModel(toolChunks({ reply: reply ?? message, decision }, 'resolve_turn').slice(1));
};
try {
  const project = await createProject(principal, { name: '书桌旁的一点变化', template: 'angled', operationId: randomUUID() }); projectIds.push(project.id);
  const original = await getProject(principal, project.id), desk = original.scene.objects.find(item => item.id === 'desk-b')!;
  const url = `${base}/?project=${project.id}&view=tasks`;
  await page.goto(base); await page.getByLabel('邮箱', { exact: true }).fill(email); await page.getByLabel('密码', { exact: true }).fill(password); await page.getByRole('button', { name: '登录', exact: true }).click(); await page.locator('.folio').waitFor();
  await page.goto(url); await expect(page.getByText('从一个具体的想法开始。')).toBeVisible(); await capture('empty');
  await page.getByLabel('本轮关注的物品', { exact: true }).selectOption('desk-b');
  const acceptedIds: string[] = [];
  let lostResponse = true;
  await page.route(`**/api/projects/${project.id}/tasks`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    acceptedIds.push(route.request().postDataJSON().operationId);
    if (lostResponse) { lostResponse = false; const response = await route.fetch(); assert.equal(response.status(), 202); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByLabel('说说你的想法').fill('书桌靠窗需要注意什么？'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试同一条消息', exact: true })).toBeVisible();
  await page.screenshot({ path: `${out}/retry-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: '重试同一条消息', exact: true }).click(); await expect(page.locator('.conversation-state h4')).toHaveText('等待回复');
  assert.equal(acceptedIds.length, 2); assert.equal(acceptedIds[0], acceptedIds[1]); await page.unroute(`**/api/projects/${project.id}/tasks`);
  const firstId = new URL(page.url()).searchParams.get('task')!;
  let tasks = (await (await context.request.get(`${base}/api/projects/${project.id}/tasks`)).json()).tasks as TaskView[];
  assert.equal(tasks.length, 1); assert.equal(tasks[0].conversation?.input.selectedObjectId, 'desk-b');
  assert.equal(tasks[0].conversation?.input.referenceFrame, 'plan');
  await capture('queued');
  await page.close();
  await runTask(firstId, { conversation: { model: model({ kind: 'answer', message: '这是固定协议样本：书桌靠窗时可以留意眩光、开窗范围和通行空间；实际布置需要核对尺寸。本轮没有移动家具。' }) } });
  page = await context.newPage(); attach(); await page.goto(`${url}&task=${firstId}`); await expect(page.locator('.conversation-state h4')).toHaveText('回答已完成'); await expect(page.locator('.conversation-response')).toContainText('实际布置需要核对尺寸');
  assert.equal((await getProject(principal, project.id)).revision, 1); await page.screenshot({ path: `${out}/answer-desktop.png`, fullPage: true });
  await page.getByLabel('本轮关注的物品', { exact: true }).selectOption('desk-b');
  const command = '把所选家具沿图纸向右移动20厘米';
  const secondId = await submit(`书桌靠窗有什么需要注意的？${command}。`);
  let release!: () => void, prepared!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { prepared = resolve; });
  const execution = runTask(secondId, { conversation: { model: model({ kind: 'move', userAct: 'explicit_request', evidenceQuote: command, direction: 'right', distanceText: '20', unit: 'cm' }), beforeCommit: async () => { prepared(); await gate; } } });
  try {
    await Promise.race([ready, execution.then(() => { throw new Error('Finite runner finished before the validation capture gate'); })]); await expect(page.locator('.conversation-state h4')).toHaveText('正在检查本轮结果'); await expect(page.locator('.conversation-response')).toBeVisible();
    await expect(page.getByText('本轮修改已应用', { exact: true })).toHaveCount(0);
    assert.equal((await getProject(principal, project.id)).revision, 1);
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: `${out}/streaming-desktop.png`, fullPage: true });
  } finally { release(); await execution; }
  await expect(page.locator('.conversation-state h4')).toHaveText('本轮修改已应用');
  await expect(page.locator('.conversation-response')).toContainText(mixedReply);
  await expect(page.locator('.conversation-scene-heading')).toContainText('版本 2');
  let current = await getProject(principal, project.id), moved = current.scene.objects.find(item => item.id === desk.id)!;
  assert.equal(current.revision, 2); assert.equal(moved.position.x, Number((desk.position.x + .2).toFixed(9))); assert.equal(moved.position.z, desk.position.z);
  assert.deepEqual(current.scene.objects.filter(item => item.id !== desk.id), original.scene.objects.filter(item => item.id !== desk.id));
  await capture('applied'); await page.reload(); await expect(page.locator('.conversation-state h4')).toHaveText('本轮修改已应用'); await expect(page.locator('.conversation-response')).toContainText(mixedReply);
  await page.getByRole('button', { name: '查看修改与撤销', exact: true }).click(); await expect(page.getByLabel('X 位置（米）')).toHaveValue(String(moved.position.x));
  await page.getByRole('button', { name: '撤销最近修改', exact: true }).click(); await expect(page.getByText('已撤销最近一次修改。')).toBeVisible();
  current = await getProject(principal, project.id); assert.equal(current.revision, 3); assert.deepEqual(current.scene.objects, original.scene.objects);
  await page.getByRole('button', { name: '空间对话', exact: true }).click(); await expect(page.locator('.conversation-outcome')).toContainText('当前空间版本 3');
  await page.getByLabel('本轮关注的物品', { exact: true }).selectOption('');
  const clarifyId = await submit('帮我挪得舒服一点');
  await runTask(clarifyId, { conversation: { model: model({ kind: 'clarification', message: '这是固定协议样本：请先选择家具，并说明沿图纸的方向和准确距离。本轮未修改空间。' }) } });
  await expect(page.locator('.conversation-state h4')).toHaveText('需要你补充'); await expect(page.locator('.conversation-response')).toContainText('请先选择家具'); await page.screenshot({ path: `${out}/clarification-mobile.png`, fullPage: true });
  const falseClaimId = await submit('书桌这样摆可以吗？');
  await runTask(falseClaimId, { conversation: { model: model({ kind: 'answer', message: '这是故意构造的错误声明：已移动20厘米。' }) } });
  await expect(page.locator('.conversation-state h4')).toHaveText('回答已完成');
  await expect(page.locator('.conversation-outcome')).toContainText('空间未修改');
  await expect(page.locator('.conversation-response')).toContainText('已移动20厘米');
  await expect(page.locator('.conversation-response')).toContainText('空间操作以上方已记录的本轮结果为准');
  assert.equal(await page.locator('.conversation-outcome').evaluate(el => !!(el.compareDocumentPosition(el.parentElement!.querySelector('.conversation-response')!) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
  assert.equal((await getProject(principal, project.id)).revision, 3);
  await page.screenshot({ path: `${out}/false-claim-mobile.png`, fullPage: true });
  const failureId = await submit('现在帮我回答一个空间问题');
  await runTask(failureId, { conversation: { model: fixtureModel([], undefined, 500) } });
  await expect(page.locator('.conversation-state h4')).toHaveText('本轮未完成'); await expect(page.locator('.conversation-turn .conversation-error')).toBeVisible();
  await page.screenshot({ path: `${out}/failed-mobile.png`, fullPage: true }); assert.equal((await getProject(principal, project.id)).revision, 3);
  await submit('这条消息用于验证排队取消'); await page.getByRole('button', { name: '取消本轮', exact: true }).click(); await expect(page.locator('.conversation-state h4')).toHaveText('本轮已取消');
  await page.screenshot({ path: `${out}/cancelled-mobile.png`, fullPage: true });
  const empty = await createProject(principal, { name: '等待开始的空间', template: 'empty', operationId: randomUUID() }); projectIds.push(empty.id);
  await page.goto(`${base}/?project=${empty.id}&view=tasks`); await expect(page.getByText('从一个具体的想法开始。')).toBeVisible(); await expect(page.locator('[data-scene-ready=true]')).toBeVisible();
  assert.equal(await page.getByLabel('本轮关注的物品', { exact: true }).locator('option').count(), 1);
  await page.screenshot({ path: `${out}/blank-space-mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.fonts.check('400 14px "Tsanger YuYang"')), true); assert.equal(await page.evaluate(() => document.getAnimations().length), 0); assert.deepEqual(errors, []);
  await writeFile(`${out}/browser-result.json`, JSON.stringify({ passed: true, scope: 'real Next/API/PG and finite runner with explicitly injected SDK transport; zero real model calls; no Worker service', widths: [1440, 1100, 390], lostResponseSameOperation: true, acceptedBeforeClosedPage: true, reopenedSameAnswer: true, toolOnlyMixedQuestionAnsweredAndMoveApplied: true, mixedReplyPersistedAcrossReload: true, streamingNotAppliedBeforeCommit: true, exactSelectedDeskMoveOnce: true, sceneAndUndoRefreshed: true, falseProseCannotOverrideRecordedOutcome: true, clarification: true, failed: true, cancellation: true, blankSpace: true, pageErrors: errors }, null, 2));
  console.log('T08 UI passed: unified conversation, persisted replay, exact operation and undo, stream versus outcome, three widths, failure/clarification/cancel. Fixed SDK fixture only.');
} catch (error) {
  if (!page.isClosed()) { await page.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {}); console.log((await page.locator('main').textContent().catch(() => ''))?.slice(0, 2000)); }
  throw error;
} finally {
  await browser.close();
  for (const projectId of projectIds) {
    const taskRows = (await pool.query('SELECT id FROM design_tasks WHERE project_id=$1 AND owner_id=$2', [projectId, identity.userId])).rows;
    for (const task of taskRows) await pool.query("DELETE FROM hestia_jobs.job WHERE id=$1 AND data->>'taskId'=$2", [task.id, task.id]);
    await pool.query('DELETE FROM design_tasks WHERE project_id=$1 AND owner_id=$2', [projectId, identity.userId]);
    await pool.query('DELETE FROM operations WHERE project_id=$1 AND owner_id=$2', [projectId, identity.userId]);
    await pool.query('DELETE FROM project_revisions WHERE project_id=$1', [projectId]);
    await pool.query('DELETE FROM projects WHERE id=$1 AND owner_id=$2', [projectId, identity.userId]);
  }
  await pool.query('DELETE FROM hestia_invitation WHERE id=$1 AND user_id=$2', [invitation.id, identity.userId]);
  await pool.query('DELETE FROM hestia_auth_user WHERE id=$1 AND email=$2', [identity.userId, email]);
  await pool.end();
}
