import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { transaction } from '../../persistence/src/client';
import { issueRegistrationGrant } from '../../credits/src/service';
import { ensurePersonalWorkspace } from '../../workspaces/src/service';

export const registrationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(128),
}).strict();
type Registration = z.infer<typeof registrationSchema>;

/** All new-user effects either commit together or roll back together. */
export async function createRegistrationInTransaction(client: PoolClient, input: Registration, passwordHash: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`hestia:registration:${input.email}`]);
  const existing = await client.query('SELECT id FROM hestia_auth_user WHERE email=$1', [input.email]);
  if (existing.rowCount) return;
  const userId = randomUUID();
  // Invitation acceptance uses the same Better Auth credential-account contract.
  await client.query('INSERT INTO hestia_auth_user(id,name,email,email_verified) VALUES($1,$2,$3,false)', [userId, input.name, input.email]);
  await client.query('INSERT INTO hestia_auth_account(id,account_id,provider_id,user_id,password) VALUES($1,$2,$3,$2,$4)',
    [randomUUID(), userId, 'credential', passwordHash]);
  await issueRegistrationGrant(client, userId);
  await ensurePersonalWorkspace(client, userId);
}

export async function register(input: unknown) {
  const parsed = registrationSchema.parse(input);
  // Hash outside the transaction to avoid holding DB locks for scrypt work.
  const passwordHash = await hashPassword(parsed.password);
  try {
    await transaction(client => createRegistrationInTransaction(client, parsed, passwordHash));
  } catch (error) {
    // A concurrently accepted legacy invitation can win the user-email uniqueness race.
    // The losing registration transaction is entirely rolled back, and must not grant credits.
    if ((error as { code?: string }).code !== '23505' || (error as { constraint?: string }).constraint !== 'hestia_auth_user_email_key') throw error;
  }
  // Neutral response for existing identities prevents account enumeration. Login validates password.
  return { registered: true as const };
}
