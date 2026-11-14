import { grantPlatformAdmin, listPlatformAdmins, revokePlatformAdmin } from '../packages/platform-admin/src/service';
import { pool } from '../packages/persistence/src/client';

// Trusted server command (ADR-0018): grant or revoke platform administrators. There is no self-service path.
try {
  const args = process.argv.slice(2), isSuper = args.includes('--super'), [action = 'list', email] = args.filter(arg => arg !== '--super');
  if (!['grant', 'revoke', 'list'].includes(action) || (action !== 'list' && !email))
    throw new Error('Usage: pnpm platform:admin grant [--super] <email> | revoke <email> | list');
  const result = action === 'grant' ? await grantPlatformAdmin(email!, isSuper ? 'super' : 'platform')
    : action === 'revoke' ? await revokePlatformAdmin(email!) : { admins: await listPlatformAdmins() };
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to update platform administrators.'); process.exitCode = 1;
} finally { await pool.end(); }
