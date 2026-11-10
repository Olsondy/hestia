import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../persistence/src/client';
import { hestiaAuthUser, workspaceCustomers, workspaceMembers } from '../../persistence/src/schema';
import { requestHost, workspaceForHost } from '../../workspaces/src/domains';
import { auth } from './auth';

// Sessions on the shared deployment (ADR-0017, M02). On a registered entry domain a session counts only for an account
// of that enterprise: its own customer account, or a platform account (members' e-mail accounts) that is a member or
// customer there. Anything else reads as signed out. Unregistered hosts are not scoped.

export type ScopedSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

export async function accountBelongs(userId: string, workspaceId: string): Promise<boolean> {
  const [row] = await db.select({ one: sql`1` }).from(hestiaAuthUser).where(and(eq(hestiaAuthUser.id, userId), or(
    eq(hestiaAuthUser.workspaceId, workspaceId),
    and(isNull(hestiaAuthUser.workspaceId), or(
      sql`EXISTS (SELECT 1 FROM ${workspaceMembers} WHERE ${workspaceMembers.workspaceId} = ${workspaceId} AND ${workspaceMembers.userId} = ${userId})`,
      sql`EXISTS (SELECT 1 FROM ${workspaceCustomers} WHERE ${workspaceCustomers.workspaceId} = ${workspaceId} AND ${workspaceCustomers.userId} = ${userId})`)))));
  return !!row;
}

export async function sessionFor(headers: Headers): Promise<ScopedSession | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const host = await workspaceForHost(requestHost(headers));
  return !host || await accountBelongs(session.user.id, host.id) ? session : null;
}
