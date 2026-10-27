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

// Existing services only. Finite runners use local SDK transport fixtures; no real model calls.
const base = process.env.BETTER_AUTH_URL || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Existing local service only');
const out = '.impeccable/review/t10', run = randomUUID(), email = `requirements-ui-${run}@example.test`, password = randomUUID();
await mkdir(out, { recursive: true });
const invitation = await createInvitation(email), identity = await acceptInvitation(invitation.token, '需求验收', password), principal = { userId: identity.userId };
const projectIds: string[] = [], errors: string[] = [];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
let page = await context.newPage();
const attach = () => { page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message)); }; attach();
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
const textBox = () => page.locator('.conversation-compose textarea');
const openBrief = async () => { if (!(await page.locator('.conversation-brief').evaluate(el => (el as HTMLDetailsElement).open))) await page.locator('.conversation-brief>summary').click(); };
const submit = async (text: string) => { await textBox().fill(text); await page.getByRole('button', { name: '发送', exact: true }).click(); await expect(page.locator('.conversation-state h4')).toHaveText('等待回复'); return new URL(page.url()).searchParams.get('task')!; };
const model = (reply: string, decision: unknown = { kind: 'answer', message: reply }, brief?: unknown) => fixtureModel(toolChunks({ reply, decision, ...(brief ? { brief } : {}) }, 'resolve_turn').slice(1));
try {
  const project = await createProject(principal, { name: '慢慢整理家的想法', template: 'angled', operationId: randomUUID() }); projectIds.push(project.id);
  const original = await getProject(principal, project.id), url = `${base}/?project=${project.id}&view=tasks`;
  const read = async (id: string): Promise<TaskView> => (await (await context.request.get(`${base}/api/projects/${project.id}/tasks/${id}`)).json()).task;
  await page.goto(base); await page.getByLabel('邮箱', { exact: true }).fill(email); await page.getByLabel('密码', { exact: true }).fill(password); await page.getByRole('button', { name: '登录', exact: true }).click(); await page.locator('.folio').waitFor();
  await page.goto(url); await expect(page.getByText('从一个具体的想法开始。')).toBeVisible(); await capture('empty', ['desktop', 'mobile']);
  const firstMessage = '我想保留现有书桌，并安排一个安静的阅读角。';
  const taskId = await submit(firstMessage), initial = await read(taskId), firstInputId = initial.conversation!.brief!.inputs[0].id;
  const suggestion = '阅读角可以增加一盏独立阅读灯。', prompt = '你通常在白天还是晚上阅读？', firstReply = '这是固定协议样本：已记录保留书桌的要求，阅读灯只是待确认建议。继续前想了解阅读时间。';
  await runTask(taskId, { conversation: { model: model(firstReply, undefined, { summary: '保留现有书桌，进一步了解阅读习惯。', requirements: [{ content: firstMessage, sourceKind: 'user_explicit', sourceInputIds: [firstInputId] }, { content: suggestion, sourceKind: 'assistant_suggestion', sourceInputIds: [] }], questions: [{ key: 'reading-time', prompt }] }) } });
  await expect(page.locator('.conversation-state h4')).toHaveText('等待你补充'); await expect(page.locator('.conversation-response')).toContainText(firstReply);
  await openBrief(); await expect(page.getByText('你明确提出', { exact: true })).toBeVisible(); await expect(page.getByText('助手建议 · 待确认', { exact: true })).toBeVisible();
  await page.locator('.conversation-source summary').first().click(); await expect(page.locator('.conversation-source blockquote').first()).toContainText(firstMessage);
  await capture('waiting');
  await page.reload(); await expect(page.locator('.conversation-state h4')).toHaveText('等待你补充'); await expect(page.getByText(prompt, { exact: true })).toBeVisible();
  const waiting = await read(taskId), question = waiting.conversation!.brief!.questions[0]; assert.equal(question.status, 'open');
  await page.getByRole('button', { name: '回答这条问题', exact: true }).click();
  const acceptedIds: string[] = []; let lost = true;
  await page.route(`**/api/projects/${project.id}/tasks/${taskId}/inputs`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = route.request().postDataJSON(); acceptedIds.push(body.operationId); assert.equal(body.questionId, question.id);
    if (lost) { lost = false; const response = await route.fetch(); assert.equal(response.status(), 202); await route.abort('failed'); } else await route.continue();
  });
  const answer = '我主要在晚上阅读，每次大约一小时。';
  await textBox().fill(answer); await page.getByRole('button', { name: '发送', exact: true }).click(); await expect(page.getByRole('button', { name: '重试同一条消息' })).toBeVisible(); await capture('retry', ['mobile']);
  await page.getByRole('button', { name: '重试同一条消息' }).click(); await expect(page.locator('.conversation-state h4')).toHaveText('等待回复'); await page.unroute(`**/api/projects/${project.id}/tasks/${taskId}/inputs`);
  assert.equal(acceptedIds.length, 2); assert.equal(acceptedIds[0], acceptedIds[1]);
  const resumed = await read(taskId); assert.equal(resumed.conversation!.brief!.intentVersion, 2); assert.equal(resumed.conversation!.brief!.inputs.filter(input => input.questionId === question.id).length, 1);
  await expect(page.locator('.conversation-response')).toHaveCount(0); await capture('resumed', ['desktop', 'mobile']);
  await page.close();
  const answerInput = resumed.conversation!.brief!.inputs.at(-1)!;
  const secondReply = '这是固定协议样本：已记录夜间阅读习惯。阅读灯仍待你确认，现有书桌与空间没有改变。';
  await runTask(taskId, { conversation: { model: model(secondReply, undefined, { summary: '保留书桌，并围绕夜间阅读梳理需求。', requirements: [{ content: answer, sourceKind: 'user_explicit', sourceInputIds: [answerInput.id] }], questions: [{ key: 'reading-time', prompt }] }) } });
  page = await context.newPage(); attach(); await page.goto(`${url}&task=${taskId}`); await expect(page.locator('.conversation-response')).toContainText(secondReply); await expect(page.locator('.conversation-state h4')).toHaveText('回答已完成');
  await expect(page.getByText('目前的问题都已回答；仍可以继续补充需求。')).toBeVisible(); await page.locator('.conversation-answered>summary').click(); await expect(page.locator('.conversation-answered blockquote')).toHaveText(answer);
  await page.locator('.conversation-past>summary').click(); await expect(page.locator('.conversation-past')).toContainText(firstReply); await capture('answered');
  const beforeConfirm = await read(taskId), requirement = beforeConfirm.conversation!.brief!.requirements.find(item => item.content === suggestion)!;
  const confirmationRequest = page.waitForRequest(request => request.url().endsWith(`/tasks/${taskId}/inputs`) && request.method() === 'POST');
  await openBrief(); await page.getByRole('button', { name: `确认需求：${suggestion}`, exact: true }).click(); const confirmationBody = (await confirmationRequest).postDataJSON();
  assert.equal(confirmationBody.kind, 'confirm_requirement'); assert.equal(confirmationBody.requirementId, requirement.id); assert.equal(confirmationBody.requirementRevision, requirement.revision); assert.equal(confirmationBody.expectedIntentVersion, 2);
  await expect(page.locator('.conversation-state h4')).toHaveText('等待回复'); await expect(page.getByText('你已确认', { exact: true })).toBeVisible();
  await runTask(taskId, { conversation: { model: model('这是固定协议样本：已保存你对阅读灯的确认。这只更新需求，不会添加或移动家具。', undefined, { summary: '保留书桌；夜间阅读需要一盏独立阅读灯。', requirements: [{ content: suggestion, sourceKind: 'assistant_suggestion', sourceInputIds: [] }], questions: [] }) } });
  await expect(page.locator('.conversation-state h4')).toHaveText('回答已完成');
  const confirmed = await read(taskId); assert.equal(confirmed.conversation!.brief!.requirements.filter(item => item.content === suggestion).length, 1); assert.equal(confirmed.conversation!.brief!.requirements.find(item => item.id === requirement.id)!.sourceKind, 'user_confirmed');
  await page.reload(); await expect(page.locator('.conversation-brief')).toBeVisible(); await openBrief(); await expect(page.getByText('你已确认', { exact: true })).toBeVisible(); await page.locator(`[data-requirement-id="${requirement.id}"] summary`).click(); await capture('confirmed');
  assert.deepEqual((await getProject(principal, project.id)).scene.objects, original.scene.objects);
  await page.getByLabel('本轮关注的物品', { exact: true }).selectOption('desk-b'); const move = '把所选家具沿图纸向右移动20厘米'; await submit(move);
  let release!: () => void, prepared!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { prepared = resolve; });
  const oldReply = '旧要求下的固定提案：准备向右移动20厘米。';
  const execution = runTask(taskId, { conversation: { model: model(oldReply, { kind: 'move', userAct: 'explicit_request', evidenceQuote: move, direction: 'right', distanceText: '20', unit: 'cm' }), beforeCommit: async () => { prepared(); await gate; } } });
  try {
    await Promise.race([ready, execution.then(() => { throw new Error('Runner finished before inspection gate'); })]); await expect(page.locator('.conversation-response')).toContainText(oldReply);
    await submit('先不要移动书桌，只保留已经确认的阅读需求。'); await expect(page.locator('.conversation-response')).toHaveCount(0); await capture('superseded', ['mobile']);
  } finally { release(); await execution; }
  assert.equal((await getProject(principal, project.id)).revision, 1);
  await runTask(taskId, { conversation: { model: model('这是固定协议样本：已按新补充停止旧提案，书桌未移动。') } });
  await expect(page.locator('.conversation-response')).toContainText('已按新补充停止旧提案'); await expect(page.locator('.conversation-response')).not.toContainText(oldReply);
  assert.equal((await read(taskId)).conversation!.brief!.history.find(turn => turn.input.message === move)?.status, 'superseded');
  assert.deepEqual((await getProject(principal, project.id)).scene.objects, original.scene.objects);
  await submit('继续整理我的阅读习惯。'); await runTask(taskId, { conversation: { model: fixtureModel([], undefined, 500) } }); await expect(page.locator('.conversation-state h4')).toHaveText('本轮未完成'); await expect(textBox()).toBeEnabled(); await capture('failed', ['mobile']);
  const cancelledId = await submit('这次先讨论窗帘。'); await runTask(cancelledId, { conversation: { model: model('这是固定协议样本：想了解遮光偏好。', undefined, { summary: '了解窗帘偏好。', requirements: [], questions: [{ key: 'curtain', prompt: '你更需要遮光还是透光？' }] }) } });
  await expect(page.locator('.conversation-state h4')).toHaveText('等待你补充'); await page.getByRole('button', { name: '取消本轮', exact: true }).click(); await expect(page.locator('.conversation-state h4')).toHaveText('本轮已取消'); await expect(textBox()).toBeEnabled(); await expect(page.getByText('正在读取本轮已保存的回复…', { exact: true })).toHaveCount(0); await capture('cancelled', ['mobile']);
  assert.equal(await page.evaluate(() => document.fonts.check('400 14px "Tsanger YuYang"')), true); assert.equal(await page.evaluate(() => document.getAnimations().length), 0); assert.deepEqual(errors, []);
  await writeFile(`${out}/browser-result.json`, JSON.stringify({ passed: true, fixtureOnly: true, existingServicesOnly: true, widths: [1440, 1100, 390], sourceKindsDistinct: true, sourceOriginalText: true, waitingReopened: true, answeredQuestionBoundAndNotReasked: true, sameInputLostAckRetry: true, intentVersionAdvanced: true, explicitSuggestionConfirmation: true, modelCannotDowngradeConfirmation: true, earlierIntentSeparated: true, supersededMoveCannotCommit: true, noSceneChange: true, failedAndCancelled: true, pageErrors: errors }, null, 2));
  console.log('T10 UI passed: sourced needs, bound answers, durable waiting/resume, explicit confirmation, superseded intent, failure/cancel. Fixed SDK fixtures only.');
} catch (error) { if (!page.isClosed()) { await page.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {}); console.log((await page.locator('main').textContent().catch(() => ''))?.slice(-2400)); } throw error;
} finally {
  await browser.close();
  for (const projectId of projectIds) {
    const taskRows = (await pool.query('SELECT id FROM design_tasks WHERE project_id=$1 AND actor_id=$2', [projectId, identity.userId])).rows;
    for (const task of taskRows) await pool.query("DELETE FROM hestia_jobs.job WHERE data->>'taskId'=$1", [task.id]);
    await pool.query('DELETE FROM design_tasks WHERE project_id=$1 AND actor_id=$2', [projectId, identity.userId]);
    await pool.query('DELETE FROM operations WHERE project_id=$1 AND actor_id=$2', [projectId, identity.userId]); await pool.query('DELETE FROM project_revisions WHERE project_id=$1', [projectId]); await pool.query('DELETE FROM projects WHERE id=$1 AND created_by=$2', [projectId, identity.userId]);
  }
  await pool.query('DELETE FROM hestia_invitation WHERE id=$1 AND user_id=$2', [invitation.id, identity.userId]); await pool.query('DELETE FROM hestia_auth_user WHERE id=$1 AND email=$2', [identity.userId, email]); await pool.end();
}
