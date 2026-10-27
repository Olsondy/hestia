import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';
import { transaction } from '../../persistence/src/client';
import { issueRegistrationGrant } from '../../credits/src/service';
import { ensurePersonalWorkspace } from '../../workspaces/src/service';

const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const acceptInvitationSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), name: z.string().trim().min(1).max(100), password: z.string().min(8).max(128),
}).strict();
export class InvitationError extends Error {
  constructor(public code: 'INVALID_INVITATION' | 'ACCOUNT_EXISTS') { super(code); }
}
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

/** Trusted local admin command only: there is intentionally no public create-invitation endpoint. */
export async function createInvitation(email: string, expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)) {
  const normalizedEmail = emailSchema.parse(email);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now() || expiresAt.getTime() > Date.now() + 30 * 86400000)
    throw new Error('Invitation expiry must be in the future and within 30 days.');
  const token = randomBytes(32).toString('base64url'), id = randomUUID();
  await transaction(async client => {
    const existing = await client.query('SELECT id FROM hestia_auth_user WHERE email=$1', [normalizedEmail]);
    if (existing.rowCount) throw new InvitationError('ACCOUNT_EXISTS');
    await client.query('INSERT INTO hestia_invitation(id,email,token_hash,expires_at) VALUES($1,$2,$3,$4)',
      [id, normalizedEmail, digest(token), expiresAt]);
  });
  return { id, email: normalizedEmail, token, expiresAt };
}

/** Invitation consumption, credential creation, and email uniqueness commit atomically. */
export async function acceptInvitation(token: string, name: string, password: string) {
  const input = acceptInvitationSchema.parse({ token, name, password });
  return transaction(async client => {
    const selected = await client.query<{ id: string; email: string }>(
      'SELECT id,email FROM hestia_invitation WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE', [digest(input.token)]);
    const invitation = selected.rows[0];
    if (!invitation) throw new InvitationError('INVALID_INVITATION');
    const existing = await client.query('SELECT id FROM hestia_auth_user WHERE email=$1', [invitation.email]);
    if (existing.rowCount) throw new InvitationError('ACCOUNT_EXISTS');
    const passwordHash = await hashPassword(input.password), userId = randomUUID();
    // The selected row may expire while hashing. Recheck using wall-clock time in the same transaction.
    const consumed = await client.query('UPDATE hestia_invitation SET consumed_at=clock_timestamp() WHERE id=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING id', [invitation.id]);
    if (!consumed.rowCount) throw new InvitationError('INVALID_INVITATION');
    try {
      await client.query('INSERT INTO hestia_auth_user(id,name,email,email_verified) VALUES($1,$2,$3,false)', [userId, input.name, invitation.email]);
      // Matches Better Auth credential-account contract; hash uses its official scrypt implementation.
      await client.query('INSERT INTO hestia_auth_account(id,account_id,provider_id,user_id,password) VALUES($1,$2,$3,$2,$4)',
        [randomUUID(), userId, 'credential', passwordHash]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new InvitationError('ACCOUNT_EXISTS');
      throw error;
    }
    // New accounts created through a still-valid legacy invitation are new users too.
    // Existing identities are never backfilled, and invitation/grant commit atomically.
    await issueRegistrationGrant(client, userId);
    await ensurePersonalWorkspace(client, userId);
    await client.query('UPDATE hestia_invitation SET user_id=$2 WHERE id=$1', [invitation.id, userId]);
    return { userId, email: invitation.email };
  });
}
