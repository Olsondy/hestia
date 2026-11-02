// Fails when packages/persistence/src/schema has changes without a generated migration (`pnpm db:generate`).
// Runs drizzle-kit generate against a temporary copy of the migration folder; no database connection.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = join(root, 'packages/persistence/drizzle');
// drizzle-kit prefixes --out with "./", so the scratch copy must be a path relative to the repository root.
const work = `.tmp/db-drift-${process.pid}`;
try {
  mkdirSync(join(root, '.tmp'), { recursive: true });
  cpSync(source, join(root, work), { recursive: true });
  // An interactive prompt (e.g. rename detection) also means an unreviewed schema change, so stdin is closed.
  const result = spawnSync(process.execPath, [join(root, 'node_modules/drizzle-kit/bin.cjs'), 'generate', '--dialect', 'postgresql',
    '--schema', 'packages/persistence/src/schema/index.ts', '--out', work], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
  // drizzle-kit can exit 0 on errors, so only its explicit "no changes" message counts as a pass.
  if (result.status !== 0 || !/No schema changes/.test(result.stdout ?? '')) {
    process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}\n`);
    console.error('Schema changes have no migration. Run `pnpm db:generate` and commit packages/persistence/drizzle.');
    process.exitCode = 1;
  } else console.log('Schema and migrations are in step.');
} finally { rmSync(join(root, work), { recursive: true, force: true }); }
