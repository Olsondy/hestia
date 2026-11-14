import { desc, eq, sql } from 'drizzle-orm';
import { db, transaction } from '../../persistence/src/client';
import { hestiaAuthUser, platformAdmins, platformAudit } from '../../persistence/src/schema';
import { DomainError } from '../../contracts/src/project';

// Platform administrators (ADR-0018). Grants come only from the server command; every change is audited.
export type AdminLevel = 'platform' | 'super';
const serverCommand = 'server command';

async function accountOf(email: string) {
  const [row] = await db.select({ id: hestiaAuthUser.id, email: hestiaAuthUser.email }).from(hestiaAuthUser)
    .where(eq(hestiaAuthUser.email, email.trim().toLowerCase()));
  if (!row?.email) throw new DomainError('NOT_FOUND', `没有邮箱为「${email}」的账号，请先邀请并完成注册。`, 404);
  return { id: row.id, email: row.email };
}

type Audit = { actorUserId?: string | null; actor: string; action: string; target: string; detail?: Record<string, unknown> };
type Tx = Parameters<Parameters<typeof transaction>[0]>[1];
export async function recordAudit(entry: Audit, tx: Tx | typeof db = db) {
  await tx.insert(platformAudit).values({ actorUserId: entry.actorUserId ?? null, actor: entry.actor, action: entry.action, target: entry.target, detail: entry.detail ?? {} });
}

/** Idempotent; granting another level changes it. */
export async function grantPlatformAdmin(email: string, level: AdminLevel) {
  const account = await accountOf(email);
  return transaction(async (_client, tx) => {
    const [current] = await tx.select({ level: platformAdmins.level }).from(platformAdmins).where(eq(platformAdmins.userId, account.id)).for('update');
    if (current?.level === level) return { email: account.email, level, changed: false };
    await tx.insert(platformAdmins).values({ userId: account.id, level, grantedVia: serverCommand })
      .onConflictDoUpdate({ target: platformAdmins.userId, set: { level, grantedAt: sql`now()`, grantedVia: serverCommand } });
    await recordAudit({ actor: serverCommand, action: 'grant', target: account.email, detail: { level, previous: current?.level ?? null } }, tx);
    return { email: account.email, level, changed: true };
  });
}

export async function revokePlatformAdmin(email: string) {
  const account = await accountOf(email);
  return transaction(async (_client, tx) => {
    const removed = await tx.delete(platformAdmins).where(eq(platformAdmins.userId, account.id)).returning({ level: platformAdmins.level });
    if (removed.length) await recordAudit({ actor: serverCommand, action: 'revoke', target: account.email, detail: { previous: removed[0].level } }, tx);
    return { email: account.email, revoked: removed.length > 0 };
  });
}

export async function listPlatformAdmins() {
  return db.select({ email: hestiaAuthUser.email, name: hestiaAuthUser.name, level: platformAdmins.level, grantedAt: platformAdmins.grantedAt })
    .from(platformAdmins).innerJoin(hestiaAuthUser, eq(hestiaAuthUser.id, platformAdmins.userId)).orderBy(hestiaAuthUser.email);
}

/** Read on every request, so a revoke takes effect on the next one. */
export async function platformAdminOf(userId: string): Promise<AdminLevel | null> {
  const [row] = await db.select({ level: platformAdmins.level }).from(platformAdmins).where(eq(platformAdmins.userId, userId));
  return row?.level ?? null;
}

export async function listAudit({ limit = 100 }: { limit?: number } = {}) {
  return db.select({ at: platformAudit.at, actor: platformAudit.actor, action: platformAudit.action, target: platformAudit.target, detail: platformAudit.detail })
    .from(platformAudit).orderBy(desc(platformAudit.at), desc(platformAudit.id)).limit(Math.min(Math.max(1, limit), 500));
}
