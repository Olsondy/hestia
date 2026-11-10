import { deleteWorkspace, exportWorkspace, migrateFileKeys } from '../packages/workspaces/src/data';
import { pool } from '../packages/persistence/src/client';

// Trusted maintainer commands for one enterprise's data on the shared deployment (ADR-0017, M04).
const usage = 'Usage: pnpm workspace:export <slug> <empty-dir> | pnpm workspace:delete <slug> --confirm <slug> | pnpm files:migrate-keys';
try {
  const [command, slug, ...rest] = process.argv.slice(2);
  const result = command === 'export' && slug && rest[0] ? await exportWorkspace(slug, rest[0])
    : command === 'delete' && slug && rest[0] === '--confirm' ? await deleteWorkspace(slug, rest[1] ?? '')
    : command === 'migrate-keys' ? await migrateFileKeys()
    : (() => { throw new Error(usage); })();
  console.log(JSON.stringify(command === 'export' ? { ...result, files: (result as { files: unknown[] }).files.length } : result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Workspace data command failed.'); process.exitCode = 1;
} finally { await pool.end(); }
