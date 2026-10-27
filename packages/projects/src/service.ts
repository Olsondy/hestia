import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { pool, transaction } from '../../persistence/src/client';
import { courtyard, angled } from '../../scene-runtime/src/fixtures';
import { sceneSnapshotSchema, type SceneSnapshot } from '../../scene-runtime/src/snapshot';
import { createProjectSchema, renameProjectSchema, idSchema, spatialStateSchema, DomainError,
  type SpatialState, type ProjectView, type ProjectSummary } from '../../contracts/src/project';

import { actingWorkspace } from '../../workspaces/src/service';
import { projectAccess, type Principal } from '../../workspaces/src/access';
export type { Principal } from '../../workspaces/src/access';
const notFound = () => new DomainError('NOT_FOUND', '项目或资源不存在。', 404);
function identity(principal: Principal) {
  if (!principal.userId) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  return principal.userId;
}
function initialState(template: 'empty' | 'courtyard' | 'angled'): SpatialState {
  const scene: SceneSnapshot = template === 'empty'
    ? { version: 1, unit: 'm', plane: 'xz', label: '空白空间', synthetic: false, rooms: [], walls: [], objects: [] }
    : structuredClone(template === 'courtyard' ? courtyard : angled);
  const factsId = randomUUID();
  return spatialStateSchema.parse({ version: 1, synthetic: scene.synthetic, scale: scene.synthetic ? 'synthetic' : 'missing',
    fixedFacts: { id: factsId, revision: 1, rooms: scene.rooms, walls: scene.walls, objects: scene.objects.filter(o => o.kind === 'fixed'),
      openingClearances: scene.synthetic ? scene.walls.flatMap(w => w.openings.filter(o => o.sill === 0).map(o => ({ openingId: o.id, kind: 'swing' as const, hinge: 'start' as const, side: 1 as const, angle: Math.PI / 2 }))) : [] },
    currentLayout: { id: randomUUID(), revision: 1, fixedFactsId: factsId, fixedFactsRevision: 1, objects: scene.objects.filter(o => o.kind === 'furniture') },
  });
}
export function toScene(state: SpatialState, label: string): SceneSnapshot {
  return sceneSnapshotSchema.parse({ version: 1, unit: 'm', plane: 'xz', label, synthetic: state.synthetic,
    ...(state.visualStyle ? { visualStyle: state.visualStyle } : {}),
    rooms: state.fixedFacts.rooms, walls: state.fixedFacts.walls,
    objects: [...state.fixedFacts.objects, ...state.currentLayout.objects],
  });
}
/** Projects of the acting workspace (personal unless the principal names another workspace it belongs to). */
export async function listProjects(principal: Principal): Promise<ProjectSummary[]> {
  identity(principal);
  const rows = await transaction(async client => (await client.query('SELECT id,name,revision,snapshot,updated_at FROM projects WHERE workspace_id=$1 ORDER BY updated_at DESC',
    [await actingWorkspace(client, principal)])).rows);
  return rows.map(row => ({ id: row.id, name: row.name, revision: row.revision,
    synthetic: spatialStateSchema.parse(row.snapshot).synthetic, updatedAt: row.updated_at.toISOString() }));
}
export async function getProject(principal: Principal, projectId: string): Promise<ProjectView> {
  const id = idSchema.parse(projectId);
  const row = (await pool.query(`SELECT name,revision,snapshot,updated_at FROM projects p WHERE p.id=$1 AND ${projectAccess('p.id', '$2')}`, [id, identity(principal)])).rows[0];
  if (!row) throw notFound();
  const state = spatialStateSchema.parse(row.snapshot);
  const files = (await pool.query('SELECT id,project_id AS "projectId",media_type AS "mediaType",state FROM resources WHERE project_id=$1', [id])).rows;
  return { id, name: row.name, revision: row.revision, updatedAt: row.updated_at.toISOString(), synthetic: state.synthetic,
    scale: state.scale, scene: toScene(state, row.name), fixedFacts: { id: state.fixedFacts.id, revision: state.fixedFacts.revision },
    currentLayout: { id: state.currentLayout.id, revision: state.currentLayout.revision },
    lockedObjectIds: state.currentLayout.lockedObjectIds,
    resources: files as ProjectView['resources'],
  };
}
export async function createProject(principal: Principal, input: unknown): Promise<ProjectView> {
  const value = createProjectSchema.parse(input), actorId = identity(principal);
  const hash = createHash('sha256').update(JSON.stringify({ kind: 'create', ...value })).digest('hex');
  const result = await transaction(async client => {
    // Same-actor retries serialize even before a project exists. No process-local mutex.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${actorId}:${value.operationId}`]);
    const previous = await client.query('SELECT request_hash,result FROM operations WHERE actor_id=$1 AND id=$2', [actorId, value.operationId]);
    if (previous.rowCount) {
      if (previous.rows[0].request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409);
      return previous.rows[0].result as { projectId: string };
    }
    const projectId = randomUUID(), state = initialState(value.template), workspaceId = await actingWorkspace(client, principal);
    await client.query('INSERT INTO projects(id,workspace_id,created_by,name,revision,snapshot) VALUES($1,$2,$3,$4,1,$5)', [projectId, workspaceId, actorId, value.name, state]);
    await client.query('INSERT INTO project_revisions(project_id,revision,snapshot,operation_id) VALUES($1,1,$2,$3)', [projectId, state, value.operationId]);
    const saved = { projectId };
    await client.query('INSERT INTO operations(actor_id,id,project_id,request_hash,result) VALUES($1,$2,$3,$4,$5)', [actorId, value.operationId, projectId, hash, saved]);
    return saved;
  });
  return getProject(principal, result.projectId);
}
export async function renameProject(principal: Principal, projectId: string, input: unknown): Promise<ProjectView> {
  const value = renameProjectSchema.parse(input), actorId = identity(principal), id = idSchema.parse(projectId);
  const hash = createHash('sha256').update(JSON.stringify({ kind: 'rename', projectId: id, ...value })).digest('hex');
  await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${actorId}:${value.operationId}`]);
    const row = (await client.query(`SELECT * FROM projects p WHERE p.id=$1 AND ${projectAccess('p.id', '$2')} FOR UPDATE`, [id, actorId])).rows[0];
    if (!row) throw notFound();
    const previous = (await client.query('SELECT request_hash FROM operations WHERE actor_id=$1 AND id=$2', [actorId, value.operationId])).rows[0];
    if (previous) {
      if (previous.request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409);
      return;
    }
    if (row.revision !== value.expectedRevision) throw new DomainError('REVISION_CONFLICT', '项目已更新，请重新打开后再试。', 409);
    const revision = row.revision + 1;
    await client.query('UPDATE projects SET name=$1,revision=$2,updated_at=now() WHERE id=$3', [value.name, revision, id]);
    await client.query('INSERT INTO project_revisions(project_id,revision,snapshot,operation_id) VALUES($1,$2,$3,$4)', [id, revision, row.snapshot, value.operationId]);
    await client.query('INSERT INTO operations(actor_id,id,project_id,request_hash,result) VALUES($1,$2,$3,$4,$5)', [actorId, value.operationId, id, hash, { projectId: id, revision }]);
  });
  return getProject(principal, id);
}
/** Every resource consumer supplies its project scope, including workers and direct downloads. */
export async function getResource(principal: Principal, projectId: string, resourceId: string) {
  const result = await pool.query(`SELECT r.* FROM resources r WHERE r.id=$1 AND r.project_id=$2 AND ${projectAccess('r.project_id', '$3')}`,
    [idSchema.parse(resourceId), idSchema.parse(projectId), identity(principal)]);
  if (!result.rowCount) throw notFound();
  return result.rows[0] as { id: string; project_id: string; object_key: string; media_type: string; state: string };
}
/** Reserve a project-owned private resource. Only the upload adapter can mark it ready. */
export async function reserveResource(principal: Principal, projectId: string, input: unknown) {
  const value = z.object({ id: idSchema, mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']) }).strict().parse(input);
  const actorId = identity(principal), id = idSchema.parse(projectId);
  return transaction(async client => {
    const project = await client.query(`SELECT id FROM projects p WHERE p.id=$1 AND ${projectAccess('p.id', '$2')} FOR SHARE`, [id, actorId]);
    if (!project.rowCount) throw notFound();
    await client.query('INSERT INTO resources(id,project_id,object_key,media_type,state) VALUES($1,$2,$3,$4,\'pending\') ON CONFLICT(id) DO NOTHING',
      [value.id, id, `${id}/${randomUUID()}`, value.mediaType]);
    const resource = (await client.query('SELECT id,project_id,media_type,state FROM resources WHERE id=$1 AND project_id=$2', [value.id, id])).rows[0];
    if (!resource) throw notFound();
    if (resource.media_type !== value.mediaType) throw new DomainError('IDEMPOTENCY_CONFLICT', '资源标识已用于另一文件类型。', 409);
    return { id: resource.id, projectId: id, mediaType: resource.media_type, state: resource.state };
  });
}
