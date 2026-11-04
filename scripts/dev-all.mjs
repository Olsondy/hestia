// Starts the web app and both Workers (renders, floorplan imports) in one terminal, with prefixed logs. Queues are
// checked first. Ctrl+C stops everything; if one process exits, the others are stopped too.
//   pnpm dev:all      development server (hot reload)
//   pnpm demo:start   production build from `pnpm demo:build` (much smaller pages; needs HESTIA_DEMO=1 for mock SMS)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const production = process.argv.includes('--start');
if (production && !existsSync(new URL('../apps/web/.next/BUILD_ID', import.meta.url))) {
  process.stderr.write('✖ 还没有生产构建，请先运行 pnpm demo:build（每次拉取新代码后都要重新构建）。\n'); process.exit(1);
}
const env = ['--env-file=.env', '--import', 'tsx'];
const queues = spawnSync(process.execPath, [...env, 'scripts/queues.ts'], { cwd: root, stdio: 'inherit' });
if (queues.status !== 0) { process.stderr.write('✖ 队列准备失败，请先运行 pnpm bootstrap。\n'); process.exit(queues.status ?? 1); }
const services = [
  ['web   ', ['scripts/web.mjs', production ? 'start' : 'dev']],
  ['render', [...env, 'scripts/render-worker.ts']],
  ['import', [...env, 'scripts/import-worker.ts']],
];
let stopping = false;
const children = services.map(([name, args]) => {
  const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const pipe = (stream, out) => { let rest = ''; stream.on('data', chunk => {
    const lines = (rest + chunk).split(/\r?\n/); rest = lines.pop() ?? '';
    for (const line of lines) out.write(`[${name}] ${line}\n`);
  }); };
  pipe(child.stdout, process.stdout); pipe(child.stderr, process.stderr);
  child.on('exit', code => { if (!stopping) { process.stderr.write(`[${name}] 已退出（${code}），停止其他服务。\n`); stop(code ?? 1); } });
  return child;
});
/** Ends a service with its own children (Next starts a dev server process); Windows needs taskkill for the tree. */
const end = child => process.platform === 'win32' ? spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) : child.kill('SIGTERM');
function stop(code = 0) {
  stopping = true;
  for (const child of children) if (child.exitCode === null) end(child);
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => stop(0)); process.on('SIGTERM', () => stop(0));
