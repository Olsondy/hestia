import type { PoolClient } from 'pg';
import { DomainError } from '../../contracts/src/project';
import { stoneSpecSchema, type StoneReference, type StoneSpec } from '../../contracts/src/finishes';
import type { CatalogStatus } from './plan';
import { stoneKey } from './plan';

// Workspace-private stone catalog (石材目录). Enterprise imagery never enters the repository; demo stones are
// procedural illustrations seeded explicitly into a workspace.

export type StoneCatalog = { lookup: (ref: StoneReference) => CatalogStatus; list: StoneSpec[] };
export async function stoneCatalog(client: PoolClient, projectId: string): Promise<StoneCatalog> {
  const rows = (await client.query<{ stone_id: string; version: number; status: 'active' | 'retired'; spec: unknown }>(
    'SELECT s.stone_id,s.version,s.status,s.spec FROM workspace_stones s JOIN projects p ON p.workspace_id=s.workspace_id WHERE p.id=$1', [projectId])).rows;
  const entries = new Map(rows.map(row => [`${row.stone_id}@${row.version}`, { status: row.status, spec: stoneSpecSchema.parse(row.spec) }]));
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
export async function addStones(client: PoolClient, workspaceId: string, stones: StoneSpec[]) {
  for (const stone of stones.map(item => stoneSpecSchema.parse(item)))
    await client.query('INSERT INTO workspace_stones(workspace_id,stone_id,version,spec) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [workspaceId, stone.id, stone.version, stone]);
}
export async function retireStone(client: PoolClient, workspaceId: string, ref: StoneReference) {
  await client.query("UPDATE workspace_stones SET status='retired' WHERE workspace_id=$1 AND stone_id=$2 AND version=$3", [workspaceId, ref.stoneId, ref.stoneVersion]);
}
/** Active stones of a workspace (customer entry and scheme generation). */
export async function workspaceStones(client: Pick<PoolClient, 'query'>, workspaceId: string): Promise<StoneSpec[]> {
  const rows = (await client.query<{ spec: unknown }>("SELECT spec FROM workspace_stones WHERE workspace_id=$1 AND status='active' ORDER BY stone_id,version", [workspaceId])).rows;
  return rows.map(row => stoneSpecSchema.parse(row.spec));
}
