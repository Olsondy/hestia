import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { createRenderSchema, type RenderView, type RenderSource } from '../../contracts/src/renders';
import { DomainError, idSchema, spatialStateSchema } from '../../contracts/src/project';
import type { SceneSnapshot } from '../../contracts/src/scene';
import { toScene, type Principal } from '../../projects/src/service';
import { pool, transaction } from '../../persistence/src/client';
import { privateStore, type PrivateFileStore } from '../../files/src/storage';
import { enqueueRender } from './queue';
import { hash, bytesHash, renderVersions } from './versions';
import { artifactLabel } from './label';

export type RenderRow = {
  id: string; owner_id: string; project_id: string; source: RenderSource; snapshot: SceneSnapshot; snapshot_hash: string;
  asset_version: string; renderer_version: string; scale: RenderView['scale']; synthetic: boolean; concept: boolean; label: string;
  status: RenderView['status']; generation: number; attempts: number; lease_until: Date | null;
  resource_id: string | null; width: number | null; height: number | null; image_hash: string | null; error: RenderView['error'];
  created_at: Date; updated_at: Date; current_project_revision?: number; current_candidate_revision?: number | null;
};
const notFound = () => new DomainError('NOT_FOUND', '项目或静态成果不存在。', 404);
function owner(principal: Principal) {
  if (!principal.userId) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  return principal.userId;
}
function view(row: RenderRow): RenderView {
  const completed = row.status === 'completed', revision = row.current_project_revision!;
  const stale = row.source.projectRevision !== revision || (row.source.kind === 'candidate' && row.current_candidate_revision !== row.source.revision);
  const href = `/api/projects/${row.project_id}/renders/${row.id}/content`;
  return { id: row.id, projectId: row.project_id, status: row.status, source: row.source,
    snapshotHash: row.snapshot_hash, assetVersion: row.asset_version, rendererVersion: row.renderer_version,
    synthetic: row.synthetic, scale: row.scale, concept: row.concept, label: row.label, stale,
    currentProjectRevision: revision, currentCandidateRevision: row.current_candidate_revision ?? null,
    resourceId: completed ? row.resource_id : null, contentHref: completed ? href : null, downloadHref: completed ? `${href}?download=1` : null,
    width: row.width, height: row.height, imageHash: row.image_hash, error: row.error,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
const joined = `SELECT r.*,p.revision AS current_project_revision,c.revision AS current_candidate_revision
  FROM project_renders r JOIN projects p ON p.id=r.project_id AND p.owner_id=r.owner_id
  LEFT JOIN candidates c ON c.id=(r.source->>'candidateId')::uuid AND c.project_id=r.project_id AND c.owner_id=r.owner_id`;
export async function createRender(principal: Principal, projectId: string, input: unknown, queue?: PgBoss) {
  const userId = owner(principal), id = idSchema.parse(projectId), request = createRenderSchema.parse(input);
  const requestHash = hash({ kind: 'static-render', projectId: id, ...request }), versions = await renderVersions();
  const renderId = await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${userId}:${request.operationId}`]);
    const project = (await client.query('SELECT * FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [id, userId])).rows[0];
    if (!project) throw notFound();
    const previous = (await client.query('SELECT request_hash,result FROM operations WHERE owner_id=$1 AND id=$2', [userId, request.operationId])).rows[0];
    if (previous) {
      if (previous.request_hash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409);
      return previous.result.renderId as string;
    }
    let state = spatialStateSchema.parse(project.snapshot), projectRevision = project.revision;
    if (request.source.kind === 'current') {
      if (project.revision !== request.source.revision) throw new DomainError('REVISION_CONFLICT', '当前方案已更新，请重新选择版本。', 409);
    } else {
      const candidate = (await client.query('SELECT * FROM candidates WHERE id=$1 AND project_id=$2 AND owner_id=$3 FOR SHARE', [request.source.candidateId, id, userId])).rows[0];
      if (!candidate) throw notFound();
      if (candidate.revision !== request.source.revision) throw new DomainError('CANDIDATE_REVISION_CONFLICT', '候选已有新版本，请重新选择。', 409);
      const base = spatialStateSchema.parse(candidate.base_state);
      state = spatialStateSchema.parse({ ...base, visualStyle: candidate.visual_style ?? base.visualStyle, currentLayout: { ...base.currentLayout, objects: candidate.objects } });
      projectRevision = candidate.base_revision;
    }
    const source: RenderSource = { ...request.source, projectRevision, fixedFactsId: state.fixedFacts.id, fixedFactsRevision: state.fixedFacts.revision };
    const label = artifactLabel(source, state.scale, state.synthetic), scene = toScene(state, label);
    if (!scene.rooms.length) throw new DomainError('EMPTY_SCENE', '空间尚无可展示的轮廓，请先建立空间。');
    const snapshotHash = hash({ scene, source, scale: state.scale, synthetic: state.synthetic }), renderId = randomUUID();
    await client.query(`INSERT INTO project_renders(id,owner_id,project_id,request_id,request_hash,source,snapshot,snapshot_hash,
      asset_version,renderer_version,scale,synthetic,concept,label,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'queued')`,
      [renderId, userId, id, request.operationId, requestHash, source, scene, snapshotHash, versions.assetVersion, versions.rendererVersion,
        state.scale, state.synthetic, !['calibrated', 'synthetic'].includes(state.scale), label]);
    await client.query('INSERT INTO operations(owner_id,id,project_id,request_hash,result) VALUES($1,$2,$3,$4,$5)',
      [userId, request.operationId, id, requestHash, { kind: 'static-render', renderId }]);
    await enqueueRender(client, renderId, queue);
    return renderId;
  });
  return getRender(principal, id, renderId);
}
export async function getRender(principal: Principal, projectId: string, renderId: string) {
  const row = (await pool.query<RenderRow>(`${joined} WHERE r.id=$1 AND r.project_id=$2 AND r.owner_id=$3`,
    [idSchema.parse(renderId), idSchema.parse(projectId), owner(principal)])).rows[0];
  if (!row) throw notFound(); return view(row);
}
export async function listRenders(principal: Principal, projectId: string) {
  const id = idSchema.parse(projectId), userId = owner(principal);
  if (!(await pool.query('SELECT 1 FROM projects WHERE id=$1 AND owner_id=$2', [id, userId])).rowCount) throw notFound();
  return (await pool.query<RenderRow>(`${joined} WHERE r.project_id=$1 AND r.owner_id=$2 ORDER BY r.created_at DESC LIMIT 20`, [id, userId])).rows.map(view);
}
export async function readRender(principal: Principal, projectId: string, renderId: string, store: PrivateFileStore = privateStore()) {
  const result = await getRender(principal, projectId, renderId);
  if (result.status !== 'completed') throw new DomainError('OUTPUT_NOT_READY', '静态成果尚未完成。', 409);
  const resource = (await pool.query("SELECT object_key FROM resources WHERE id=$1 AND project_id=$2 AND state='ready'", [result.resourceId, projectId])).rows[0];
  if (!resource) throw new DomainError('OUTPUT_UNAVAILABLE', '成果文件暂时不可用。', 503);
  try {
    const bytes = await store.read(resource.object_key);
    if (bytesHash(bytes) !== result.imageHash) throw new Error('Image digest mismatch');
    return bytes;
  } catch { throw new DomainError('OUTPUT_UNAVAILABLE', '成果文件暂时不可用，请稍后重试。', 503); }
}
