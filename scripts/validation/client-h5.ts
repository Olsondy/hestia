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
const phones = { targeted: '13800138000', selfService: '13900139000', open: '13700137000' };
const canonical = (code: string) => code.replace('-', '');
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
  await step('根路径官网入口 → 客户端（ADR-0015，HESTIA_HOME_ENTRY 已设置时）', async () => {
    await visitor.goto(base);
    if (process.env.HESTIA_HOME_ENTRY) {
      await visitor.getByRole('link', { name: /进入客户端/ }).click();
      await visitor.waitForURL(/\/c\//);
    }
  });

  // Targeted share code (ADR-0012): pasted as the member's share message on the H5 home, anonymous preview, gate,
  // sign-in with the targeted phone, automatic binding.
  const owner = await phone(browser);
  await step('定向分享码：首页粘贴分享口令 → 未登录预览', async () => {
    await owner.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    await owner.goto(`${base}/c`);
    await owner.evaluate(text => navigator.clipboard.writeText(text), `【演示家装企业】方案分享码 ${seed.targeted.code}，在企业的小程序或 H5 首页输入即可查看。`);
    await owner.getByRole('button', { name: /收到企业的分享码/ }).click();
    await shot(owner, '00-code-sheet');
    await owner.locator('dialog[open]').getByRole('button', { name: '粘贴', exact: true }).click();
    await owner.waitForURL(new RegExp(`/s/${canonical(seed.targeted.code)}$`), { timeout: 30000 });
    await owner.locator('.stage').first().waitFor({ timeout: 30000 });
    await shot(owner, '01-share-preview');
  });
  await step('定向分享：调整需登录 → 指定手机号登录 → 自动绑定', async () => {
    await owner.getByRole('button', { name: /调整/ }).first().click();
    await owner.getByRole('button', { name: '手机号登录' }).click();
    await owner.waitForURL(/login/); await login(owner, phones.targeted);
    await owner.getByRole('heading', { name: '已绑定到你的账号' }).waitFor({ timeout: 30000 }); await shot(owner, '02-bound');
    await owner.getByRole('link', { name: '查看并调整方案' }).click(); await owner.waitForURL(/\/r\//);
  });
  await step('方案页：切换方案与 3D 查看', async () => {
    await owner.getByRole('group', { name: '切换方案' }).getByRole('button').nth(1).click();
    await owner.getByRole('group', { name: '查看方式' }).getByRole('button', { name: '3D' }).click();
    await owner.locator('.stage__viewer canvas').waitFor({ timeout: 60000 }); await owner.waitForTimeout(4000);
    await owner.screenshot({ path: path.join(out, '03-3d.png'), timeout: 120000 });
    await owner.getByRole('group', { name: '查看方式' }).getByRole('button', { name: '效果图' }).click();
  });
  await step('确认方案并留言 → 已确认', async () => {
    await owner.getByRole('link', { name: /确认方案/ }).click(); await owner.waitForURL(/confirm/);
    await owner.locator('textarea').fill('演示留言：想约周末看样品。');
    await owner.getByRole('button', { name: /确认方案/ }).click(); await owner.waitForURL(/done/);
    await shot(owner, '04-confirmed');
  });
  await step('调整：换软装风格 + 换石材 → 一次出图生成一个修订 → 提示需要重新确认', async () => {
    await owner.getByRole('link', { name: '回到方案' }).click(); await owner.waitForURL(/\/r\/[^/]+$/);
    await owner.getByRole('link', { name: /继续调整|调整/ }).first().click(); await owner.waitForURL(/adjust/);
    await owner.getByRole('button', { name: '软装风格' }).click();
    await owner.locator('.style-opt[aria-pressed=false]').first().click();
    await owner.getByRole('button', { name: '硬装石材' }).click();
    await owner.locator('.swatch[aria-pressed=false]').first().click();
    await owner.getByText('2 处修改未出图').first().waitFor();
    await owner.getByRole('button', { name: /重新出图 · 生成修订/ }).click();
    await owner.getByText('重新出图中').first().waitFor({ timeout: 30000 }); await shot(owner, '05-rerender');
    await owner.goto(owner.url().replace(/\/adjust$/, ''));
    await owner.getByText('需要重新确认').waitFor({ timeout: 30000 });
  });

  // Another phone on the used targeted code, then the open share code typed by hand.
  const other = await phone(browser);
  await step('另一手机号打开已绑定的定向分享码 → 已使用', async () => {
    await other.goto(`${base}/c/login?next=${encodeURIComponent(`/s/${canonical(seed.targeted.code)}/bind`)}`);
    await login(other, phones.open);
    await other.getByRole('heading', { name: '这个分享码已使用' }).waitFor({ timeout: 30000 }); await shot(other, '06-code-used');
  });
  await step('分享码：错误码提示 → 手动输入正确码 → 登录即绑定', async () => {
    await other.goto(`${base}/c/projects`);
    await other.getByRole('button', { name: /输入分享码/ }).first().click();
    await other.getByPlaceholder('例如 HX7K-9QP2').fill('ABCD-EFGH'); await other.getByRole('button', { name: '打开方案' }).click();
    await other.getByText('分享码不正确或已失效').waitFor({ timeout: 30000 });
    await other.getByPlaceholder('例如 HX7K-9QP2').fill(seed.open.code.toLowerCase()); await other.getByRole('button', { name: '打开方案' }).click();
    await other.waitForURL(/\/s\/[A-Z0-9]{8}$/, { timeout: 30000 });
    await other.getByRole('button', { name: /调整/ }).first().click();
    await other.getByRole('heading', { name: '已绑定到你的账号' }).waitFor({ timeout: 30000 }); await shot(other, '07-code-bound');
  });

  // Self-service request with the demo villa.
  const self = await phone(browser);
  await step('客户自助：登录 → 示例别墅 → 饰面 → 石材 → 提交 → 出图', async () => {
    await self.goto(`${base}/c`); await self.getByRole('button', { name: /提交方案需求/ }).click();
    await self.waitForURL(/login/); await login(self, phones.selfService);
    await self.waitForURL(/\/new$/); await self.getByRole('radio', { name: /示例别墅/ }).click();
    await self.getByRole('button', { name: /下一步：选择饰面/ }).click(); await shot(self, '08-finishes');
    await self.getByRole('button', { name: /下一步：挑选石材/ }).click();
    await self.locator('.swatch').nth(0).click(); await self.locator('.swatch').nth(3).click();
    await self.getByRole('radio', { name: '浅色' }).click();
    await self.getByRole('button', { name: '提交方案需求' }).click(); await self.waitForURL(/\/r\//);
    await self.getByText('正在排版出图').waitFor({ timeout: 30000 });
    await self.reload(); await self.getByText('正在排版出图').waitFor({ timeout: 30000 }); await shot(self, '09-generating');
  });
  await step('我的项目：自己提交的与企业分享的分组', async () => {
    await other.goto(`${base}/c/projects`); await other.getByText('企业分享给我的').waitFor();
    await other.locator('.project').first().waitFor(); await shot(other, '10-projects');
  });
  await step('不存在的分享码 → 不正确或已失效', async () => {
    await visitor.goto(`${base}/s/ABCDEFGH`); await visitor.getByRole('heading', { name: '分享码不正确或已失效' }).waitFor();
  });
} finally { await browser.close(); }

for (const [name, ok, detail] of results) process.stdout.write(`${ok ? '通过' : '失败'}  ${name}${detail ? `：${detail}` : ''}\n`);
process.stdout.write(`外网请求：${external.size ? [...external].join(', ') : '无'}\n页面错误：${pageErrors.length ? pageErrors.slice(0, 5).join(' | ') : '无'}\n截图：${out}\n`);
process.stdout.write('本次验收已使用演示数据，演示前请运行 pnpm demo:seed --reset。\n');
if (results.some(([, ok]) => !ok) || external.size || pageErrors.length) process.exitCode = 1;
