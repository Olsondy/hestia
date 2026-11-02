import type { Pool, PoolClient } from 'pg';
import { and, asc, eq } from 'drizzle-orm';
import { orm } from '../../persistence/src/client';
import { projects, workspaceStones as stones } from '../../persistence/src/schema';
import { DomainError } from '../../contracts/src/project';
import { stoneSpecSchema, type StoneReference, type StoneSpec } from '../../contracts/src/finishes';
import type { CatalogStatus } from './plan';
import { stoneKey } from './plan';

// Workspace-private stone catalog (石材目录). Enterprise imagery never enters the repository; demo stones are
// procedural illustrations seeded explicitly into a workspace.

export type StoneCatalog = { lookup: (ref: StoneReference) => CatalogStatus; list: StoneSpec[] };
export async function stoneCatalog(client: PoolClient, projectId: string): Promise<StoneCatalog> {
  const rows = await orm(client).select({ stoneId: stones.stoneId, version: stones.version, status: stones.status, spec: stones.spec })
    .from(stones).innerJoin(projects, eq(projects.workspaceId, stones.workspaceId)).where(eq(projects.id, projectId));
  const entries = new Map(rows.map(row => [`${row.stoneId}@${row.version}`, { status: row.status, spec: stoneSpecSchema.parse(row.spec) }]));
  return { lookup: ref => entries.get(stoneKey(ref)), list: [...entries.values()].filter(entry => entry.status === 'active').map(entry => entry.spec) };
}
/** Active catalog version or a domain error; used when a command picks a stone. */
export function activeStone(catalog: StoneCatalog, ref: StoneReference) {
  const entry = catalog.lookup(ref);
  if (!entry) throw new DomainError('STONE_NOT_FOUND', `石材 ${stoneKey(ref)} 不在工作空间石材目录中。`, 404);
  if (entry.status === 'retired') throw new DomainError('STONE_VERSION_RETIRED', `石材 ${stoneKey(ref)} 的目录版本已失效，请换用当前版本。`, 409);
  return entry.spec;
}
/** Idempotent upsert of catalog versions. An existing version keeps its spec: versions are immutable. */
export async function addStones(client: PoolClient, workspaceId: string, specs: StoneSpec[]) {
  const values = specs.map(item => stoneSpecSchema.parse(item)).map(stone => ({ workspaceId, stoneId: stone.id, version: stone.version, spec: stone }));
  if (values.length) await orm(client).insert(stones).values(values).onConflictDoNothing();
}
export async function retireStone(client: PoolClient, workspaceId: string, ref: StoneReference) {
  await orm(client).update(stones).set({ status: 'retired' })
    .where(and(eq(stones.workspaceId, workspaceId), eq(stones.stoneId, ref.stoneId), eq(stones.version, ref.stoneVersion)));
}
/** Active stones of a workspace (customer entry and scheme generation). */
export async function workspaceStones(client: Pool | PoolClient, workspaceId: string): Promise<StoneSpec[]> {
  const rows = await orm(client).select({ spec: stones.spec }).from(stones)
    .where(and(eq(stones.workspaceId, workspaceId), eq(stones.status, 'active'))).orderBy(asc(stones.stoneId), asc(stones.version));
  return rows.map(row => stoneSpecSchema.parse(row.spec));
}
