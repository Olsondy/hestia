import { usageReport } from '../packages/workspaces/src/usage';
import { billingByWorkspace } from '../packages/model-registry/src/usage';
import { pool } from '../packages/persistence/src/client';

// Trusted local admin command: monthly usage per workspace (ADR-0017, M03). Read-only.
try {
  const args = process.argv.slice(2), at = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const month = at('--month'), slug = at('--workspace');
  if (!month) throw new Error('Usage: pnpm usage:report --month YYYY-MM [--workspace <slug>]');
  // billing: priced model calls (ADR-0018), amounts in fen at each call's price version; unverified calls counted at the reserved amount.
  const report = await usageReport(month, slug);
  console.log(JSON.stringify(await Promise.all(report.map(async row => ({ ...row, billing: await billingByWorkspace(month, row.workspace.id) }))), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to build the usage report.'); process.exitCode = 1;
} finally { await pool.end(); }
