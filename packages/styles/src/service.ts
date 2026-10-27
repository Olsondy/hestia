import type { PoolClient } from 'pg';
import { transaction } from '../../persistence/src/client';
import { toScene, type Principal } from '../../projects/src/service';
import { DomainError, idSchema, spatialStateSchema, type SpatialState } from '../../contracts/src/project';
import { applyStyleSchema, undoStyleSchema, type StyleResult, type StyleState, type VisualStyle } from '../../contracts/src/styles';
import { hash } from '../../candidates/src/checks';
import { applyStyleCommand, styleOf, validateStyle } from './rules';

type ProjectRow = { id: string; name: string; revision: number; snapshot: SpatialState; updated_at: Date };
type History = { operation_id: string; revision: number; before_style: VisualStyle | null; after_style: VisualStyle;
  layout_hash: string; fixed_facts_hash: string; undone_by: string | null };
async function projectRow(client: PoolClient, principal: Principal, id: string, lock = false): Promise<ProjectRow> {
  if (!principal.userId) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  const row = (await client.query<ProjectRow>(`SELECT id,name,revision,snapshot,updated_at FROM projects WHERE id=$1 AND owner_id=$2${lock ? ' FOR UPDATE' : ''}`, [idSchema.parse(id), principal.userId])).rows[0];
  if (!row) throw new DomainError('NOT_FOUND', '项目不存在。', 404);
  row.snapshot = spatialStateSchema.parse(row.snapshot); return row;
}
function canUndo(project: ProjectRow, history: History) {
  return !history.undone_by && project.revision === history.revision && hash(styleOf(project.snapshot.visualStyle)) === hash(styleOf(history.after_style))
    && hash(project.snapshot.currentLayout) === history.layout_hash && hash(project.snapshot.fixedFacts) === history.fixed_facts_hash;
}
export async function getStyles(principal: Principal, projectId: string): Promise<StyleState> {
  return transaction(async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const project = await projectRow(client, principal, projectId);
    const row = (await client.query<History>('SELECT * FROM project_style_commands WHERE project_id=$1 ORDER BY revision DESC LIMIT 1', [project.id])).rows[0];
    return { projectRevision: project.revision, visualStyle: styleOf(project.snapshot.visualStyle),
      undoableCommand: row && canUndo(project, row) ? { operationId: row.operation_id, revision: row.revision } : null };
  });
}
async function mutate(principal: Principal, projectId: string, kind: string, request: { operationId: string }, work: (client: PoolClient, project: ProjectRow) => Promise<void>) {
  const id = idSchema.parse(projectId), requestHash = hash({ kind, projectId: id, ...request });
  await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${principal.userId}:${request.operationId}`]);
    const project = await projectRow(client, principal, id, true);
    const previous = (await client.query('SELECT request_hash FROM operations WHERE owner_id=$1 AND id=$2', [principal.userId, request.operationId])).rows[0];
    if (previous) {
      if (previous.request_hash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409);
      return;
    }
    await work(client, project);
    await client.query('INSERT INTO operations(owner_id,id,project_id,request_hash,result) VALUES($1,$2,$3,$4,$5)', [principal.userId, request.operationId, id, requestHash, { operationId: request.operationId }]);
  });
}
async function save(client: PoolClient, project: ProjectRow, visualStyle: VisualStyle | null, operationId: string) {
  const state = spatialStateSchema.parse({ ...project.snapshot, visualStyle: visualStyle ?? undefined }), revision = project.revision + 1;
  await client.query('UPDATE projects SET snapshot=$1,revision=$2,updated_at=now() WHERE id=$3', [state, revision, project.id]);
  await client.query('INSERT INTO project_revisions(project_id,revision,snapshot,operation_id) VALUES($1,$2,$3,$4)', [project.id, revision, state, operationId]);
  return revision;
}
async function result(principal: Principal, projectId: string, operationId: string): Promise<StyleResult> {
  return transaction(async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const row = await projectRow(client, principal, projectId), state = row.snapshot;
    const history = (await client.query<History>('SELECT * FROM project_style_commands WHERE project_id=$1 ORDER BY revision DESC LIMIT 1', [row.id])).rows[0];
    const resources = (await client.query('SELECT id,project_id,media_type,state FROM resources WHERE project_id=$1', [row.id])).rows;
    return { operationId, projectRevision: row.revision, visualStyle: styleOf(state.visualStyle),
      undoableCommand: history && canUndo(row, history) ? { operationId: history.operation_id, revision: history.revision } : null,
      project: { id: row.id, name: row.name, revision: row.revision, updatedAt: row.updated_at.toISOString(), synthetic: state.synthetic,
        scale: state.scale, scene: toScene(state, row.name), fixedFacts: { id: state.fixedFacts.id, revision: state.fixedFacts.revision },
        currentLayout: { id: state.currentLayout.id, revision: state.currentLayout.revision }, lockedObjectIds: state.currentLayout.lockedObjectIds,
        resources: resources.map(resource => ({ id: resource.id, projectId: resource.project_id, mediaType: resource.media_type, state: resource.state })) } };
  });
}
export async function applyStyle(principal: Principal, projectId: string, input: unknown): Promise<StyleResult> {
  const request = applyStyleSchema.parse(input);
  await mutate(principal, projectId, 'style:apply', request, async (client, project) => {
    if (project.revision !== request.expectedRevision) throw new DomainError('REVISION_CONFLICT', '空间已有变化，请重新打开后修改风格。', 409);
    const before = project.snapshot.visualStyle ?? null;
    const after = applyStyleCommand(project.snapshot, project.snapshot.currentLayout.objects, styleOf(before), request.command);
    const revision = await save(client, project, after, request.operationId);
    await client.query('INSERT INTO project_style_commands(operation_id,owner_id,project_id,revision,command,before_style,after_style,layout_hash,fixed_facts_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [request.operationId, principal.userId, project.id, revision, request.command, before, after, hash(project.snapshot.currentLayout), hash(project.snapshot.fixedFacts)]);
  });
  return result(principal, projectId, request.operationId);
}
export async function undoStyle(principal: Principal, projectId: string, targetId: string, input: unknown): Promise<StyleResult> {
  idSchema.parse(targetId); const request = undoStyleSchema.parse(input);
  await mutate(principal, projectId, 'style:undo', { ...request, targetId } as typeof request, async (client, project) => {
    const row = (await client.query<History>('SELECT * FROM project_style_commands WHERE operation_id=$1 AND project_id=$2 AND owner_id=$3 FOR UPDATE', [targetId, project.id, principal.userId])).rows[0];
    if (!row) throw new DomainError('NOT_FOUND', '风格操作不存在。', 404);
    if (project.revision !== request.expectedRevision || !canUndo(project, row)) throw new DomainError('UNDO_STYLE_CONFLICT', '之后已有项目修改或此操作已撤销，无法覆盖后续风格。', 409);
    validateStyle(project.snapshot, project.snapshot.currentLayout.objects, styleOf(row.before_style));
    await save(client, project, row.before_style, request.operationId);
    await client.query('UPDATE project_style_commands SET undone_by=$1 WHERE operation_id=$2', [request.operationId, targetId]);
  });
  return result(principal, projectId, request.operationId);
}
