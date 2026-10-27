import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { pool, transaction } from '../../packages/persistence/src/client';
import { createInvitation, acceptInvitation } from '../../packages/identity/src/service';

// Uses the existing user-started services. No model, consumer or server is started here.
const base = process.env.BETTER_AUTH_URL || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Existing local service only');
const email = `free-experience-${randomUUID()}@example.test`, secondEmail = `free-existing-${randomUUID()}@example.test`, password = randomUUID();
const out = '.impeccable/review/c01', errors: string[] = [], guestRequests: string[] = [];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage(); page.setDefaultTimeout(20000);
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) guestRequests.push(new URL(request.url()).pathname); });
const capture = async (prefix: string, sizes = ['desktop', 'mobile']) => {
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
    if (!sizes.includes(name)) continue;
    await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.evaluate(() => scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${out}/${prefix}-${name}.png`, fullPage: true });
  }
};
try {
  const invitation = await createInvitation(secondEmail), secondUser = await acceptInvitation(invitation.token, '第二账户验收', password);
  // Distinct, owned synthetic account makes stale cross-account balances observable.
  await transaction(async client => {
    await client.query('UPDATE credit_accounts SET available=7 WHERE user_id=$1', [secondUser.userId]);
    await client.query("UPDATE credit_ledger SET amount=7 WHERE user_id=$1 AND kind='registration_grant'", [secondUser.userId]);
  });
  await page.goto(base); await expect(page.getByRole('heading', { name: '公开示例空间' })).toBeVisible();
  await expect(page.locator('[data-scene-ready=true]')).toBeVisible();
  await expect(page.getByText('合成示例 · 非真实户型')).toBeVisible();
  await capture('guest');
  await page.getByRole('button', { name: '斜墙空间' }).click(); await expect(page.getByRole('button', { name: '斜墙空间' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-scene-ready=true]')).toBeVisible(); await capture('guest-alternate', ['mobile']);
  assert.ok(!guestRequests.some(path => ['/api/projects', '/api/credits', '/api/register'].includes(path)));
  assert.equal((await context.request.get(`${base}/api/projects`)).status(), 401);
  assert.equal((await context.request.get(`${base}/api/credits`)).status(), 401);
  await page.getByRole('button', { name: '免费注册', exact: true }).click();
  await expect(page.getByRole('heading', { name: '创建你的工作室' })).toBeVisible(); await capture('register');
  await page.getByLabel('你的名字').fill('合成注册验收'); await page.getByLabel('邮箱', { exact: true }).fill(email); await page.getByLabel('设置密码').fill(password);
  let loseResponse = true;
  await page.route('**/api/register', async route => {
    if (loseResponse) { loseResponse = false; const accepted = await route.fetch(); assert.equal(accepted.status(), 201); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: '注册并进入' }).click();
  await expect(page.locator('.form-error')).toContainText('连接中断'); await capture('retry', ['mobile']);
  await page.getByRole('button', { name: '注册并进入' }).click(); await expect(page.locator('.empty-studio')).toBeVisible();
  await page.getByRole('button', { name: '我的积分' }).click();
  await expect(page.locator('.credit-balance')).toContainText('40'); await expect(page.getByText('注册赠送')).toBeVisible();
  await capture('credits'); await page.reload(); await page.getByRole('button', { name: '我的积分' }).click();
  await expect(page.locator('.credit-balance')).toContainText('40');
  const credits = await (await context.request.get(`${base}/api/credits`)).json();
  assert.equal(credits.balance.available, 40); assert.equal(credits.entries.length, 1);
  await page.getByRole('button', { name: '收起', exact: true }).click();
  await page.getByRole('button', { name: '创建第一个项目' }).click();
  await page.getByLabel('项目名称').fill('合成个人空间'); await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.workspace-header h1')).toHaveText('合成个人空间'); const projectId = new URL(page.url()).searchParams.get('project'); assert.ok(projectId);
  await page.reload(); await expect(page.locator('.workspace-header h1')).toHaveText('合成个人空间');
  await page.getByRole('button', { name: '我的积分' }).click(); await expect(page.locator('.credit-balance')).toContainText('40');
  // Change the shared browser cookie outside this tab, then return focus. Old content must not be reused.
  assert.equal((await context.request.post(`${base}/api/auth/sign-out`, { headers: { Origin: base }, data: {} })).status(), 200);
  assert.equal((await context.request.post(`${base}/api/auth/sign-in/email`, { headers: { Origin: base }, data: { email: secondEmail, password } })).status(), 200);
  const otherTab = await context.newPage(); await otherTab.goto('about:blank'); await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.empty-studio')).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.has('project'), false);
  await page.getByRole('button', { name: '我的积分' }).click(); await expect(page.locator('.credit-balance')).toContainText('7');
  await expect(page.getByText('注册赠送')).toBeVisible(); await otherTab.close();
  await page.getByRole('button', { name: '退出', exact: true }).click(); await expect(page.getByRole('heading', { name: '公开示例空间' })).toBeVisible();
  await page.getByLabel('邮箱', { exact: true }).fill(email); await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page.locator('.folio')).toBeVisible();
  const again = await (await context.request.get(`${base}/api/credits`)).json(); assert.equal(again.balance.available, 40); assert.equal(again.entries.length, 1);
  assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => document.fonts.check('400 14px "Tsanger YuYang"')), true);
  await writeFile(`${out}/browser-result.json`, JSON.stringify({ passed: true, existingServicesOnly: true, syntheticExample: true, guestNoPrivateRequests: true,
    guestProtectedApis401: true, registrationLostResponseRetry: true, registrationAndSignIn: true, grantOnceAndReload: true,
    privateProjectReopened: true, crossTabIdentityCacheIsolated: true, repeatLoginNoExtraGrant: true, pageErrors: errors }, null, 2));
  console.log('C01 browser validation passed; existing services only.');
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  try { await transaction(async client => {
    const users = (await client.query('SELECT id FROM hestia_auth_user WHERE email=ANY($1::text[])', [[email, secondEmail]])).rows.map(row => row.id);
    const projects = (await client.query('SELECT id FROM projects WHERE created_by=ANY($1::text[])', [users])).rows.map(row => row.id);
    await client.query('DELETE FROM operations WHERE actor_id=ANY($1::text[])', [users]);
    await client.query('DELETE FROM project_revisions WHERE project_id=ANY($1::uuid[])', [projects]);
    await client.query('DELETE FROM projects WHERE created_by=ANY($1::text[])', [users]);
    await client.query('DELETE FROM hestia_invitation WHERE email=$1', [secondEmail]);
    await client.query('DELETE FROM hestia_auth_user WHERE email=ANY($1::text[])', [[email, secondEmail]]);
  }); } finally { await pool.end(); }
}
