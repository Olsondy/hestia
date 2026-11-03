import type { Pool, PoolClient } from 'pg';
import { and, asc, eq, sql } from 'drizzle-orm';
import { orm } from '../../persistence/src/client';
import { workspaceSoftStyles as styles } from '../../persistence/src/schema';
import { DomainError } from '../../contracts/src/project';
import { softStyleSchema, type SoftStyle, type SoftStyleReference } from '../../contracts/src/soft-styles';

// 软装风格目录（K01）：工作空间私有，版本不可变；下架的版本不再出现在可选列表，已用它的方案按原版本保留。

/** Idempotent: an existing version keeps its spec (versions are immutable). */
export async function addSoftStyles(client: PoolClient, workspaceId: string, specs: SoftStyle[]) {
  // One row at a time with the wall clock, so catalogue order (A, B, C …) follows the order given here.
  for (const style of specs.map(spec => softStyleSchema.parse(spec)))
    await orm(client).insert(styles).values({ workspaceId, styleId: style.id, version: style.version, spec: style, createdAt: sql`clock_timestamp()` }).onConflictDoNothing();
}
export async function retireSoftStyle(client: PoolClient, workspaceId: string, ref: SoftStyleReference) {
  await orm(client).update(styles).set({ status: 'retired' })
    .where(and(eq(styles.workspaceId, workspaceId), eq(styles.styleId, ref.styleId), eq(styles.version, ref.styleVersion)));
}
/** Active styles of a workspace, for scheme generation and the customer's choices. */
export async function workspaceSoftStyles(client: Pool | PoolClient, workspaceId: string): Promise<SoftStyle[]> {
  const rows = await orm(client).select({ spec: styles.spec }).from(styles)
    .where(and(eq(styles.workspaceId, workspaceId), eq(styles.status, 'active'))).orderBy(asc(styles.createdAt), asc(styles.styleId), asc(styles.version));
  return rows.map(row => softStyleSchema.parse(row.spec));
}
/** All versions with status, for the members' catalogue (W05). */
export async function softStyleCatalog(client: Pool | PoolClient, workspaceId: string) {
  const rows = await orm(client).select({ status: styles.status, spec: styles.spec, createdAt: styles.createdAt }).from(styles)
    .where(eq(styles.workspaceId, workspaceId)).orderBy(asc(styles.createdAt), asc(styles.styleId), asc(styles.version));
  return rows.map(row => ({ status: row.status, style: softStyleSchema.parse(row.spec) }));
}
/** A specific version (retired ones included, so existing schemes keep rendering), or 404. */
export async function softStyleVersion(client: Pool | PoolClient, workspaceId: string, ref: SoftStyleReference) {
  const [row] = await orm(client).select({ status: styles.status, spec: styles.spec }).from(styles)
    .where(and(eq(styles.workspaceId, workspaceId), eq(styles.styleId, ref.styleId), eq(styles.version, ref.styleVersion)));
  if (!row) throw new DomainError('SOFT_STYLE_NOT_FOUND', `软装风格 ${ref.styleId}@${ref.styleVersion} 不在工作空间目录中。`, 404);
  return { status: row.status, style: softStyleSchema.parse(row.spec) };
}
