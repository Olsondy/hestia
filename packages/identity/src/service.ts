import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { transaction } from '../../persistence/src/client';
import { hestiaAuthAccount, hestiaAuthUser, hestiaInvitation } from '../../persistence/src/schema';
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
const now = sql`clock_timestamp()`;

/** Trusted local admin command only: there is intentionally no public create-invitation endpoint. */
export async function createInvitation(email: string, expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)) {
  const normalizedEmail = emailSchema.parse(email);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now() || expiresAt.getTime() > Date.now() + 30 * 86400000)
    throw new Error('Invitation expiry must be in the future and within 30 days.');
  const token = randomBytes(32).toString('base64url'), id = randomUUID();
  await transaction(async (_client, tx) => {
    const existing = await tx.select({ id: hestiaAuthUser.id }).from(hestiaAuthUser).where(eq(hestiaAuthUser.email, normalizedEmail));
    if (existing.length) throw new InvitationError('ACCOUNT_EXISTS');
    await tx.insert(hestiaInvitation).values({ id, email: normalizedEmail, tokenHash: digest(token), expiresAt });
  });
  return { id, email: normalizedEmail, token, expiresAt };
}

/** Invitation consumption, credential creation, and email uniqueness commit atomically. */
export async function acceptInvitation(token: string, name: string, password: string) {
  const input = acceptInvitationSchema.parse({ token, name, password });
  return transaction(async (client, tx) => {
    const [invitation] = await tx.select({ id: hestiaInvitation.id, email: hestiaInvitation.email }).from(hestiaInvitation)
      .where(and(eq(hestiaInvitation.tokenHash, digest(input.token)), isNull(hestiaInvitation.consumedAt), gt(hestiaInvitation.expiresAt, now))).for('update');
    if (!invitation) throw new InvitationError('INVALID_INVITATION');
    const existing = await tx.select({ id: hestiaAuthUser.id }).from(hestiaAuthUser).where(eq(hestiaAuthUser.email, invitation.email));
    if (existing.length) throw new InvitationError('ACCOUNT_EXISTS');
    const passwordHash = await hashPassword(input.password), userId = randomUUID();
    // The selected row may expire while hashing. Recheck using wall-clock time in the same transaction.
    const consumed = await tx.update(hestiaInvitation).set({ consumedAt: now })
      .where(and(eq(hestiaInvitation.id, invitation.id), isNull(hestiaInvitation.consumedAt), gt(hestiaInvitation.expiresAt, now))).returning({ id: hestiaInvitation.id });
    if (!consumed.length) throw new InvitationError('INVALID_INVITATION');
    try {
      await tx.insert(hestiaAuthUser).values({ id: userId, name: input.name, email: invitation.email, emailVerified: false });
      // Matches Better Auth credential-account contract; hash uses its official scrypt implementation.
      await tx.insert(hestiaAuthAccount).values({ id: randomUUID(), accountId: userId, providerId: 'credential', userId, password: passwordHash });
    } catch (error) {
      // Drizzle wraps the driver error in `cause`.
      if ((error as { cause?: { code?: string } }).cause?.code === '23505') throw new InvitationError('ACCOUNT_EXISTS');
      throw error;
    }
    // New accounts created through a still-valid legacy invitation are new users too.
    // Existing identities are never backfilled, and invitation/grant commit atomically.
    await issueRegistrationGrant(client, userId);
    await ensurePersonalWorkspace(client, userId);
    await tx.update(hestiaInvitation).set({ userId }).where(eq(hestiaInvitation.id, invitation.id));
    return { userId, email: invitation.email };
  });
}
