// Creates .venv/dxf with the pinned DXF converter dependencies. Finite command; starts no service.
// Bootstrap interpreter: HESTIA_DXF_BOOTSTRAP_PYTHON, else python3 (3.10+ required by numpy 2.2).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url)), venv = `${root}.venv/dxf`;
const python = process.platform === 'win32' ? `${venv}/Scripts/python.exe` : `${venv}/bin/python`;
const run = (command, args) => { const result = spawnSync(command, args, { stdio: 'inherit' }); if (result.status !== 0) process.exit(result.status ?? 1); };
const bootstrap = process.env.HESTIA_DXF_BOOTSTRAP_PYTHON || 'python3';
const version = spawnSync(bootstrap, ['-c', 'import sys; print(sys.version_info >= (3, 10))'], { encoding: 'utf8' });
if (version.stdout?.trim() !== 'True') { console.error(`${bootstrap} must be Python 3.10 or newer; set HESTIA_DXF_BOOTSTRAP_PYTHON.`); process.exit(1); }
if (!existsSync(python)) run(bootstrap, ['-m', 'venv', venv]);
run(python, ['-I', '-m', 'pip', 'install', '--disable-pip-version-check', '-r', `${root}packages/floorplan-import/python/requirements-dxf.txt`]);
console.log(`DXF converter environment ready: ${python}`);
