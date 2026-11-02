// D09 acceptance of the H5 client against a running demo (pnpm dev + pnpm worker:render, after pnpm demo:seed).
// Phone viewport, real browser. Every request to a host other than the app is blocked and reported, so a pass also
// shows the pages need no internet. The run consumes the demo: afterwards run pnpm demo:seed --reset.
//
//   pnpm validate:client-h5 [output-directory]
import { readFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

const base = (process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const out = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'hestia-client-h5'));
const seed = JSON.parse(await readFile(path.resolve(process.env.PRIVATE_STORAGE_PATH ?? './private-data', 'demo', 'seed.json'), 'utf8'));
const phones = { targeted: '13800138000', selfService: '13900139000', withCode: '13700137000' };
const external = new Set<string>(), pageErrors: string[] = [], results: [string, boolean, string][] = [];
await mkdir(out, { recursive: true });

async function phone(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  const app = new URL(base).host;
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:' || url.host === app) return route.continue();
    external.add(url.host); return route.abort('internetdisconnected');
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  return page;
}
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true, timeout: 60000 });
async function login(page: Page, number: string) {
  await page.getByPlaceholder('11 位手机号').fill(number);
  await page.getByRole('button', { name: /获取验证码|重新获取/ }).click();
  await page.getByRole('button', { name: '填入' }).click();
  await page.getByRole('button', { name: '登录', exact: true }).click();
}
async function step(name: string, work: () => Promise<void>) {
  try { await work(); results.push([name, true, '']); }
  catch (error) { results.push([name, false, (error as Error).message.split('\n')[0]]); }
}

