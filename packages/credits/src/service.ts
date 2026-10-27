import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DomainError } from '../../contracts/src/project';
import type { CreditsView } from '../../contracts/src/credits';
import type { Principal } from '../../projects/src/service';
import { pool } from '../../persistence/src/client';

/** Called inside the same transaction that inserts a new public identity. */
export async function issueRegistrationGrant(client: PoolClient, userId: string) {
  const rules = (await client.query('SELECT registration_grant FROM credit_rules WHERE singleton=true FOR SHARE')).rows[0];
  const amount = rules?.registration_grant;
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000000)
    throw new DomainError('CREDIT_CONFIGURATION_INVALID', '积分配置暂不可用，请稍后再试。', 503);
  await client.query('INSERT INTO credit_accounts(user_id,available,reserved) VALUES($1,$2,0)', [userId, amount]);
  await client.query("INSERT INTO credit_ledger(id,user_id,kind,amount) VALUES($1,$2,'registration_grant',$3)", [randomUUID(), userId, amount]);
}

/** No user ID is accepted from the HTTP client. Existing invited users are not backfilled. */
export async function getMyCredits(principal: Principal): Promise<CreditsView> {
  if (!principal.userId) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  const account = (await pool.query('SELECT available,reserved FROM credit_accounts WHERE user_id=$1', [principal.userId])).rows[0];
  const entries = (await pool.query('SELECT id,kind,amount,created_at FROM credit_ledger WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100', [principal.userId])).rows;
  return { balance: { available: account?.available ?? 0, reserved: account?.reserved ?? 0 },
    entries: entries.map(row => ({ id: row.id, kind: row.kind, amount: row.amount, createdAt: row.created_at.toISOString() })) };
}
