import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Load before spawning Next. Passing --env-file through Next's NODE_OPTIONS re-exec is invalid.
process.loadEnvFile(new URL('../.env', import.meta.url));
const action = process.argv[2] ?? 'dev';
if (!['dev', 'build', 'start'].includes(action)) throw new Error('Expected dev, build or start');
if (action !== 'start') await import('./prepare-pdf-worker.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const args = [fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)), action, 'apps/web'];
if (action !== 'build') args.push('--hostname', '127.0.0.1');
const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
child.on('error', () => { process.exitCode = 1; });
