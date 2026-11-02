import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { eq } from 'drizzle-orm';
import { advisoryXactLock, orm, transaction } from '../../persistence/src/client';
import { hestiaAuthAccount, hestiaAuthUser } from '../../persistence/src/schema';
import { issueRegistrationGrant } from '../../credits/src/service';
import { ensurePersonalWorkspace } from '../../workspaces/src/service';
import { DomainError } from '../../contracts/src/project';

/** Deployment switch (ADR-0007): enterprise-facing deployments close open registration; the code stays shared. */
export const registrationOpen = (env: NodeJS.ProcessEnv = process.env) => env.HESTIA_REGISTRATION?.trim().toLowerCase() !== 'closed';

export const registrationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(128),
}).strict();
type Registration = z.infer<typeof registrationSchema>;

/** All new-user effects either commit together or roll back together. */
export async function createRegistrationInTransaction(client: PoolClient, input: Registration, passwordHash: string) {
  const tx = orm(client);
  await advisoryXactLock(tx, `hestia:registration:${input.email}`);
  const existing = await tx.select({ id: hestiaAuthUser.id }).from(hestiaAuthUser).where(eq(hestiaAuthUser.email, input.email));
  if (existing.length) return;
  const userId = randomUUID();
  // Invitation acceptance uses the same Better Auth credential-account contract.
  await tx.insert(hestiaAuthUser).values({ id: userId, name: input.name, email: input.email, emailVerified: false });
  await tx.insert(hestiaAuthAccount).values({ id: randomUUID(), accountId: userId, providerId: 'credential', userId, password: passwordHash });
  await issueRegistrationGrant(client, userId);
  await ensurePersonalWorkspace(client, userId);
}

export async function register(input: unknown) {
  if (!registrationOpen()) throw new DomainError('REGISTRATION_CLOSED', '当前未开放注册。', 403);
  const parsed = registrationSchema.parse(input);
  // Hash outside the transaction to avoid holding DB locks for scrypt work.
  const passwordHash = await hashPassword(parsed.password);
  try {
    await transaction(client => createRegistrationInTransaction(client, parsed, passwordHash));
  } catch (error) {
    // A concurrently accepted legacy invitation can win the user-email uniqueness race.
    // The losing registration transaction is entirely rolled back, and must not grant credits.
    // Drizzle wraps driver errors in `cause`; errors raised by raw queries (e.g. COMMIT) arrive unwrapped.
    const pgError = ((error as { cause?: unknown }).cause ?? error) as { code?: string; constraint?: string };
    if (pgError.code !== '23505' || pgError.constraint !== 'hestia_auth_user_email_key') throw error;
  }
  // Neutral response for existing identities prevents account enumeration. Login validates password.
  return { registered: true as const };
}