const browser = await chromium.launch();
try {
  const visitor = await phone(browser);
  await step('根路径进入企业入口（HESTIA_HOME_ENTRY 已设置时）', async () => {
    await visitor.goto(base);
    if (process.env.HESTIA_HOME_ENTRY && !/\/c\//.test(visitor.url())) throw new Error(`未跳转：${visitor.url()}`);
  });

  // Targeted share: anonymous preview with pre-rendered images, gate, sign-in with the targeted phone, automatic binding.
  const owner = await phone(browser);
  await step('定向分享：未登录预览（效果图已预生成）', async () => {
    await owner.goto(`${base}/s/${seed.targeted.token}`);
    await owner.locator('.plate-img img').waitFor({ timeout: 30000 });
    await shot(owner, '01-share-preview');
  });
  await step('定向分享：调整需登录 → 指定手机号登录 → 自动绑定', async () => {
    await owner.getByRole('button', { name: /调整/ }).first().click();
    await owner.getByRole('button', { name: '手机号登录' }).click();
    await owner.waitForURL(/login/); await login(owner, phones.targeted);
    await owner.getByText('已绑定到').waitFor({ timeout: 30000 }); await shot(owner, '02-bound');
    await owner.getByRole('link', { name: '查看并调整方案' }).click(); await owner.waitForURL(/\/r\//);
  });
  await step('方案页：切换方案与 3D 查看', async () => {
    await owner.locator('.rail-item').nth(1).click();
    await owner.getByRole('button', { name: /3D 查看/ }).click();
    await owner.locator('.viewer canvas').waitFor({ timeout: 60000 }); await owner.waitForTimeout(4000);
    await owner.screenshot({ path: path.join(out, '03-3d.png'), timeout: 120000 });
    await owner.getByRole('button', { name: /效果图/ }).first().click();
  });
  await step('确认方案并留言 → 已确认', async () => {
    await owner.getByRole('link', { name: /确认方案/ }).click(); await owner.waitForURL(/confirm/);
    await owner.locator('textarea').fill('演示留言：想约周末看样品。');
    await owner.getByRole('button', { name: /确认方案/ }).click(); await owner.waitForURL(/done/);
    await shot(owner, '04-confirmed');
  });
  await step('调整：换石材 → 新修订出图中 → 提示需要重新确认', async () => {
    await owner.getByRole('link', { name: '回到方案' }).click(); await owner.waitForURL(/\/r\/[^/]+$/);
    await owner.getByRole('link', { name: /继续调整|调整/ }).first().click(); await owner.waitForURL(/adjust/);
    await owner.locator('.swatch[aria-pressed=false]').first().click();
    await owner.getByText('重新出图中').first().waitFor({ timeout: 30000 }); await shot(owner, '05-rerender');
    await owner.goto(owner.url().replace(/\/adjust$/, ''));
    await owner.getByText('需要重新确认').waitFor({ timeout: 30000 });
  });

  // Another phone on the targeted link, then the code share.
  const other = await phone(browser);
  await step('另一手机号打开已绑定的定向分享 → 只能预览', async () => {
    await other.goto(`${base}/c/demo-stone/login?next=${encodeURIComponent(`/s/${seed.targeted.token}/bind`)}`);
    await login(other, phones.withCode);
    await other.getByText('其他客户').waitFor({ timeout: 30000 }); await shot(other, '06-already-bound');
  });
  await step('绑定码分享：错误码提示剩余次数 → 正确码绑定', async () => {
    await other.goto(`${base}/s/${seed.code.token}/bind`);
    await other.getByPlaceholder('6 位绑定码').fill('AAAAAA'); await other.getByRole('button', { name: '绑定到我的账号' }).click();
    await other.getByText(/还可尝试 4 次/).waitFor({ timeout: 30000 });
    await other.getByPlaceholder('6 位绑定码').fill(seed.code.code); await other.getByRole('button', { name: '绑定到我的账号' }).click();
    await other.getByText('已绑定到').waitFor({ timeout: 30000 }); await shot(other, '07-code-bound');
  });

  // Self-service request with the demo villa.
  const self = await phone(browser);
  await step('客户自助：登录 → 示例别墅 → 饰面 → 石材 → 提交 → 出图', async () => {
    await self.goto(`${base}/c/demo-stone`); await self.getByRole('button', { name: /提交方案需求/ }).click();
    await self.waitForURL(/login/); await login(self, phones.selfService);
    await self.waitForURL(/\/new$/); await self.getByRole('radio', { name: /示例别墅/ }).click();
    await self.getByRole('button', { name: /下一步：选择饰面/ }).click(); await shot(self, '08-finishes');
    await self.getByRole('button', { name: /下一步：挑选石材/ }).click();
    await self.locator('.stone').nth(0).click(); await self.locator('.stone').nth(3).click();
    await self.getByRole('radio', { name: '浅色' }).click();
    await self.getByRole('button', { name: '提交方案需求' }).click(); await self.waitForURL(/\/r\//);
    await self.getByText('排版出图').waitFor({ timeout: 30000 });
    await self.reload(); await self.getByText('排版出图').waitFor({ timeout: 30000 }); await shot(self, '09-generating');
  });
  await step('我的项目：自己提交的与企业分享的分组', async () => {
    await other.goto(`${base}/c/demo-stone/projects`); await other.getByText('企业分享给我的').waitFor();
    await other.locator('.proj').first().waitFor(); await shot(other, '10-projects');
  });
  await step('伪造链接 → 已失效', async () => {
    await visitor.goto(`${base}/s/${'x'.repeat(32)}`); await visitor.getByText('这个分享链接').waitFor();
  });
} finally { await browser.close(); }

for (const [name, ok, detail] of results) process.stdout.write(`${ok ? '通过' : '失败'}  ${name}${detail ? `：${detail}` : ''}\n`);
process.stdout.write(`外网请求：${external.size ? [...external].join(', ') : '无'}\n页面错误：${pageErrors.length ? pageErrors.slice(0, 5).join(' | ') : '无'}\n截图：${out}\n`);
process.stdout.write('本次验收已使用演示数据，演示前请运行 pnpm demo:seed --reset。\n');
if (results.some(([, ok]) => !ok) || external.size || pageErrors.length) process.exitCode = 1;
