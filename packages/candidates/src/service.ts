import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { and, desc, eq, sql } from 'drizzle-orm';
import { advisoryXactLock, orm, transaction, type Database } from '../../persistence/src/client';
import { candidateAdoptions, candidateChecks, candidatePresentations, candidateRevisions, candidateSelections, candidates, designTasks, operations, projectRevisions, projects, resources, taskEvents } from '../../persistence/src/schema';
import { toScene, type Principal } from '../../projects/src/service';
import { canAccessProject } from '../../workspaces/src/access';
import { DomainError, idSchema, spatialStateSchema, type ProjectView, type SpatialState } from '../../contracts/src/project';
import { createCandidateSchema, editCandidateSchema, checkCandidateSchema, presentCandidateSchema, selectCandidateSchema, adoptCandidateSchema, undoAdoptionSchema,
  type CandidateView, type CandidateSummary, type CandidateCheck, type CandidateList, type CandidatePresentation, type CandidateSelection, type AdoptionResult, type AdoptionSummary } from '../../contracts/src/candidates';
import { assertBrowserUser, type BrowserUser } from './browser-user';
import { CHECKER_VERSION, differences, objectChanges, hasLayoutChange, hash, inspectLayout } from './checks';
import { catalogInstance } from '../../catalog/src/instances';
import { applyStyleCommand, styleOf, styleChanges, validateStyle } from '../../styles/src/rules';
import type { ChangeKind, VisualStyle } from '../../contracts/src/styles';
import type { PlannerContext, LayoutPlan } from '../../layout-planner/src/contract';
import { inspectPlannerLayout } from '../../layout-planner/src/checks';
import type { SurfaceDesign } from '../../contracts/src/finishes';
import { stoneCatalog, type StoneCatalog } from '../../finishes/src/catalog';
import { applyTilingCommand, tilingChanges } from '../../finishes/src/commands';
import { inspectSurfaceDesign } from '../../finishes/src/plan';

type Layout = SpatialState['currentLayout'];
type ProjectRow = { id: string; name: string; revision: number; snapshot: SpatialState; updatedAt: Date };
type CandidateRow = Omit<typeof candidates.$inferSelect, 'baseState' | 'objects' | 'status' | 'visualStyle' | 'plannerContext' | 'surfaceDesign'> & {
  baseState: SpatialState; objects: Layout['objects']; status: CandidateSummary['status'];
  visualStyle: VisualStyle | null; plannerContext: PlannerContext | null; surfaceDesign: SurfaceDesign | null };
type CheckRow = Omit<typeof candidateChecks.$inferSelect, 'report'> & { report: Pick<CandidateCheck, 'adoptable' | 'checks' | 'issues'> };
type AdoptionRow = Omit<typeof candidateAdoptions.$inferSelect, 'beforeStyle' | 'afterStyle' | 'beforeSurface' | 'afterSurface' | 'changeKind' | 'beforeLayout' | 'afterLayout'> & {
  beforeStyle: VisualStyle | null; afterStyle: VisualStyle | null; beforeSurface: SurfaceDesign | null; afterSurface: SurfaceDesign | null; changeKind: ChangeKind;
  beforeLayout: Layout; afterLayout: Layout };
