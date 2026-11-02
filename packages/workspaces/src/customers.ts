import type { PoolClient } from 'pg';
import { DomainError } from '../../contracts/src/project';
import { workspaceSlugSchema } from '../../contracts/src/workspaces';

export type CustomerEntry = { id: string; slug: string; name: string };

/** The workspace behind an H5 entry path. Only workspace types with `customer_entry` have one. */
export async function customerEntry(client: PoolClient, slug: unknown): Promise<CustomerEntry> {
  const parsed = workspaceSlugSchema.safeParse(slug);
  const row = parsed.success ? (await client.query<CustomerEntry>(`SELECT w.id,w.slug,w.name FROM workspaces w
    JOIN workspace_types t ON t.kind=w.kind WHERE w.slug=$1 AND t.customer_entry`, [parsed.data])).rows[0] : undefined;
  if (!row) throw new DomainError('ENTRY_NOT_FOUND', '没有找到这个企业入口，请确认链接。', 404);
  return row;
}

/**
 * Records that the account entered through this workspace's entry. Idempotent. A customer relation is not
 * a membership: it adds no project_access row and no workspace capability accepts it.
 */
export async function ensureCustomer(client: PoolClient, workspaceId: string, userId: string): Promise<{ created: boolean }> {
  const inserted = await client.query('INSERT INTO workspace_customers(workspace_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [workspaceId, userId]);
  return { created: inserted.rowCount === 1 };
}
