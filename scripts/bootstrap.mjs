// One command after cloning or pulling: .env (kept if present), database migrations, the three queues, the headless
// browser for renders and the DXF converter environment. Every step is idempotent, so running it again after a pull is safe. Starts no service.
//   pnpm bootstrap
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const node = (args, label, optional = false) => {
  process.stdout.write(`\n▶ ${label}\n`);
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    if (optional) { process.stdout.write(`⚠ ${label}未完成，其余功能不受影响（见上方提示）。\n`); return false; }
    process.stderr.write(`\n✖ ${label}失败。请先确认 PostgreSQL 已启动、.env 里的 DATABASE_URL 正确，再重新运行 pnpm bootstrap。\n`);
    process.exit(result.status ?? 1);
  }
  return true;
};
node(['scripts/setup-local.mjs'], '本地配置 .env');
node(['--env-file=.env', '--import', 'tsx', 'scripts/migrate.ts'], '数据库迁移');
node(['--env-file=.env', '--import', 'tsx', 'scripts/queues.ts'], '后台队列');
const browser = node(['node_modules/@playwright/test/cli.js', 'install', 'chromium'], '出图用的无头浏览器（首次需下载）', true);
const dxf = node(['scripts/setup-dxf.mjs'], 'DXF 转换环境（需要 Python 3.10+）', true);
process.stdout.write(`\n✔ 准备完成${[browser ? '' : '效果图暂不可用', dxf ? '' : 'DXF 自动转换暂不可用'].filter(Boolean).map(t => `（${t}）`).join('')}。\n  演示数据：pnpm demo:seed --reset\n  启动：    pnpm dev:all\n`);
