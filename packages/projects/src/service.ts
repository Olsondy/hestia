import type { PoolClient } from 'pg';
import { and, desc, eq, sql } from 'drizzle-orm';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { advisoryXactLock, db, orm, transaction, type Database } from '../../persistence/src/client';
import { operations, projectRevisions, projects, resources } from '../../persistence/src/schema';
import { courtyard, angled } from '../../scene-runtime/src/fixtures';
import { sceneSnapshotSchema, type SceneSnapshot } from '../../scene-runtime/src/snapshot';
import { createProjectSchema, renameProjectSchema, idSchema, spatialStateSchema, DomainError, buildingFacts, finishFacts,
  type SpatialState, type ProjectView, type ProjectSummary } from '../../contracts/src/project';

import { demoVillaScene } from '../../finishes/src/demo-villa-scene';
import { actingWorkspace } from '../../workspaces/src/service';
import { canAccessProject, type Principal } from '../../workspaces/src/access';
export type { Principal } from '../../workspaces/src/access';
const notFound = () => new DomainError('NOT_FOUND', '项目或资源不存在。', 404);
function identity(principal: Principal) {
  if (!principal.userId) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  return principal.userId;
}
function initialState(template: 'empty' | 'courtyard' | 'angled' | 'demo-villa'): SpatialState {
  const scene: SceneSnapshot = template === 'empty'
    ? { version: 1, unit: 'm', plane: 'xz', label: '空白空间', synthetic: false, rooms: [], walls: [], objects: [] }
    : template === 'demo-villa'
      // Demo villa (演示数据): furniture is ambient staging that customers cannot move, so it is kept as fixed facts.
      ? (villa => ({ ...villa, objects: villa.objects.map(object => ({ ...object, kind: 'fixed' as const })) }))(demoVillaScene())
      : structuredClone(template === 'courtyard' ? courtyard : angled);
  return stateFromScene(scene);
}
/** Initial project state from a scene. `scale` defaults to synthetic for synthetic scenes and missing otherwise. */
export function stateFromScene(scene: SceneSnapshot, scale?: SpatialState['scale']): SpatialState {
  const factsId = randomUUID();
  return spatialStateSchema.parse({ version: 1, synthetic: scene.synthetic, scale: scale ?? (scene.synthetic ? 'synthetic' : 'missing'),
    ...(scene.surfaceDesign ? { surfaceDesign: scene.surfaceDesign } : {}),
    fixedFacts: { id: factsId, revision: 1, rooms: scene.rooms, walls: scene.walls, ...buildingFacts(scene), ...(scene.finishes ? { finishes: scene.finishes } : {}),
      objects: scene.objects.filter(o => o.kind === 'fixed'),
      openingClearances: scene.synthetic ? scene.walls.flatMap(w => w.openings.filter(o => o.sill === 0).map(o => ({ openingId: o.id, kind: 'swing' as const, hinge: 'start' as const, side: 1 as const, angle: Math.PI / 2 }))) : [] },
    currentLayout: { id: randomUUID(), revision: 1, fixedFactsId: factsId, fixedFactsRevision: 1, objects: scene.objects.filter(o => o.kind === 'furniture') },
  });
}
export function toScene(state: SpatialState, label: string): SceneSnapshot {
  return sceneSnapshotSchema.parse({ version: 1, unit: 'm', plane: 'xz', label, synthetic: state.synthetic,
    ...(state.visualStyle ? { visualStyle: state.visualStyle } : {}),
    rooms: state.fixedFacts.rooms, walls: state.fixedFacts.walls, ...buildingFacts(state.fixedFacts), ...finishFacts(state),
    objects: [...state.fixedFacts.objects, ...state.currentLayout.objects],
  });
}
/** Projects of the acting workspace (personal unless the principal names another workspace it belongs to). */
export async function listProjects(principal: Principal): Promise<ProjectSummary[]> {
  identity(principal);
  const rows = await transaction(async (client, tx) => {
    const workspaceId = await actingWorkspace(client, principal);
    return tx.select({ id: projects.id, name: projects.name, revision: projects.revision, snapshot: projects.snapshot, updatedAt: projects.updatedAt })
      .from(projects).where(eq(projects.workspaceId, workspaceId)).orderBy(desc(projects.updatedAt));
  });
  return rows.map(row => ({ id: row.id, name: row.name, revision: row.revision,
    synthetic: spatialStateSchema.parse(row.snapshot).synthetic, updatedAt: row.updatedAt.toISOString() }));
}
export async function getProject(principal: Principal, projectId: string): Promise<ProjectView> {
  const id = idSchema.parse(projectId);
  const [row] = await db.select({ name: projects.name, revision: projects.revision, snapshot: projects.snapshot, updatedAt: projects.updatedAt })
    .from(projects).where(and(eq(projects.id, id), canAccessProject(projects.id, identity(principal))));
  if (!row) throw notFound();
  const state = spatialStateSchema.parse(row.snapshot);
  const files = await db.select({ id: resources.id, projectId: resources.projectId, mediaType: resources.mediaType, state: resources.state })
    .from(resources).where(eq(resources.projectId, id));
  return { id, name: row.name, revision: row.revision, updatedAt: row.updatedAt.toISOString(), synthetic: state.synthetic,
    scale: state.scale, scene: toScene(state, row.name), fixedFacts: { id: state.fixedFacts.id, revision: state.fixedFacts.revision },
    currentLayout: { id: state.currentLayout.id, revision: state.currentLayout.revision },
    lockedObjectIds: state.currentLayout.lockedObjectIds,
    resources: files as ProjectView['resources'],
  };
}
export { initialState };
/** Inserts a project and its first revision inside the caller's transaction (caller authorises the workspace). */
export async function insertProjectInTransaction(client: PoolClient, input: { workspaceId: string; createdBy: string; name: string; state: SpatialState; operationId: string }) {
  const projectId = randomUUID();
  await insertProject(orm(client), { ...input, projectId });
  return projectId;
}
async function insertProject(tx: Database, input: { projectId: string; workspaceId: string; createdBy: string; name: string; state: SpatialState; operationId: string }) {
  await tx.insert(projects).values({ id: input.projectId, workspaceId: input.workspaceId, createdBy: input.createdBy, name: input.name, revision: 1, snapshot: input.state });
  await tx.insert(projectRevisions).values({ projectId: input.projectId, revision: 1, snapshot: input.state, operationId: input.operationId });
}
export async function createProject(principal: Principal, input: unknown): Promise<ProjectView> {
  const value = createProjectSchema.parse(input), actorId = identity(principal);
  const hash = createHash('sha256').update(JSON.stringify({ kind: 'create', ...value })).digest('hex');
  const result = await transaction(async (client, tx) => {
    // Same-actor retries serialize even before a project exists. No process-local mutex.
    await advisoryXactLock(tx, `${actorId}:${value.operationId}`);
    const [previous] = await tx.select({ requestHash: operations.requestHash, result: operations.result })
      .from(operations).where(and(eq(operations.actorId, actorId), eq(operations.id, value.operationId)));
    if (previous) {
      if (previous.requestHash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409);
      return previous.result as { projectId: string };
    }
    const projectId = randomUUID(), state = initialState(value.template), workspaceId = await actingWorkspace(client, principal);
    await insertProject(tx, { projectId, workspaceId, createdBy: actorId, name: value.name, state, operationId: value.operationId });
    const saved = { projectId };
    await tx.insert(operations).values({ actorId, id: value.operationId, projectId, requestHash: hash, result: saved });
    return saved;
  });
  return getProject(principal, result.projectId);
}
export async function renameProject(principal: Principal, projectId: string, input: unknown): Promise<ProjectView> {
  const value = renameProjectSchema.parse(input), actorId = identity(principal), id = idSchema.parse(projectId);
  const hash = createHash('sha256').update(JSON.stringify({ kind: 'rename', projectId: id, ...value })).digest('hex');
  await transaction(async (_client, tx) => {
    await advisoryXactLock(tx, `${actorId}:${value.operationId}`);
    const [row] = await tx.select({ revision: projects.revision, snapshot: projects.snapshot }).from(projects)
      .where(and(eq(projects.id, id), canAccessProject(projects.id, actorId))).for('update');
    if (!row) throw notFound();
    const [previous] = await tx.select({ requestHash: operations.requestHash }).from(operations)
      .where(and(eq(operations.actorId, actorId), eq(operations.id, value.operationId)));
    if (previous) {
      if (previous.requestHash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409);
      return;
    }
    if (row.revision !== value.expectedRevision) throw new DomainError('REVISION_CONFLICT', '项目已更新，请重新打开后再试。', 409);
    const revision = row.revision + 1;
    await tx.update(projects).set({ name: value.name, revision, updatedAt: sql`now()` }).where(eq(projects.id, id));
    await tx.insert(projectRevisions).values({ projectId: id, revision, snapshot: row.snapshot, operationId: value.operationId });
    await tx.insert(operations).values({ actorId, id: value.operationId, projectId: id, requestHash: hash, result: { projectId: id, revision } });
  });
  return getProject(principal, id);
}
/** Every resource consumer supplies its project scope, including workers and direct downloads. */
export async function getResource(principal: Principal, projectId: string, resourceId: string) {
  const [row] = await db.select().from(resources)
    .where(and(eq(resources.id, idSchema.parse(resourceId)), eq(resources.projectId, idSchema.parse(projectId)), canAccessProject(resources.projectId, identity(principal))));
  if (!row) throw notFound();
  // Callers read the row in its column (snake_case) shape.
  return { id: row.id, project_id: row.projectId, object_key: row.objectKey, media_type: row.mediaType, state: row.state, created_at: row.createdAt };
}
/** Reserve a project-owned private resource. Only the upload adapter can mark it ready. */
export async function reserveResource(principal: Principal, projectId: string, input: unknown) {
  const value = z.object({ id: idSchema, mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']) }).strict().parse(input);
  const actorId = identity(principal), id = idSchema.parse(projectId);
  return transaction(async (_client, tx) => {
    const [project] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, id), canAccessProject(projects.id, actorId))).for('share');
    if (!project) throw notFound();
    await tx.insert(resources).values({ id: value.id, projectId: id, objectKey: `${id}/${randomUUID()}`, mediaType: value.mediaType, state: 'pending' })
      .onConflictDoNothing({ target: resources.id });
    const [resource] = await tx.select({ id: resources.id, mediaType: resources.mediaType, state: resources.state }).from(resources)
      .where(and(eq(resources.id, value.id), eq(resources.projectId, id)));
    if (!resource) throw notFound();
    if (resource.mediaType !== value.mediaType) throw new DomainError('IDEMPOTENCY_CONFLICT', '资源标识已用于另一文件类型。', 409);
    return { id: resource.id, projectId: id, mediaType: resource.mediaType, state: resource.state };
  });
}
