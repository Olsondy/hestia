import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { desc, eq } from 'drizzle-orm';
import { DomainError } from '../../contracts/src/project';
import type { CreditsView } from '../../contracts/src/credits';
import type { Principal } from '../../projects/src/service';
import { db, orm } from '../../persistence/src/client';
import { creditAccounts, creditLedger, creditRules } from '../../persistence/src/schema';

/** Called inside the same transaction that inserts a new public identity. */
export async function issueRegistrationGrant(client: PoolClient, userId: string) {
  const tx = orm(client);
  const [rules] = await tx.select({ registrationGrant: creditRules.registrationGrant }).from(creditRules).where(eq(creditRules.singleton, true)).for('share');
  const amount = rules?.registrationGrant;
  if (amount === undefined || !Number.isSafeInteger(amount) || amount < 0 || amount > 1000000)
    throw new DomainError('CREDIT_CONFIGURATION_INVALID', '积分配置暂不可用，请稍后再试。', 503);
  await tx.insert(creditAccounts).values({ userId, available: amount, reserved: 0 });
  await tx.insert(creditLedger).values({ id: randomUUID(), userId, kind: 'registration_grant', amount });
}

/** No user ID is accepted from the HTTP client. Existing invited users are not backfilled. */
export async function getMyCredits(principal: Principal): Promise<CreditsView> {
  if (!principal.userId) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  const [account] = await db.select({ available: creditAccounts.available, reserved: creditAccounts.reserved }).from(creditAccounts).where(eq(creditAccounts.userId, principal.userId));
  const entries = await db.select({ id: creditLedger.id, kind: creditLedger.kind, amount: creditLedger.amount, createdAt: creditLedger.createdAt })
    .from(creditLedger).where(eq(creditLedger.userId, principal.userId)).orderBy(desc(creditLedger.createdAt), desc(creditLedger.id)).limit(100);
  return { balance: { available: account?.available ?? 0, reserved: account?.reserved ?? 0 },
    entries: entries.map(row => ({ id: row.id, kind: row.kind, amount: row.amount, createdAt: row.createdAt.toISOString() })) };
}