const notFound = () => new DomainError('NOT_FOUND', '项目、候选或操作不存在。', 404);
const conflict = (message = '当前方案已有变化，请基于最新空间重新建立候选。') => new DomainError('REVISION_CONFLICT', message, 409);
const readonly = async <T>(read: (client: PoolClient, tx: Database) => Promise<T>) => transaction(async (client, tx) => {
  await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`); return read(client, tx);
});
async function projectRow(tx: Database, principal: Principal, projectId: string, lock = false): Promise<ProjectRow> {
  if (!principal.userId) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  const query = tx.select({ id: projects.id, name: projects.name, revision: projects.revision, snapshot: projects.snapshot, updatedAt: projects.updatedAt })
    .from(projects).where(and(eq(projects.id, idSchema.parse(projectId)), canAccessProject(projects.id, principal.userId)));
  const [row] = await (lock ? query.for('update') : query);
  if (!row) throw notFound(); return { ...row, snapshot: spatialStateSchema.parse(row.snapshot) };
}
/** Callers authorize the project with projectRow first; a candidate is then addressed within that project only. */
async function candidateRow(tx: Database, projectId: string, candidateId: string, lock = false): Promise<CandidateRow> {
  const query = tx.select().from(candidates).where(and(eq(candidates.id, idSchema.parse(candidateId)), eq(candidates.projectId, projectId)));
  const [row] = await (lock ? query.for('update') : query);
  if (!row) throw notFound(); return { ...row, baseState: spatialStateSchema.parse(row.baseState) } as CandidateRow;
}
const visualStyle = (candidate: CandidateRow) => styleOf(candidate.visualStyle ?? candidate.baseState.visualStyle);
const surfaceDesign = (candidate: CandidateRow): SurfaceDesign | null => candidate.surfaceDesign ?? candidate.baseState.surfaceDesign ?? null;
const surfaceChanges = (candidate: CandidateRow) => tilingChanges(candidate.baseState.surfaceDesign, surfaceDesign(candidate) ?? undefined);
function changeKind(candidate: CandidateRow): ChangeKind {
  const kinds = ([['layout', hasLayoutChange(candidate.baseState, candidate.objects)], ['style', styleChanges(candidate.baseState.visualStyle, visualStyle(candidate)).length > 0],
    ['surface', surfaceChanges(candidate).length > 0]] as const).filter(([, changed]) => changed).map(([kind]) => kind);
  return kinds.length > 1 ? 'mixed' : kinds[0] ?? 'none';
}
const loadCatalog = (client: PoolClient, candidate: CandidateRow) => stoneCatalog(client, candidate.projectId);
const contentHash = (candidate: CandidateRow) => hash({ baseRevision: candidate.baseRevision, base: candidate.baseState, objects: candidate.objects, visualStyle: visualStyle(candidate), surfaceDesign: surfaceDesign(candidate), revision: candidate.revision,
  ...(candidate.plannerContext ? { plannerContext: candidate.plannerContext } : {}) });
function isStale(project: ProjectRow, candidate: CandidateRow) { return project.revision !== candidate.baseRevision || hash(project.snapshot) !== hash(candidate.baseState); }
function current(project: ProjectRow, candidate: CandidateRow, revision?: number) {
  if (candidate.status === 'adopted') throw new DomainError('CANDIDATE_ADOPTED', '已采用的候选保留为历史，不能再次修改或采用。', 409);
  if (revision !== undefined && candidate.revision !== revision) throw new DomainError('CANDIDATE_REVISION_CONFLICT', '候选已有新版本，请重新打开。', 409);
  if (isStale(project, candidate)) throw conflict();
}
async function plannerIntentCurrent(tx: Database, candidate: CandidateRow) {
  const source = candidate.plannerContext;
  if (!source) return true;
  if (!source.taskId) return false;
  const [task] = await tx.select({ intent: sql<string | null>`${designTasks.conversation}->'brief'->>'intentVersion'` }).from(designTasks)
    .where(and(eq(designTasks.id, source.taskId), eq(designTasks.projectId, candidate.projectId)));
  return task?.intent === String(source.intentVersion);
}
async function assertPlannerIntent(tx: Database, candidate: CandidateRow) {
  if (!await plannerIntentCurrent(tx, candidate)) throw new DomainError('STALE_PLANNER_INTENT', '居住需求已更新，此推荐不再代表当前意图，请重新生成。', 409);
}
function checkView(row: CheckRow): CandidateCheck {
  return { id: row.id, candidateId: row.candidateId, candidateRevision: row.candidateRevision, baseRevision: row.baseRevision,
    contentHash: row.contentHash, checkerVersion: row.checkerVersion, ...row.report, createdAt: row.createdAt.toISOString() };
}
async function checked(client: PoolClient, tx: Database, candidate: CandidateRow, checkId: string) {
  await assertPlannerIntent(tx, candidate);
  const [row] = await tx.select().from(candidateChecks).where(and(eq(candidateChecks.id, checkId), eq(candidateChecks.candidateId, candidate.id))) as CheckRow[];
  if (!row || row.candidateRevision !== candidate.revision || row.baseRevision !== candidate.baseRevision || row.contentHash !== contentHash(candidate) || row.checkerVersion !== CHECKER_VERSION)
    throw new DomainError('STALE_CHECK', '检查已过期，请重新检查并展示候选。', 409);
  if (hash(row.report) !== hash(candidateReport(candidate, await loadCatalog(client, candidate)))) throw new DomainError('STALE_CHECK', '检查覆盖与当前候选不一致，请重新检查。', 409);
  if (!row.report.adoptable || !row.report.checks.length || row.report.checks.some(item => item.required && !['passed', 'not-applicable'].includes(item.status)))
    throw new DomainError('CANDIDATE_NOT_ADOPTABLE', '候选仍有冲突或必要检查未完成。', 400, row.report);
  return row;
}
function summary(project: ProjectRow, candidate: CandidateRow): CandidateSummary {
  return { id: candidate.id, projectId: candidate.projectId, name: candidate.name, revision: candidate.revision, baseRevision: candidate.baseRevision,
    fixedFactsId: candidate.baseState.fixedFacts.id, fixedFactsRevision: candidate.baseState.fixedFacts.revision, status: candidate.status,
    stale: isStale(project, candidate), changeKind: changeKind(candidate), changedObjectIds: [...new Set([...objectChanges(candidate.baseState, candidate.objects).map(item => item.objectId), ...styleChanges(candidate.baseState.visualStyle, visualStyle(candidate)).flatMap(item => item.kind === 'material' ? [item.objectId] : []), ...surfaceChanges(candidate).map(item => item.finishId)])],
    createdAt: candidate.createdAt.toISOString(), updatedAt: candidate.updatedAt.toISOString() };
}
async function candidateView(tx: Database, project: ProjectRow, candidate: CandidateRow): Promise<CandidateView> {
  const [row] = await tx.select().from(candidateChecks).where(and(eq(candidateChecks.candidateId, candidate.id), eq(candidateChecks.candidateRevision, candidate.revision)))
    .orderBy(desc(candidateChecks.createdAt)).limit(1) as CheckRow[];
  const sceneState = spatialStateSchema.parse({ ...candidate.baseState, visualStyle: visualStyle(candidate), surfaceDesign: surfaceDesign(candidate) ?? undefined, currentLayout: { ...candidate.baseState.currentLayout, objects: candidate.objects } });
  const sourceCurrent = await plannerIntentCurrent(tx, candidate);
  return { ...summary(project, candidate), stale: isStale(project, candidate) || !sourceCurrent, visualStyle: visualStyle(candidate), styleChanges: styleChanges(candidate.baseState.visualStyle, visualStyle(candidate)), surfaceDesign: surfaceDesign(candidate), tilingChanges: surfaceChanges(candidate), scene: toScene(sceneState, candidate.name), lockedObjectIds: sceneState.currentLayout.lockedObjectIds,
    synthetic: sceneState.synthetic, scale: sceneState.scale, differences: differences(candidate.baseState, candidate.objects), objectChanges: objectChanges(candidate.baseState, candidate.objects), check: row ? checkView(row) : null };
}
async function projectView(tx: Database, project: ProjectRow): Promise<ProjectView> {
  const state = project.snapshot;
  const files = await tx.select({ id: resources.id, projectId: resources.projectId, mediaType: resources.mediaType, state: resources.state }).from(resources).where(eq(resources.projectId, project.id));
  return { id: project.id, name: project.name, revision: project.revision, updatedAt: project.updatedAt.toISOString(), scene: toScene(state, project.name),
    synthetic: state.synthetic, scale: state.scale, fixedFacts: { id: state.fixedFacts.id, revision: state.fixedFacts.revision },
    currentLayout: { id: state.currentLayout.id, revision: state.currentLayout.revision }, lockedObjectIds: state.currentLayout.lockedObjectIds,
    resources: files as ProjectView['resources'] };
}
/** Shared operation ledger and project lock serialize all mutations with T05, without sharing its history. */
async function mutate<T, R extends { operationId: string }>(principal: Principal, projectId: string, kind: string, request: R, work: (client: PoolClient, tx: Database, project: ProjectRow, lockedTaskIds: string[]) => Promise<T>): Promise<T> {
  const id = idSchema.parse(projectId), requestHash = hash({ kind, projectId: id, ...request });
  if (!principal.userId) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  const actorId = principal.userId;
  return transaction(async (client, tx) => {
    await advisoryXactLock(tx, `${actorId}:${request.operationId}`);
    // Match the runner's task -> project lock order. Only these captured rows may be completed
    // after adoption; a newer concurrently-created task must never be locked from below project.
    const lockedTaskIds = kind === 'candidate:adopt' ? (await tx.select({ id: designTasks.id }).from(designTasks)
      .where(and(eq(designTasks.projectId, id), eq(designTasks.status, 'waiting_selection'), canAccessProject(designTasks.projectId, actorId)))
      .orderBy(designTasks.id).for('update')).map(row => row.id) : [];
    const project = await projectRow(tx, principal, id, true);
    const [previous] = await tx.select({ requestHash: operations.requestHash, result: operations.result }).from(operations)
      .where(and(eq(operations.actorId, actorId), eq(operations.id, request.operationId)));
    if (previous) {
      if (previous.requestHash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409);
      return previous.result as T;
    }
    const result = await work(client, tx, project, lockedTaskIds);
    await tx.insert(operations).values({ actorId, id: request.operationId, projectId: id, requestHash, result });
    return result;
  });
}
export async function createCandidate(principal: Principal, projectId: string, input: unknown): Promise<CandidateView> {
  const request = createCandidateSchema.parse(input);
  const result = await mutate(principal, projectId, 'candidate:create', request, async (_client, tx, project) => {
    if (project.revision !== request.expectedRevision) throw conflict();
    const candidateId = randomUUID();
    const surface = project.snapshot.surfaceDesign ?? null;
    const objects = project.snapshot.currentLayout.objects, visualStyle = styleOf(project.snapshot.visualStyle);
    await tx.insert(candidates).values({ id: candidateId, projectId: project.id, actorId: principal.userId, name: request.name, revision: 1, baseRevision: project.revision,
      baseState: project.snapshot, objects, visualStyle, surfaceDesign: surface, status: 'draft' });
    await tx.insert(candidateRevisions).values({ candidateId, revision: 1, objects, visualStyle, surfaceDesign: surface });
    return { candidateId };
  });
  return getCandidate(principal, projectId, result.candidateId);
}
/** Internal Worker transaction entry. Caller must hold and recheck the task fence. */
export async function savePlannedCandidateInTransaction(client: PoolClient, principal: Principal, projectId: string, request: PlannedRequest) {
  return savePlanned(client, orm(client), principal, projectId, request);
}
type PlannedRequest = { operationId: string; expectedRevision: number; baseHash: string; objects: Layout['objects']; context: PlannerContext; report: LayoutPlan; plannerRequestHash: string };
async function savePlanned(client: PoolClient, tx: Database, principal: Principal, projectId: string, request: PlannedRequest) {
  const { report: _report, ...stableRequest } = request;
  const requestHash = hash({ kind: 'candidate:planned', projectId, ...stableRequest });
  await advisoryXactLock(tx, `${principal.userId}:${request.operationId}`);
  const project = await projectRow(tx, principal, projectId, true);
  const [previous] = await tx.select({ requestHash: operations.requestHash, result: operations.result }).from(operations)
    .where(and(eq(operations.actorId, principal.userId), eq(operations.id, request.operationId)));
  if (previous) {
    if (previous.requestHash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT', '布局操作标识已绑定另一结果。', 409);
    return previous.result as { candidateId: string; candidateRevision: number; checkId: string; report: LayoutPlan; plannerRequestHash: string };
  }
  if (project.revision !== request.expectedRevision || hash(project.snapshot) !== request.baseHash) throw conflict();
  const candidateId = randomUUID(), candidate: CandidateRow = { id: candidateId, projectId, actorId: principal.userId,
    name: '会客与办公 · 布局推荐', revision: 1, baseRevision: project.revision, baseState: project.snapshot,
    objects: request.objects, plannerContext: request.context, visualStyle: styleOf(project.snapshot.visualStyle), surfaceDesign: project.snapshot.surfaceDesign ?? null, status: 'checked', createdAt: new Date(), updatedAt: new Date() };
  await assertPlannerIntent(tx, candidate);
  const report = candidateReport(candidate, await loadCatalog(client, candidate));
  if (!report.adoptable) throw new DomainError('PLANNER_CHECK_REJECTED', '规划结果在保存前复核未通过，没有保存可采用推荐。', 400, report);
  await tx.insert(candidates).values({ id: candidateId, projectId, actorId: principal.userId, name: candidate.name, revision: 1, baseRevision: project.revision, baseState: project.snapshot,
    objects: candidate.objects, visualStyle: candidate.visualStyle, surfaceDesign: candidate.surfaceDesign, plannerContext: request.context, status: 'checked' });
  await tx.insert(candidateRevisions).values({ candidateId, revision: 1, objects: candidate.objects, visualStyle: candidate.visualStyle, surfaceDesign: candidate.surfaceDesign });
  const checkId = randomUUID();
  await tx.insert(candidateChecks).values({ id: checkId, candidateId, candidateRevision: 1, baseRevision: project.revision, contentHash: contentHash(candidate), checkerVersion: CHECKER_VERSION, report });
  const result = { candidateId, candidateRevision: 1, checkId, report: request.report, plannerRequestHash: request.plannerRequestHash };
  await tx.insert(operations).values({ actorId: principal.userId, id: request.operationId, projectId, requestHash, result });
  return result;
}
export async function getCandidate(principal: Principal, projectId: string, candidateId: string): Promise<CandidateView> {
  return readonly(async (_client, tx) => candidateView(tx, await projectRow(tx, principal, projectId), await candidateRow(tx, projectId, candidateId)));
}
export async function editCandidate(principal: Principal, projectId: string, candidateId: string, input: unknown): Promise<CandidateView> {
  const request = editCandidateSchema.parse(input);
  await mutate(principal, projectId, 'candidate:edit', { ...request, candidateId: idSchema.parse(candidateId) }, async (client, tx, project) => {
    const candidate = await candidateRow(tx, project.id, candidateId, true); current(project, candidate, request.expectedCandidateRevision);
    const command = request.command;
    candidate.visualStyle = visualStyle(candidate); candidate.surfaceDesign = surfaceDesign(candidate);
    if (command.type === 'set-tiling' || command.type === 'clear-tiling') {
      candidate.surfaceDesign = applyTilingCommand(candidate.baseState.fixedFacts.finishes, candidate.surfaceDesign ?? undefined, command, await loadCatalog(client, candidate));
    } else if (command.type === 'set-material' || command.type === 'reset-material' || command.type === 'set-display-lighting') {
      candidate.visualStyle = applyStyleCommand(candidate.baseState, candidate.objects, candidate.visualStyle, command);
    } else if (command.type === 'add-furniture') {
      const reference = { assetId: command.assetId, assetVersion: command.assetVersion, materialId: command.materialId, materialVersion: command.materialVersion };
      candidate.objects.push(catalogInstance(`furniture-${randomUUID()}`, reference, command.size, command));
    } else {
      if (candidate.baseState.fixedFacts.objects.some(object => object.id === command.objectId)) throw new DomainError('FIXED_FACT', '候选不能改变固定设施。');
      if (candidate.baseState.currentLayout.lockedObjectIds.includes(command.objectId)) throw new DomainError('OBJECT_LOCKED', '候选不能改变锁定家具。');
      const object = candidate.objects.find(object => object.id === command.objectId);
      if (!object) throw new DomainError('OBJECT_NOT_FOUND', '家具不存在。', 404);
      if (command.type === 'move-furniture') {
        if (object.position.x === command.x && object.position.z === command.z && object.yaw === command.yaw) throw new DomainError('NO_CHANGE', '家具位置和朝向没有变化。');
        object.position.x = command.x; object.position.z = command.z; object.yaw = command.yaw;
      } else {
        const baseObject = candidate.baseState.currentLayout.objects.find(item => item.id === object.id);
        if (object.dimensionSource === 'measured' || baseObject?.dimensionSource === 'measured') throw new DomainError('MEASURED_FURNITURE_PROTECTED', '实测家具不能通过普通候选删除或换件；可以保持原尺寸移动。');
        candidate.visualStyle.materials = candidate.visualStyle.materials.filter(item => item.objectId !== object.id);
        if (command.type === 'remove-furniture') candidate.objects = candidate.objects.filter(item => item.id !== object.id);
        else {
          const reference = { assetId: command.assetId, assetVersion: command.assetVersion, materialId: command.materialId, materialVersion: command.materialVersion };
          const replacement = catalogInstance(object.id, reference, command.size, { x: object.position.x, z: object.position.z, yaw: object.yaw }); replacement.position.y = object.position.y;
          if (object.catalog?.assetId === reference.assetId && object.catalog.assetVersion === reference.assetVersion && hash(object.size) === hash(replacement.size)
            && (object.catalog.materialId !== reference.materialId || object.catalog.materialVersion !== reference.materialVersion))
            throw new DomainError('STYLE_REQUIRES_OVERRIDE', '仅更换材质请使用视觉风格编辑，不能作为家具换件保存。');
          if (hash(replacement) === hash(object)) throw new DomainError('NO_CHANGE', '目录家具和规格没有变化。');
          candidate.objects = candidate.objects.map(item => item.id === object.id ? replacement : item);
        }
      }
    }
    spatialStateSchema.parse({ ...candidate.baseState, visualStyle: candidate.visualStyle, surfaceDesign: candidate.surfaceDesign ?? undefined, currentLayout: { ...candidate.baseState.currentLayout, objects: candidate.objects } });
    validateStyle(candidate.baseState, candidate.objects, candidate.visualStyle);
    await tx.update(candidates).set({ objects: candidate.objects, visualStyle: candidate.visualStyle, surfaceDesign: candidate.surfaceDesign,
      revision: sql`${candidates.revision} + 1`, status: 'draft', updatedAt: sql`now()` }).where(eq(candidates.id, candidate.id));
    await tx.insert(candidateRevisions).values({ candidateId: candidate.id, revision: candidate.revision + 1, objects: candidate.objects, visualStyle: candidate.visualStyle, surfaceDesign: candidate.surfaceDesign });
    return { candidateId: candidate.id };
  });
  return getCandidate(principal, projectId, candidateId);
}
function candidateReport(candidate: CandidateRow, catalog: StoneCatalog) {
  const report = inspectLayout(candidate.baseState, candidate.objects);
  if (candidate.plannerContext) {
    const planner = inspectPlannerLayout(candidate.baseState, candidate.objects, candidate.plannerContext);
    report.checks.push(...planner.checks); report.issues.push(...planner.issues); report.adoptable &&= planner.adoptable;
  }
  if (!hasLayoutChange(candidate.baseState, candidate.objects) && objectChanges(candidate.baseState, candidate.objects).length) {
    report.adoptable = false;
    report.checks.push({ code: 'style-object-isolation', status: 'failed', required: true });
    report.issues.push({ code: 'STYLE_REQUIRES_OVERRIDE', message: '纯风格候选不能同时改写家具记录，请通过独立风格命令表达材质。' });
  }
  let styleValid = true;
  try { validateStyle(candidate.baseState, candidate.objects, visualStyle(candidate)); }
  catch (error) { styleValid = false; report.adoptable = false; report.issues.push({ code: error instanceof DomainError ? error.code : 'INVALID_STYLE', message: '候选风格不符合目录、对象范围或锁定约束。' }); }
  report.checks.push({ code: 'visual-style', status: styleValid ? 'passed' : 'failed', required: true });
  const design = surfaceDesign(candidate);
  if (design?.tilings.length) {
    // Retired catalog versions block only the tilings this candidate changes; inherited ones are reported as hints.
    const surface = inspectSurfaceDesign(candidate.baseState.fixedFacts, design, catalog.lookup, { changedFinishIds: surfaceChanges(candidate).map(item => item.finishId) });
    report.checks.push({ code: 'surface-design', status: surface.adoptable ? 'passed' : 'failed', required: true });
    report.issues.push(...surface.issues.map(issue => ({ code: issue.code, objectId: issue.objectId, message: issue.message })));
    report.adoptable &&= surface.adoptable;
  } else report.checks.push({ code: 'surface-design', status: 'not-applicable', required: true });
  const changed = changeKind(candidate) !== 'none';
  report.checks.push({ code: 'change-set', status: changed ? 'passed' : 'failed', required: true });
  if (!changed) { report.adoptable = false; report.issues.push({ code: 'NO_CHANGE', message: '候选与当前方案没有布局、风格或铺贴差异。' }); }
  return report;
}
export async function checkCandidate(principal: Principal, projectId: string, candidateId: string, input: unknown): Promise<CandidateCheck> {
  const request = checkCandidateSchema.parse(input);
  const result = await mutate(principal, projectId, 'candidate:check', { ...request, candidateId: idSchema.parse(candidateId) }, async (client, tx, project) => {
    const candidate = await candidateRow(tx, project.id, candidateId, true); current(project, candidate, request.expectedCandidateRevision);
    await assertPlannerIntent(tx, candidate);
    const checkId = randomUUID(), report = candidateReport(candidate, await loadCatalog(client, candidate));
    await tx.insert(candidateChecks).values({ id: checkId, candidateId: candidate.id, candidateRevision: candidate.revision, baseRevision: candidate.baseRevision, contentHash: contentHash(candidate), checkerVersion: CHECKER_VERSION, report });
    await tx.update(candidates).set({ status: report.adoptable ? 'checked' : 'draft', updatedAt: sql`now()` }).where(eq(candidates.id, candidate.id));
    return { checkId };
  });
  return readonly(async (_client, tx) => {
    await projectRow(tx, principal, projectId); await candidateRow(tx, projectId, candidateId);
    const [row] = await tx.select().from(candidateChecks).where(and(eq(candidateChecks.id, result.checkId), eq(candidateChecks.candidateId, candidateId)));
    return checkView(row as CheckRow);
  });
}
const presentationView = (row: typeof candidatePresentations.$inferSelect): CandidatePresentation => ({ id: row.id, candidateId: row.candidateId, candidateRevision: row.candidateRevision, baseRevision: row.baseRevision, checkId: row.checkId, createdAt: row.createdAt.toISOString() });
/** Browser-only presentation receipt. Previewing or recording presentation never adopts a layout. */
export async function presentCandidate(user: BrowserUser, projectId: string, candidateId: string, input: unknown): Promise<CandidatePresentation> {
  assertBrowserUser(user); const request = presentCandidateSchema.parse(input);
  return mutate(user, projectId, 'candidate:present', { ...request, candidateId: idSchema.parse(candidateId), sessionHash: user.sessionHash }, async (client, tx, project) => {
    const candidate = await candidateRow(tx, project.id, candidateId, true); current(project, candidate, request.expectedCandidateRevision);
    if (project.revision !== request.expectedRevision) throw conflict(); await checked(client, tx, candidate, request.checkId);
    const [row] = await tx.insert(candidatePresentations).values({ id: randomUUID(), candidateId: candidate.id, candidateRevision: candidate.revision, baseRevision: candidate.baseRevision,
      checkId: request.checkId, actorId: user.userId, sessionHash: user.sessionHash, contentHash: contentHash(candidate) }).returning();
    return presentationView(row);
  });
}
/** Only a real same-origin authenticated UI event can create this user selection. Never register as a Worker tool. */
export async function selectCandidate(user: BrowserUser, projectId: string, candidateId: string, input: unknown): Promise<CandidateSelection> {
  assertBrowserUser(user); const request = selectCandidateSchema.parse(input);
  return mutate(user, projectId, 'candidate:select', { ...request, candidateId: idSchema.parse(candidateId), sessionHash: user.sessionHash }, async (client, tx, project) => {
    const candidate = await candidateRow(tx, project.id, candidateId, true); current(project, candidate);
    const [presentation] = await tx.select().from(candidatePresentations).where(and(eq(candidatePresentations.id, request.presentationId), eq(candidatePresentations.candidateId, candidate.id),
      eq(candidatePresentations.actorId, user.userId), eq(candidatePresentations.sessionHash, user.sessionHash)));
    if (!presentation) throw new DomainError('USER_SELECTION_REQUIRED', '请先在当前会话展示要采用的候选。', 403);
    if (presentation.candidateRevision !== candidate.revision || presentation.baseRevision !== project.revision || presentation.contentHash !== contentHash(candidate)) throw new DomainError('STALE_PRESENTATION', '展示版本已变化，请重新查看后选择。', 409);
    await checked(client, tx, candidate, presentation.checkId);
    const [row] = await tx.insert(candidateSelections).values({ id: randomUUID(), presentationId: presentation.id, actorId: user.userId, sessionHash: user.sessionHash }).returning();
    return { id: row.id, presentationId: presentation.id, candidateId: candidate.id, candidateRevision: candidate.revision, baseRevision: candidate.baseRevision, createdAt: row.createdAt.toISOString() };
  });
}
function undoable(project: ProjectRow, row: AdoptionRow) {
  return !row.undoneBy && project.revision === row.revision && hash(project.snapshot.currentLayout) === hash(row.afterLayout) && hash(project.snapshot.fixedFacts) === row.fixedFactsHash && hash(styleOf(project.snapshot.visualStyle)) === hash(styleOf(row.afterStyle))
    && hash(project.snapshot.surfaceDesign ?? null) === hash(row.afterSurface ?? null);
}
const adoptionView = (project: ProjectRow, row: AdoptionRow): AdoptionSummary => ({ operationId: row.operationId, candidateId: row.candidateId, candidateRevision: row.candidateRevision, revision: row.revision, undoable: undoable(project, row), undoneBy: row.undoneBy });
async function latestUndoable(tx: Database, project: ProjectRow): Promise<CandidateList['undoableAdoption']> {
  const [row] = await tx.select().from(candidateAdoptions).where(eq(candidateAdoptions.projectId, project.id)).orderBy(desc(candidateAdoptions.revision)).limit(1) as AdoptionRow[];
  return row && undoable(project, row) ? { operationId: row.operationId, revision: row.revision } : null;
}
export async function listCandidates(principal: Principal, projectId: string): Promise<CandidateList> {
  return readonly(async (_client, tx) => {
    const project = await projectRow(tx, principal, projectId);
    const rows = await tx.select().from(candidates).where(eq(candidates.projectId, project.id)).orderBy(desc(candidates.updatedAt)).limit(100) as CandidateRow[];
    return { candidates: await Promise.all(rows.map(async row => ({ ...summary(project, row), stale: isStale(project, row) || !await plannerIntentCurrent(tx, row) }))), undoableAdoption: await latestUndoable(tx, project) };
  });
}
async function adoptionResult(principal: Principal, projectId: string, operationId: string): Promise<AdoptionResult> {
  return readonly(async (_client, tx) => {
    const project = await projectRow(tx, principal, projectId);
    const [row] = await tx.select().from(candidateAdoptions).where(and(eq(candidateAdoptions.operationId, operationId), eq(candidateAdoptions.projectId, project.id))) as AdoptionRow[];
    if (!row) throw notFound();
    return { project: await projectView(tx, project), adoption: adoptionView(project, row), undoableAdoption: await latestUndoable(tx, project) };
  });
}
async function saveLayout(tx: Database, project: ProjectRow, layout: Layout, operationId: string, style: VisualStyle | null, surface: SurfaceDesign | null) {
  const state = spatialStateSchema.parse({ ...project.snapshot, currentLayout: layout, visualStyle: style ?? undefined, surfaceDesign: surface ?? undefined }), revision = project.revision + 1;
  await tx.update(projects).set({ snapshot: state, revision, updatedAt: sql`now()` }).where(eq(projects.id, project.id));
  await tx.insert(projectRevisions).values({ projectId: project.id, revision, snapshot: state, operationId });
  return revision;
}
/** Worker may consume an existing server-recorded user choice, but cannot construct that choice. */
export async function adoptCandidate(principal: Principal, projectId: string, candidateId: string, input: unknown): Promise<AdoptionResult> {
  const request = adoptCandidateSchema.parse(input);
  await mutate(principal, projectId, 'candidate:adopt', { ...request, candidateId: idSchema.parse(candidateId) }, async (client, tx, project, lockedTaskIds) => {
    const candidate = await candidateRow(tx, project.id, candidateId, true); current(project, candidate);
    if (project.revision !== request.expectedRevision) throw conflict();
    const [selection] = await tx.select().from(candidateSelections).where(and(eq(candidateSelections.id, request.selectionId), eq(candidateSelections.actorId, principal.userId))).for('update');
    if (!selection || selection.adoptedOperationId) throw new DomainError('USER_SELECTION_REQUIRED', '需要用户对当前展示版本的有效选择。', 403);
    const [presentation] = await tx.select().from(candidatePresentations)
      .where(and(eq(candidatePresentations.id, selection.presentationId), eq(candidatePresentations.candidateId, candidate.id), eq(candidatePresentations.actorId, principal.userId)));
    if (!presentation) throw new DomainError('USER_SELECTION_REQUIRED', '用户选择不属于此候选。', 403);
    if (presentation.candidateRevision !== candidate.revision || presentation.baseRevision !== project.revision || presentation.contentHash !== contentHash(candidate)) throw new DomainError('STALE_SELECTION', '用户选择的版本已变化，请重新展示并选择。', 409);
    await checked(client, tx, candidate, presentation.checkId);
    const report = candidateReport(candidate, await loadCatalog(client, candidate));
    if (!report.adoptable) throw new DomainError('CANDIDATE_NOT_ADOPTABLE', '采用前复核未通过，当前方案保持不变。', 400, report);
    const kind = changeKind(candidate), before = project.snapshot.currentLayout, after = !hasLayoutChange(candidate.baseState, candidate.objects) ? before : { ...before, id: randomUUID(), revision: 1, objects: candidate.objects };
    const style = visualStyle(candidate), surface = surfaceDesign(candidate), revision = await saveLayout(tx, project, after, request.operationId, style, surface);
    // The ledger row is inserted by mutate after this callback; deferred FK keeps all writes atomic.
    await tx.execute(sql`SET CONSTRAINTS candidate_adoptions_actor_id_operation_id_fkey DEFERRED`);
    await tx.insert(candidateAdoptions).values({ operationId: request.operationId, actorId: principal.userId, projectId: project.id, candidateId: candidate.id, candidateRevision: candidate.revision,
      selectionId: selection.id, revision, beforeLayout: before, afterLayout: after, fixedFactsHash: hash(project.snapshot.fixedFacts), beforeStyle: project.snapshot.visualStyle ?? null,
      afterStyle: style, beforeSurface: project.snapshot.surfaceDesign ?? null, afterSurface: surface, changeKind: kind });
    await tx.update(candidates).set({ status: 'adopted', updatedAt: sql`now()` }).where(eq(candidates.id, candidate.id));
    await tx.update(candidateSelections).set({ adoptedOperationId: request.operationId }).where(eq(candidateSelections.id, selection.id));
    if (candidate.plannerContext && lockedTaskIds.includes(candidate.plannerContext.taskId ?? '')) {
      // Explicit selection above binds the current edited candidate revision. The task still
      // references its originally generated revision, so comparing those revisions would strand
      // an otherwise successfully adopted task. Match candidate identity and source intent,
      // then record the adoption without ending a newer task or recommendation. Keep the
      // original outcome revision: its attached planReport describes that generated revision.
      const outcome = JSON.stringify({ projectRevision: revision, operationId: request.operationId, message: '已采用所选布局候选，可在当前空间查看并整体撤销。' });
      const [done] = await tx.update(designTasks).set({ status: 'completed', leaseUntil: null, eventSeq: sql`${designTasks.eventSeq} + 1`,
        conversation: sql`jsonb_set(${designTasks.conversation}, '{outcome}', (${designTasks.conversation}->'outcome') || ${outcome}::jsonb)`, updatedAt: sql`clock_timestamp()` })
        .where(and(eq(designTasks.id, candidate.plannerContext.taskId!), eq(designTasks.status, 'waiting_selection'),
          sql`${designTasks.conversation}->'brief'->>'intentVersion' = ${String(candidate.plannerContext.intentVersion)}`,
          sql`${designTasks.conversation}->'outcome'->>'candidateId' = ${candidate.id}`))
        .returning({ id: designTasks.id, eventSeq: designTasks.eventSeq });
      if (done) await tx.insert(taskEvents).values({ taskId: done.id, seq: done.eventSeq, type: 'status',
        data: { status: 'completed', phase: 'finished', authoritative: true, adoptedOperationId: request.operationId, projectRevision: revision, candidateId: candidate.id, candidateRevision: candidate.revision, intentVersion: candidate.plannerContext.intentVersion } });
    }
    return { operationId: request.operationId, candidateId: candidate.id, revision };
  });
  return adoptionResult(principal, projectId, request.operationId);
}
export async function undoAdoption(principal: Principal, projectId: string, adoptionId: string, input: unknown): Promise<AdoptionResult> {
  const request = undoAdoptionSchema.parse(input); idSchema.parse(adoptionId);
  await mutate(principal, projectId, 'candidate:undo-adoption', { ...request, adoptionId }, async (_client, tx, project) => {
    const [row] = await tx.select().from(candidateAdoptions).where(and(eq(candidateAdoptions.operationId, adoptionId), eq(candidateAdoptions.projectId, project.id))).for('update') as AdoptionRow[];
    if (!row) throw notFound();
    if (project.revision !== request.expectedRevision || !undoable(project, row)) throw new DomainError('UNDO_ADOPTION_CONFLICT', '采用后已有项目修改或该采用已撤销，不能整体覆盖。', 409);
    const state = spatialStateSchema.parse({ ...project.snapshot, currentLayout: row.beforeLayout, visualStyle: row.beforeStyle ?? undefined, surfaceDesign: row.beforeSurface ?? undefined });
    const report = inspectLayout(state, state.currentLayout.objects);
    if (!report.adoptable) throw new DomainError('UNDO_ADOPTION_REJECTED', '原布局未通过当前空间检查，未执行撤销。', 400, report);
    validateStyle(state, state.currentLayout.objects, styleOf(row.beforeStyle));
    const layout = hash(row.beforeLayout) === hash(row.afterLayout) ? state.currentLayout : { ...state.currentLayout, id: randomUUID(), revision: 1 };
    const revision = await saveLayout(tx, project, layout, request.operationId, row.beforeStyle, row.beforeSurface);
    await tx.update(candidateAdoptions).set({ undoneBy: request.operationId }).where(eq(candidateAdoptions.operationId, adoptionId));
    return { operationId: request.operationId, adoptionId, revision };
  });
  return adoptionResult(principal, projectId, adoptionId);
}
