import { and, desc, eq, sql } from 'drizzle-orm';
import { advisoryXactLock, transaction, type Database } from '../../persistence/src/client';
import { operations, projectRevisions, projects, projectStyleCommands, resources } from '../../persistence/src/schema';
import { toScene, type Principal } from '../../projects/src/service';
import { canAccessProject } from '../../workspaces/src/access';
import { DomainError, idSchema, spatialStateSchema, type ProjectView, type SpatialState } from '../../contracts/src/project';
import { applyStyleSchema, undoStyleSchema, type StyleResult, type StyleState, type VisualStyle } from '../../contracts/src/styles';
import { hash } from '../../candidates/src/checks';
import { applyStyleCommand, styleOf, validateStyle } from './rules';

type ProjectRow = { id: string; name: string; revision: number; snapshot: SpatialState; updatedAt: Date };
type History = typeof projectStyleCommands.$inferSelect & { beforeStyle: VisualStyle | null; afterStyle: VisualStyle };
async function projectRow(tx: Database, principal: Principal, id: string, lock = false): Promise<ProjectRow> {
  if (!principal.userId) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  const query = tx.select({ id: projects.id, name: projects.name, revision: projects.revision, snapshot: projects.snapshot, updatedAt: projects.updatedAt })
    .from(projects).where(and(eq(projects.id, idSchema.parse(id)), canAccessProject(projects.id, principal.userId)));
  const [row] = await (lock ? query.for('update') : query);
  if (!row) throw new DomainError('NOT_FOUND', '项目不存在。', 404);
  return { ...row, snapshot: spatialStateSchema.parse(row.snapshot) };
}
async function latestHistory(tx: Database, projectId: string) {
  const [row] = await tx.select().from(projectStyleCommands).where(eq(projectStyleCommands.projectId, projectId)).orderBy(desc(projectStyleCommands.revision)).limit(1);
  return row as History | undefined;
}
function canUndo(project: ProjectRow, history: History) {
  return !history.undoneBy && project.revision === history.revision && hash(styleOf(project.snapshot.visualStyle)) === hash(styleOf(history.afterStyle))
    && hash(project.snapshot.currentLayout) === history.layoutHash && hash(project.snapshot.fixedFacts) === history.fixedFactsHash;
}
export async function getStyles(principal: Principal, projectId: string): Promise<StyleState> {
  return transaction(async (_client, tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    const project = await projectRow(tx, principal, projectId);
    const row = await latestHistory(tx, project.id);
    return { projectRevision: project.revision, visualStyle: styleOf(project.snapshot.visualStyle),
      undoableCommand: row && canUndo(project, row) ? { operationId: row.operationId, revision: row.revision } : null };
  });
}
async function mutate(principal: Principal, projectId: string, kind: string, request: { operationId: string }, work: (tx: Database, project: ProjectRow) => Promise<void>) {
  const id = idSchema.parse(projectId), requestHash = hash({ kind, projectId: id, ...request });
  await transaction(async (_client, tx) => {
    await advisoryXactLock(tx, `${principal.userId}:${request.operationId}`);
    const project = await projectRow(tx, principal, id, true);
    const [previous] = await tx.select({ requestHash: operations.requestHash }).from(operations)
      .where(and(eq(operations.actorId, principal.userId), eq(operations.id, request.operationId)));
    if (previous) {
      if (previous.requestHash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409);
      return;
    }
    await work(tx, project);
    await tx.insert(operations).values({ actorId: principal.userId, id: request.operationId, projectId: id, requestHash, result: { operationId: request.operationId } });
  });
}
async function save(tx: Database, project: ProjectRow, visualStyle: VisualStyle | null, operationId: string) {
  const state = spatialStateSchema.parse({ ...project.snapshot, visualStyle: visualStyle ?? undefined }), revision = project.revision + 1;
  await tx.update(projects).set({ snapshot: state, revision, updatedAt: sql`now()` }).where(eq(projects.id, project.id));
  await tx.insert(projectRevisions).values({ projectId: project.id, revision, snapshot: state, operationId });
  return revision;
}
async function result(principal: Principal, projectId: string, operationId: string): Promise<StyleResult> {
  return transaction(async (_client, tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    const row = await projectRow(tx, principal, projectId), state = row.snapshot;
    const history = await latestHistory(tx, row.id);
    const files = await tx.select({ id: resources.id, projectId: resources.projectId, mediaType: resources.mediaType, state: resources.state })
      .from(resources).where(eq(resources.projectId, row.id));
    return { operationId, projectRevision: row.revision, visualStyle: styleOf(state.visualStyle),
      undoableCommand: history && canUndo(row, history) ? { operationId: history.operationId, revision: history.revision } : null,
      project: { id: row.id, name: row.name, revision: row.revision, updatedAt: row.updatedAt.toISOString(), synthetic: state.synthetic,
        scale: state.scale, scene: toScene(state, row.name), fixedFacts: { id: state.fixedFacts.id, revision: state.fixedFacts.revision },
        currentLayout: { id: state.currentLayout.id, revision: state.currentLayout.revision }, lockedObjectIds: state.currentLayout.lockedObjectIds,
        resources: files as ProjectView['resources'] } };
  });
}
export async function applyStyle(principal: Principal, projectId: string, input: unknown): Promise<StyleResult> {
  const request = applyStyleSchema.parse(input);
  await mutate(principal, projectId, 'style:apply', request, async (tx, project) => {
    if (project.revision !== request.expectedRevision) throw new DomainError('REVISION_CONFLICT', '空间已有变化，请重新打开后修改风格。', 409);
    const before = project.snapshot.visualStyle ?? null;
    const after = applyStyleCommand(project.snapshot, project.snapshot.currentLayout.objects, styleOf(before), request.command);
    const revision = await save(tx, project, after, request.operationId);
    await tx.insert(projectStyleCommands).values({ operationId: request.operationId, actorId: principal.userId, projectId: project.id, revision, command: request.command,
      beforeStyle: before, afterStyle: after, layoutHash: hash(project.snapshot.currentLayout), fixedFactsHash: hash(project.snapshot.fixedFacts) });
  });
  return result(principal, projectId, request.operationId);
}
export async function undoStyle(principal: Principal, projectId: string, targetId: string, input: unknown): Promise<StyleResult> {
  idSchema.parse(targetId); const request = undoStyleSchema.parse(input);
  await mutate(principal, projectId, 'style:undo', { ...request, targetId } as typeof request, async (tx, project) => {
    const [row] = await tx.select().from(projectStyleCommands)
      .where(and(eq(projectStyleCommands.operationId, targetId), eq(projectStyleCommands.projectId, project.id))).for('update') as History[];
    if (!row) throw new DomainError('NOT_FOUND', '风格操作不存在。', 404);
    if (project.revision !== request.expectedRevision || !canUndo(project, row)) throw new DomainError('UNDO_STYLE_CONFLICT', '之后已有项目修改或此操作已撤销，无法覆盖后续风格。', 409);
    validateStyle(project.snapshot, project.snapshot.currentLayout.objects, styleOf(row.beforeStyle));
    await save(tx, project, row.beforeStyle, request.operationId);
    await tx.update(projectStyleCommands).set({ undoneBy: request.operationId }).where(eq(projectStyleCommands.operationId, targetId));
  });
  return result(principal, projectId, request.operationId);
}
