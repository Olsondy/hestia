import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import type { PoolClient } from 'pg';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { createRenderSchema, type RenderView, type RenderSource } from '../../contracts/src/renders';
import { DomainError, idSchema, spatialStateSchema, type SpatialState } from '../../contracts/src/project';
import type { SceneSnapshot } from '../../contracts/src/scene';
import { toScene, type Principal } from '../../projects/src/service';
import { canAccessProject } from '../../workspaces/src/access';
import { advisoryXactLock, db, orm, pool, transaction, type Database } from '../../persistence/src/client';
import { candidates, operations, projectRenders, projects, resources } from '../../persistence/src/schema';
import { privateStore, type PrivateFileStore } from '../../files/src/storage';
import { enqueueRender } from './queue';
import { hash, bytesHash, renderVersions } from './versions';
import { artifactLabel } from './label';

export type RenderRow = typeof projectRenders.$inferSelect & { source: RenderSource; snapshot: SceneSnapshot; scale: RenderView['scale'];
  status: RenderView['status']; error: RenderView['error'] };
type JoinedRender = { render: RenderRow; currentProjectRevision: number; currentCandidateRevision: number | null };
const notFound = () => new DomainError('NOT_FOUND', '项目或静态成果不存在。', 404);
function owner(principal: Principal) {
  if (!principal.userId) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  return principal.userId;
}
function view({ render: row, currentProjectRevision: revision, currentCandidateRevision }: JoinedRender): RenderView {
  const completed = row.status === 'completed';
  const stale = row.source.projectRevision !== revision || (row.source.kind === 'candidate' && currentCandidateRevision !== row.source.revision);
  const href = `/api/projects/${row.projectId}/renders/${row.id}/content`;
  return { id: row.id, projectId: row.projectId, status: row.status, source: row.source,
    snapshotHash: row.snapshotHash, assetVersion: row.assetVersion, rendererVersion: row.rendererVersion,
    synthetic: row.synthetic, scale: row.scale, concept: row.concept, label: row.label, stale,
    currentProjectRevision: revision, currentCandidateRevision,
    resourceId: completed ? row.resourceId : null, contentHref: completed ? href : null, downloadHref: completed ? `${href}?download=1` : null,
    width: row.width, height: row.height, imageHash: row.imageHash, error: row.error,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
/** Render with the current project and (for candidate sources) candidate revisions, for staleness. */
const joined = (q: Database) => q.select({ render: projectRenders, currentProjectRevision: projects.revision, currentCandidateRevision: candidates.revision })
  .from(projectRenders).innerJoin(projects, eq(projects.id, projectRenders.projectId))
  .leftJoin(candidates, and(eq(candidates.id, sql`(${projectRenders.source}->>'candidateId')::uuid`), eq(candidates.projectId, projectRenders.projectId)));
const views = (rows: { render: typeof projectRenders.$inferSelect; currentProjectRevision: number; currentCandidateRevision: number | null }[]) =>
  rows.map(row => view(row as JoinedRender));
export async function createRender(principal: Principal, projectId: string, input: unknown, queue?: PgBoss) {
  const userId = owner(principal), id = idSchema.parse(projectId), request = createRenderSchema.parse(input);
  const requestHash = hash({ kind: 'static-render', projectId: id, ...request }), versions = await renderVersions();
  const renderId = await transaction(async (client, tx) => {
    await advisoryXactLock(tx, `${userId}:${request.operationId}`);
    const [project] = await tx.select({ revision: projects.revision, snapshot: projects.snapshot }).from(projects)
      .where(and(eq(projects.id, id), canAccessProject(projects.id, userId))).for('update');
    if (!project) throw notFound();
    const [previous] = await tx.select({ requestHash: operations.requestHash, result: operations.result }).from(operations)
      .where(and(eq(operations.actorId, userId), eq(operations.id, request.operationId)));
    if (previous) {
      if (previous.requestHash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409);
      return (previous.result as { renderId: string }).renderId;
    }
    let state = spatialStateSchema.parse(project.snapshot), projectRevision = project.revision;
    if (request.source.kind === 'current') {
      if (project.revision !== request.source.revision) throw new DomainError('REVISION_CONFLICT', '当前方案已更新，请重新选择版本。', 409);
    } else {
      const [candidate] = await tx.select({ revision: candidates.revision, baseRevision: candidates.baseRevision, baseState: candidates.baseState,
        visualStyle: candidates.visualStyle, objects: candidates.objects }).from(candidates)
        .where(and(eq(candidates.id, request.source.candidateId), eq(candidates.projectId, id))).for('share');
      if (!candidate) throw notFound();
      if (candidate.revision !== request.source.revision) throw new DomainError('CANDIDATE_REVISION_CONFLICT', '候选已有新版本，请重新选择。', 409);
      const base = spatialStateSchema.parse(candidate.baseState);
      state = spatialStateSchema.parse({ ...base, visualStyle: candidate.visualStyle ?? base.visualStyle, currentLayout: { ...base.currentLayout, objects: candidate.objects } });
      projectRevision = candidate.baseRevision;
    }
    const source: RenderSource = { ...request.source, projectRevision, fixedFactsId: state.fixedFacts.id, fixedFactsRevision: state.fixedFacts.revision };
    const label = artifactLabel(source, state.scale, state.synthetic), scene = toScene(state, label);
    if (!scene.rooms.length) throw new DomainError('EMPTY_SCENE', '空间尚无可展示的轮廓，请先建立空间。');
    const snapshotHash = hash({ scene, source, scale: state.scale, synthetic: state.synthetic }), renderId = randomUUID();
    await tx.insert(projectRenders).values({ id: renderId, actorId: userId, projectId: id, requestId: request.operationId, requestHash, source,
      snapshot: scene, snapshotHash, assetVersion: versions.assetVersion, rendererVersion: versions.rendererVersion, scale: state.scale,
      synthetic: state.synthetic, concept: !['calibrated', 'synthetic'].includes(state.scale), label, status: 'queued' });
    await tx.insert(operations).values({ actorId: userId, id: request.operationId, projectId: id, requestHash, result: { kind: 'static-render', renderId } });
    await enqueueRender(client, renderId, queue);
    return renderId;
  });
  return getRender(principal, id, renderId);
}
/**
 * Internal: queue a render of a customer tiling scheme inside the caller's transaction. The caller has already
 * authorised the request; the frozen snapshot is the project state with the scheme's surface design.
 */
export async function enqueueSchemeRender(client: PoolClient, input: { projectId: string; actorId: string; projectRevision: number;
  state: SpatialState; scheme: { schemeId: string; revision: number }; label: string }, queue?: PgBoss) {
  const versions = await renderVersions(), state = input.state;
  const source: RenderSource = { kind: 'scheme', ...input.scheme, projectRevision: input.projectRevision, fixedFactsId: state.fixedFacts.id, fixedFactsRevision: state.fixedFacts.revision };
  const label = `${input.label}　|　${artifactLabel(source, state.scale, state.synthetic).split('　|　')[1]}`, scene = toScene(state, label);
  const snapshotHash = hash({ scene, source, scale: state.scale, synthetic: state.synthetic }), renderId = randomUUID(), requestId = randomUUID();
  await orm(client).insert(projectRenders).values({ id: renderId, actorId: input.actorId, projectId: input.projectId, requestId,
    requestHash: hash({ kind: 'scheme-render', ...input.scheme, snapshotHash }), source, snapshot: scene, snapshotHash,
    assetVersion: versions.assetVersion, rendererVersion: versions.rendererVersion, scale: state.scale, synthetic: state.synthetic,
    concept: !['calibrated', 'synthetic'].includes(state.scale), label, status: 'queued' });
  await enqueueRender(client, renderId, queue);
  return renderId;
}
/** Internal status of renders the caller is already authorised to see (by project). */
export async function renderStatuses(projectId: string, renderIds: string[], client: Pick<PoolClient, 'query'> = pool) {
  if (!renderIds.length) return new Map<string, RenderView>();
  const rows = await joined(orm(client as PoolClient)).where(and(eq(projectRenders.projectId, projectId), inArray(projectRenders.id, renderIds)));
  return new Map(views(rows).map(row => [row.id, row]));
}
/** Internal image bytes for an authorised caller; digest checked as in readRender. */
export async function readRenderImage(projectId: string, renderId: string, store: PrivateFileStore = privateStore()) {
  const result = (await renderStatuses(projectId, [renderId])).get(renderId);
  if (!result) throw notFound();
  if (result.status !== 'completed') throw new DomainError('OUTPUT_NOT_READY', '效果图尚未完成。', 409);
  const [resource] = await db.select({ objectKey: resources.objectKey }).from(resources)
    .where(and(eq(resources.id, result.resourceId!), eq(resources.projectId, projectId), eq(resources.state, 'ready')));
  if (!resource) throw new DomainError('OUTPUT_UNAVAILABLE', '效果图暂时不可用。', 503);
  try {
    const bytes = await store.read(resource.objectKey);
    if (bytesHash(bytes) !== result.imageHash) throw new Error('Image digest mismatch');
    return bytes;
  } catch { throw new DomainError('OUTPUT_UNAVAILABLE', '效果图暂时不可用，请稍后重试。', 503); }
}
export async function getRender(principal: Principal, projectId: string, renderId: string) {
  const [row] = views(await joined(db).where(and(eq(projectRenders.id, idSchema.parse(renderId)), eq(projectRenders.projectId, idSchema.parse(projectId)),
    canAccessProject(projectRenders.projectId, owner(principal)))));
  if (!row) throw notFound(); return row;
}
export async function listRenders(principal: Principal, projectId: string) {
  const id = idSchema.parse(projectId), userId = owner(principal);
  if (!(await db.select({ one: sql`1` }).from(projects).where(and(eq(projects.id, id), canAccessProject(projects.id, userId)))).length) throw notFound();
  return views(await joined(db).where(eq(projectRenders.projectId, id)).orderBy(desc(projectRenders.createdAt)).limit(20));
}
export async function readRender(principal: Principal, projectId: string, renderId: string, store: PrivateFileStore = privateStore()) {
  const result = await getRender(principal, projectId, renderId);
  if (result.status !== 'completed') throw new DomainError('OUTPUT_NOT_READY', '静态成果尚未完成。', 409);
  const [resource] = await db.select({ objectKey: resources.objectKey }).from(resources)
    .where(and(eq(resources.id, result.resourceId!), eq(resources.projectId, projectId), eq(resources.state, 'ready')));
  if (!resource) throw new DomainError('OUTPUT_UNAVAILABLE', '成果文件暂时不可用。', 503);
  try {
    const bytes = await store.read(resource.objectKey);
    if (bytesHash(bytes) !== result.imageHash) throw new Error('Image digest mismatch');
    return bytes;
  } catch { throw new DomainError('OUTPUT_UNAVAILABLE', '成果文件暂时不可用，请稍后重试。', 503); }
}
