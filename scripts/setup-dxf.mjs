// Creates .venv/dxf with the pinned DXF converter dependencies. Finite command; starts no service.
// Bootstrap interpreter: HESTIA_DXF_BOOTSTRAP_PYTHON, else python3 (3.10+ required by numpy 2.2).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url)), venv = `${root}.venv/dxf`;
const python = process.platform === 'win32' ? `${venv}/Scripts/python.exe` : `${venv}/bin/python`;
const run = (command, args) => { const result = spawnSync(command, args, { stdio: 'inherit' }); if (result.status !== 0) process.exit(result.status ?? 1); };
// Windows usually has `python` or the `py` launcher rather than `python3`.
const candidates = process.env.HESTIA_DXF_BOOTSTRAP_PYTHON ? [[process.env.HESTIA_DXF_BOOTSTRAP_PYTHON]] : [['python3'], ['python'], ['py', '-3']];
const found = candidates.find(([command, ...pre]) =>
  spawnSync(command, [...pre, '-c', 'import sys; print(sys.version_info >= (3, 10))'], { encoding: 'utf8' }).stdout?.trim() === 'True');
if (!found) { console.error('Python 3.10 or newer was not found (tried python3, python, py -3); set HESTIA_DXF_BOOTSTRAP_PYTHON.'); process.exit(1); }
const [bootstrap, ...pre] = found;
if (!existsSync(python)) run(bootstrap, [...pre, '-m', 'venv', venv]);
// Skip pip when the pinned requirements are already installed (marker holds their hash).
const requirements = `${root}packages/floorplan-import/python/requirements-dxf.txt`, marker = `${venv}/.requirements.sha256`;
const hash = createHash('sha256').update(readFileSync(requirements)).digest('hex');
if (!existsSync(marker) || readFileSync(marker, 'utf8') !== hash) {
  run(python, ['-I', '-m', 'pip', 'install', '--disable-pip-version-check', '-r', requirements]);
  writeFileSync(marker, hash);
}
console.log(`DXF converter environment ready: ${python}`);
