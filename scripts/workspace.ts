import { createWorkspace } from '../packages/workspaces/src/service';
import { pool } from '../packages/persistence/src/client';

// Trusted local admin command: creates (or idempotently re-confirms) an explicitly provisioned workspace.
try {
  const [kind, slug, name, adminEmail] = process.argv.slice(2);
  if (!kind || !slug || !name || !adminEmail)
    throw new Error('Usage: pnpm workspace:create <kind> <slug> <name> <admin-email>   e.g. enterprise demo-stone "演示企业" admin@example.test');
  const result = await createWorkspace({ kind, slug, name, adminEmail });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to create workspace.'); process.exitCode = 1;
} finally { await pool.end(); }
