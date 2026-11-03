import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Load before spawning Next. Passing --env-file through Next's NODE_OPTIONS re-exec is invalid.
process.loadEnvFile(new URL('../.env', import.meta.url));
const action = process.argv[2] ?? 'dev';
if (!['dev', 'build', 'start'].includes(action)) throw new Error('Expected dev, build or start');
if (action !== 'start') await import('./prepare-pdf-worker.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const args = [fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)), action, 'apps/web'];
// Loopback by default; HESTIA_WEB_HOST (e.g. 0.0.0.0) lets phones on the same LAN reach a demo.
if (action !== 'build') args.push('--hostname', process.env.HESTIA_WEB_HOST || '127.0.0.1');
const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
// Stop Next with us (Ctrl+C, or `pnpm dev:all` stopping its services), so no dev server is left behind.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (child.exitCode === null) child.kill(signal); });
child.on('error', () => { process.exitCode = 1; });
