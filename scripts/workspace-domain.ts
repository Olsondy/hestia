import { addWorkspaceDomain, listWorkspaceDomains, removeWorkspaceDomain } from '../packages/workspaces/src/domains';
import { pool } from '../packages/persistence/src/client';

// Trusted local admin command: entry domains of a workspace on the shared deployment (ADR-0017). Idempotent.
try {
  const [slug, action = 'list', host] = process.argv.slice(2);
  if (!slug || !['add', 'remove', 'list'].includes(action) || (action !== 'list' && !host))
    throw new Error('Usage: pnpm workspace:domain <slug> add|remove <host> | pnpm workspace:domain <slug> [list]   e.g. demo-home add a.localhost');
  const result = action === 'add' ? await addWorkspaceDomain(slug, host!) : action === 'remove' ? await removeWorkspaceDomain(slug, host!)
    : { domains: await listWorkspaceDomains(slug) };
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to update workspace domains.'); process.exitCode = 1;
} finally { await pool.end(); }
