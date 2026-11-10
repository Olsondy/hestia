import type { PoolClient } from 'pg';
import { and, eq } from 'drizzle-orm';
import { orm } from '../../persistence/src/client';
import { hestiaAuthUser, workspaceCustomers, workspaces, workspaceTypes } from '../../persistence/src/schema';
import { DomainError } from '../../contracts/src/project';
import { workspaceSlugSchema } from '../../contracts/src/workspaces';

export type CustomerEntry = { id: string; slug: string; name: string };

/** The workspace behind an H5 entry path. Only workspace types with `customer_entry` have one. */
export async function customerEntry(client: PoolClient, slug: unknown): Promise<CustomerEntry> {
  const parsed = workspaceSlugSchema.safeParse(slug);
  const [row] = parsed.success ? await orm(client).select({ id: workspaces.id, slug: workspaces.slug, name: workspaces.name }).from(workspaces)
    .innerJoin(workspaceTypes, eq(workspaceTypes.kind, workspaces.kind)).where(and(eq(workspaces.slug, parsed.data), eq(workspaceTypes.customerEntry, true))) : [];
  if (!row) throw new DomainError('ENTRY_NOT_FOUND', '没有找到这个企业入口，请确认链接。', 404);
  return { ...row, slug: row.slug! };
}

/**
 * Records that the account entered through this workspace's entry. Idempotent. A customer relation is not
 * a membership: it adds no project_access row and no workspace capability accepts it.
 */
export async function ensureCustomer(client: PoolClient, workspaceId: string, userId: string): Promise<{ created: boolean }> {
  // A customer account of another enterprise (ADR-0017) is not signed in here, whatever host it arrived on.
  const [account] = await orm(client).select({ workspaceId: hestiaAuthUser.workspaceId }).from(hestiaAuthUser).where(eq(hestiaAuthUser.id, userId));
  if (account?.workspaceId && account.workspaceId !== workspaceId) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  const inserted = await orm(client).insert(workspaceCustomers).values({ workspaceId, userId }).onConflictDoNothing();
  return { created: inserted.rowCount === 1 };
}
