import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { transaction } from '../../persistence/src/client';
import { toScene, type Principal } from '../../projects/src/service';
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

type ProjectRow = { id: string; name: string; revision: number; snapshot: SpatialState; updated_at: Date };
type CandidateRow = { id: string; project_id: string; owner_id: string; name: string; revision: number; base_revision: number; base_state: SpatialState;
  planner_context?: PlannerContext | null;
  visual_style: VisualStyle | null;
  objects: SpatialState['currentLayout']['objects']; status: CandidateSummary['status']; created_at: Date; updated_at: Date };
type CheckRow = { id: string; candidate_id: string; candidate_revision: number; base_revision: number; content_hash: string; checker_version: string;
  report: Pick<CandidateCheck, 'adoptable' | 'checks' | 'issues'>; created_at: Date };
type PresentationRow = { id: string; candidate_id: string; candidate_revision: number; base_revision: number; check_id: string; owner_id: string; session_hash: string; content_hash: string; created_at: Date };
type SelectionRow = { id: string; presentation_id: string; owner_id: string; session_hash: string; adopted_operation_id: string | null; created_at: Date };
type AdoptionRow = { operation_id: string; owner_id: string; project_id: string; candidate_id: string; candidate_revision: number; revision: number;
  before_style: VisualStyle | null; after_style: VisualStyle | null; change_kind: ChangeKind;
  before_layout: SpatialState['currentLayout']; after_layout: SpatialState['currentLayout']; fixed_facts_hash: string; undone_by: string | null };
const notFound = () => new DomainError('NOT_FOUND', '项目、候选或操作不存在。', 404);
const conflict = (message = '当前方案已有变化，请基于最新空间重新建立候选。') => new DomainError('REVISION_CONFLICT', message, 409);
const readonly = async <T>(read: (client: PoolClient) => Promise<T>) => transaction(async client => {
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'); return read(client);
});
async function projectRow(client: PoolClient, principal: Principal, projectId: string, lock = false): Promise<ProjectRow> {
  if (!principal.userId) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  const row = (await client.query<ProjectRow>(`SELECT id,name,revision,snapshot,updated_at FROM projects WHERE id=$1 AND owner_id=$2${lock ? ' FOR UPDATE' : ''}`, [idSchema.parse(projectId), principal.userId])).rows[0];
  if (!row) throw notFound(); row.snapshot = spatialStateSchema.parse(row.snapshot); return row;
}
async function candidateRow(client: PoolClient, principal: Principal, projectId: string, candidateId: string, lock = false): Promise<CandidateRow> {
  const row = (await client.query<CandidateRow>(`SELECT * FROM candidates WHERE id=$1 AND project_id=$2 AND owner_id=$3${lock ? ' FOR UPDATE' : ''}`, [idSchema.parse(candidateId), projectId, principal.userId])).rows[0];
  if (!row) throw notFound(); row.base_state = spatialStateSchema.parse(row.base_state); return row;
}
const visualStyle = (candidate: CandidateRow) => styleOf(candidate.visual_style ?? candidate.base_state.visualStyle);
function changeKind(candidate: CandidateRow): ChangeKind {
  const layout = hasLayoutChange(candidate.base_state, candidate.objects), style = styleChanges(candidate.base_state.visualStyle, visualStyle(candidate)).length > 0;
  return layout ? style ? 'mixed' : 'layout' : style ? 'style' : 'none';
}
const contentHash = (candidate: CandidateRow) => hash({ baseRevision: candidate.base_revision, base: candidate.base_state, objects: candidate.objects, visualStyle: visualStyle(candidate), revision: candidate.revision,
  ...(candidate.planner_context ? { plannerContext: candidate.planner_context } : {}) });
function isStale(project: ProjectRow, candidate: CandidateRow) { return project.revision !== candidate.base_revision || hash(project.snapshot) !== hash(candidate.base_state); }
function current(project: ProjectRow, candidate: CandidateRow, revision?: number) {
  if (candidate.status === 'adopted') throw new DomainError('CANDIDATE_ADOPTED', '已采用的候选保留为历史，不能再次修改或采用。', 409);
  if (revision !== undefined && candidate.revision !== revision) throw new DomainError('CANDIDATE_REVISION_CONFLICT', '候选已有新版本，请重新打开。', 409);
  if (isStale(project, candidate)) throw conflict();
}
async function plannerIntentCurrent(client: PoolClient, candidate: CandidateRow) {
  const source = candidate.planner_context;
  if (!source) return true;
  if (!source.taskId) return false;
  const task = (await client.query("SELECT conversation->'brief'->>'intentVersion' AS intent FROM design_tasks WHERE id=$1 AND project_id=$2 AND owner_id=$3", [source.taskId, candidate.project_id, candidate.owner_id])).rows[0];
  return task?.intent === String(source.intentVersion);
}
async function assertPlannerIntent(client: PoolClient, candidate: CandidateRow) {
  if (!await plannerIntentCurrent(client, candidate)) throw new DomainError('STALE_PLANNER_INTENT', '居住需求已更新，此推荐不再代表当前意图，请重新生成。', 409);
}
function checkView(row: CheckRow): CandidateCheck {
  return { id: row.id, candidateId: row.candidate_id, candidateRevision: row.candidate_revision, baseRevision: row.base_revision,
    contentHash: row.content_hash, checkerVersion: row.checker_version, ...row.report, createdAt: row.created_at.toISOString() };
}
async function checked(client: PoolClient, candidate: CandidateRow, checkId: string) {
  await assertPlannerIntent(client, candidate);
  const row = (await client.query<CheckRow>('SELECT * FROM candidate_checks WHERE id=$1 AND candidate_id=$2', [checkId, candidate.id])).rows[0];
  if (!row || row.candidate_revision !== candidate.revision || row.base_revision !== candidate.base_revision || row.content_hash !== contentHash(candidate) || row.checker_version !== CHECKER_VERSION)
    throw new DomainError('STALE_CHECK', '检查已过期，请重新检查并展示候选。', 409);
  if (hash(row.report) !== hash(candidateReport(candidate))) throw new DomainError('STALE_CHECK', '检查覆盖与当前候选不一致，请重新检查。', 409);
  if (!row.report.adoptable || !row.report.checks.length || row.report.checks.some(item => item.required && !['passed', 'not-applicable'].includes(item.status)))
    throw new DomainError('CANDIDATE_NOT_ADOPTABLE', '候选仍有冲突或必要检查未完成。', 400, row.report);
  return row;
}
function summary(project: ProjectRow, candidate: CandidateRow): CandidateSummary {
  return { id: candidate.id, projectId: candidate.project_id, name: candidate.name, revision: candidate.revision, baseRevision: candidate.base_revision,
    fixedFactsId: candidate.base_state.fixedFacts.id, fixedFactsRevision: candidate.base_state.fixedFacts.revision, status: candidate.status,
    stale: isStale(project, candidate), changeKind: changeKind(candidate), changedObjectIds: [...new Set([...objectChanges(candidate.base_state, candidate.objects).map(item => item.objectId), ...styleChanges(candidate.base_state.visualStyle, visualStyle(candidate)).flatMap(item => item.kind === 'material' ? [item.objectId] : [])])],
    createdAt: candidate.created_at.toISOString(), updatedAt: candidate.updated_at.toISOString() };
}
async function candidateView(client: PoolClient, project: ProjectRow, candidate: CandidateRow): Promise<CandidateView> {
  const row = (await client.query<CheckRow>('SELECT * FROM candidate_checks WHERE candidate_id=$1 AND candidate_revision=$2 ORDER BY created_at DESC LIMIT 1', [candidate.id, candidate.revision])).rows[0];
  const sceneState = spatialStateSchema.parse({ ...candidate.base_state, visualStyle: visualStyle(candidate), currentLayout: { ...candidate.base_state.currentLayout, objects: candidate.objects } });
  const sourceCurrent = await plannerIntentCurrent(client, candidate);
  return { ...summary(project, candidate), stale: isStale(project, candidate) || !sourceCurrent, visualStyle: visualStyle(candidate), styleChanges: styleChanges(candidate.base_state.visualStyle, visualStyle(candidate)), scene: toScene(sceneState, candidate.name), lockedObjectIds: sceneState.currentLayout.lockedObjectIds,
    synthetic: sceneState.synthetic, scale: sceneState.scale, differences: differences(candidate.base_state, candidate.objects), objectChanges: objectChanges(candidate.base_state, candidate.objects), check: row ? checkView(row) : null };
}
async function projectView(client: PoolClient, project: ProjectRow): Promise<ProjectView> {
  const state = project.snapshot;
  const resources = (await client.query('SELECT id,project_id,media_type,state FROM resources WHERE project_id=$1', [project.id])).rows;
  return { id: project.id, name: project.name, revision: project.revision, updatedAt: project.updated_at.toISOString(), scene: toScene(state, project.name),
    synthetic: state.synthetic, scale: state.scale, fixedFacts: { id: state.fixedFacts.id, revision: state.fixedFacts.revision },
    currentLayout: { id: state.currentLayout.id, revision: state.currentLayout.revision }, lockedObjectIds: state.currentLayout.lockedObjectIds,
    resources: resources.map(row => ({ id: row.id, projectId: row.project_id, mediaType: row.media_type, state: row.state })) };
}
/** Shared operation ledger and project lock serialize all mutations with T05, without sharing its history. */
async function mutate<T, R extends { operationId: string }>(principal: Principal, projectId: string, kind: string, request: R, work: (client: PoolClient, project: ProjectRow, lockedTaskIds: string[]) => Promise<T>): Promise<T> {
  const id = idSchema.parse(projectId), requestHash = hash({ kind, projectId: id, ...request });
  if (!principal.userId) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  return transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${principal.userId}:${request.operationId}`]);
    // Match the runner's task -> project lock order. Only these captured rows may be completed
    // after adoption; a newer concurrently-created task must never be locked from below project.
    const lockedTaskIds = kind === 'candidate:adopt' ? (await client.query<{ id: string }>(
      "SELECT id FROM design_tasks WHERE owner_id=$1 AND project_id=$2 AND status='waiting_selection' ORDER BY id FOR UPDATE", [principal.userId, id])).rows.map(row => row.id) : [];
    const project = await projectRow(client, principal, id, true);
    const previous = (await client.query('SELECT request_hash,result FROM operations WHERE owner_id=$1 AND id=$2', [principal.userId, request.operationId])).rows[0];
    if (previous) {
      if (previous.request_hash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409);
      return previous.result as T;
    }
    const result = await work(client, project, lockedTaskIds);
    await client.query('INSERT INTO operations(owner_id,id,project_id,request_hash,result) VALUES($1,$2,$3,$4,$5)', [principal.userId, request.operationId, id, requestHash, result]);
    return result;
  });
}
export async function createCandidate(principal: Principal, projectId: string, input: unknown): Promise<CandidateView> {
  const request = createCandidateSchema.parse(input);
  const result = await mutate(principal, projectId, 'candidate:create', request, async (client, project) => {
    if (project.revision !== request.expectedRevision) throw conflict();
    const candidateId = randomUUID();
    await client.query("INSERT INTO candidates(id,project_id,owner_id,name,revision,base_revision,base_state,objects,visual_style,status) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,'draft')", [candidateId, project.id, principal.userId, request.name, project.revision, project.snapshot, JSON.stringify(project.snapshot.currentLayout.objects), styleOf(project.snapshot.visualStyle)]);
    await client.query('INSERT INTO candidate_revisions(candidate_id,revision,objects,visual_style) VALUES($1,1,$2,$3)', [candidateId, JSON.stringify(project.snapshot.currentLayout.objects), styleOf(project.snapshot.visualStyle)]);
    return { candidateId };
  });
  return getCandidate(principal, projectId, result.candidateId);
}
/** Internal Worker transaction entry. Caller must hold and recheck the task fence. */
export async function savePlannedCandidateInTransaction(client: PoolClient, principal: Principal, projectId: string, request: {
  operationId: string; expectedRevision: number; baseHash: string; objects: SpatialState['currentLayout']['objects']; context: PlannerContext;
  report: LayoutPlan; plannerRequestHash: string;
}) {
  const { report: _report, ...stableRequest } = request;
  const requestHash = hash({ kind: 'candidate:planned', projectId, ...stableRequest });
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${principal.userId}:${request.operationId}`]);
  const project = await projectRow(client, principal, projectId, true);
  const previous = (await client.query('SELECT request_hash,result FROM operations WHERE owner_id=$1 AND id=$2', [principal.userId, request.operationId])).rows[0];
  if (previous) {
    if (previous.request_hash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT', '布局操作标识已绑定另一结果。', 409);
    return previous.result as { candidateId: string; candidateRevision: number; checkId: string; report: LayoutPlan; plannerRequestHash: string };
  }
  if (project.revision !== request.expectedRevision || hash(project.snapshot) !== request.baseHash) throw conflict();
  const candidateId = randomUUID(), candidate: CandidateRow = { id: candidateId, project_id: projectId, owner_id: principal.userId,
    name: '会客与办公 · 布局推荐', revision: 1, base_revision: project.revision, base_state: project.snapshot,
    objects: request.objects, planner_context: request.context, visual_style: styleOf(project.snapshot.visualStyle), status: 'checked', created_at: new Date(), updated_at: new Date() };
  await assertPlannerIntent(client, candidate);
  const report = candidateReport(candidate);
  if (!report.adoptable) throw new DomainError('PLANNER_CHECK_REJECTED', '规划结果在保存前复核未通过，没有保存可采用推荐。', 400, report);
  await client.query("INSERT INTO candidates(id,project_id,owner_id,name,revision,base_revision,base_state,objects,visual_style,planner_context,status) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,'checked')", [candidateId, projectId, principal.userId, candidate.name, project.revision, project.snapshot, JSON.stringify(candidate.objects), candidate.visual_style, request.context]);
  await client.query('INSERT INTO candidate_revisions(candidate_id,revision,objects,visual_style) VALUES($1,1,$2,$3)', [candidateId, JSON.stringify(candidate.objects), candidate.visual_style]);
  const checkId = randomUUID();
  await client.query('INSERT INTO candidate_checks(id,candidate_id,candidate_revision,base_revision,content_hash,checker_version,report) VALUES($1,$2,1,$3,$4,$5,$6)', [checkId, candidateId, project.revision, contentHash(candidate), CHECKER_VERSION, report]);
  const result = { candidateId, candidateRevision: 1, checkId, report: request.report, plannerRequestHash: request.plannerRequestHash };
  await client.query('INSERT INTO operations(owner_id,id,project_id,request_hash,result) VALUES($1,$2,$3,$4,$5)', [principal.userId, request.operationId, projectId, requestHash, result]);
  return result;
}
export async function getCandidate(principal: Principal, projectId: string, candidateId: string): Promise<CandidateView> {
  return readonly(async client => candidateView(client, await projectRow(client, principal, projectId), await candidateRow(client, principal, projectId, candidateId)));
}
export async function editCandidate(principal: Principal, projectId: string, candidateId: string, input: unknown): Promise<CandidateView> {
  const request = editCandidateSchema.parse(input);
  await mutate(principal, projectId, 'candidate:edit', { ...request, candidateId: idSchema.parse(candidateId) }, async (client, project) => {
    const candidate = await candidateRow(client, principal, project.id, candidateId, true); current(project, candidate, request.expectedCandidateRevision);
    const command = request.command;
    candidate.visual_style = visualStyle(candidate);
    if (command.type === 'set-material' || command.type === 'reset-material' || command.type === 'set-display-lighting') {
      candidate.visual_style = applyStyleCommand(candidate.base_state, candidate.objects, candidate.visual_style, command);
    } else if (command.type === 'add-furniture') {
      const reference = { assetId: command.assetId, assetVersion: command.assetVersion, materialId: command.materialId, materialVersion: command.materialVersion };
      candidate.objects.push(catalogInstance(`furniture-${randomUUID()}`, reference, command.size, command));
    } else {
      if (candidate.base_state.fixedFacts.objects.some(object => object.id === command.objectId)) throw new DomainError('FIXED_FACT', '候选不能改变固定设施。');
      if (candidate.base_state.currentLayout.lockedObjectIds.includes(command.objectId)) throw new DomainError('OBJECT_LOCKED', '候选不能改变锁定家具。');
      const object = candidate.objects.find(object => object.id === command.objectId);
      if (!object) throw new DomainError('OBJECT_NOT_FOUND', '家具不存在。', 404);
      if (command.type === 'move-furniture') {
        if (object.position.x === command.x && object.position.z === command.z && object.yaw === command.yaw) throw new DomainError('NO_CHANGE', '家具位置和朝向没有变化。');
        object.position.x = command.x; object.position.z = command.z; object.yaw = command.yaw;
      } else {
        const baseObject = candidate.base_state.currentLayout.objects.find(item => item.id === object.id);
        if (object.dimensionSource === 'measured' || baseObject?.dimensionSource === 'measured') throw new DomainError('MEASURED_FURNITURE_PROTECTED', '实测家具不能通过普通候选删除或换件；可以保持原尺寸移动。');
        candidate.visual_style.materials = candidate.visual_style.materials.filter(item => item.objectId !== object.id);
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
    spatialStateSchema.parse({ ...candidate.base_state, visualStyle: candidate.visual_style, currentLayout: { ...candidate.base_state.currentLayout, objects: candidate.objects } });
    validateStyle(candidate.base_state, candidate.objects, candidate.visual_style);
    await client.query("UPDATE candidates SET objects=$1,visual_style=$3,revision=revision+1,status='draft',updated_at=now() WHERE id=$2", [JSON.stringify(candidate.objects), candidate.id, candidate.visual_style]);
    await client.query('INSERT INTO candidate_revisions(candidate_id,revision,objects,visual_style) VALUES($1,$2,$3,$4)', [candidate.id, candidate.revision + 1, JSON.stringify(candidate.objects), candidate.visual_style]);
    return { candidateId: candidate.id };
  });
  return getCandidate(principal, projectId, candidateId);
}
function candidateReport(candidate: CandidateRow) {
  const report = inspectLayout(candidate.base_state, candidate.objects);
  if (candidate.planner_context) {
    const planner = inspectPlannerLayout(candidate.base_state, candidate.objects, candidate.planner_context);
    report.checks.push(...planner.checks); report.issues.push(...planner.issues); report.adoptable &&= planner.adoptable;
  }
  if (!hasLayoutChange(candidate.base_state, candidate.objects) && objectChanges(candidate.base_state, candidate.objects).length) {
    report.adoptable = false;
    report.checks.push({ code: 'style-object-isolation', status: 'failed', required: true });
    report.issues.push({ code: 'STYLE_REQUIRES_OVERRIDE', message: '纯风格候选不能同时改写家具记录，请通过独立风格命令表达材质。' });
  }
  let styleValid = true;
  try { validateStyle(candidate.base_state, candidate.objects, visualStyle(candidate)); }
  catch (error) { styleValid = false; report.adoptable = false; report.issues.push({ code: error instanceof DomainError ? error.code : 'INVALID_STYLE', message: '候选风格不符合目录、对象范围或锁定约束。' }); }
  report.checks.push({ code: 'visual-style', status: styleValid ? 'passed' : 'failed', required: true });
  const changed = changeKind(candidate) !== 'none';
  report.checks.push({ code: 'change-set', status: changed ? 'passed' : 'failed', required: true });
  if (!changed) { report.adoptable = false; report.issues.push({ code: 'NO_CHANGE', message: '候选与当前方案没有布局或风格差异。' }); }
  return report;
}
export async function checkCandidate(principal: Principal, projectId: string, candidateId: string, input: unknown): Promise<CandidateCheck> {
  const request = checkCandidateSchema.parse(input);
  const result = await mutate(principal, projectId, 'candidate:check', { ...request, candidateId: idSchema.parse(candidateId) }, async (client, project) => {
    const candidate = await candidateRow(client, principal, project.id, candidateId, true); current(project, candidate, request.expectedCandidateRevision);
    await assertPlannerIntent(client, candidate);
    const checkId = randomUUID(), report = candidateReport(candidate);
    await client.query('INSERT INTO candidate_checks(id,candidate_id,candidate_revision,base_revision,content_hash,checker_version,report) VALUES($1,$2,$3,$4,$5,$6,$7)', [checkId, candidate.id, candidate.revision, candidate.base_revision, contentHash(candidate), CHECKER_VERSION, report]);
    await client.query("UPDATE candidates SET status=$1,updated_at=now() WHERE id=$2", [report.adoptable ? 'checked' : 'draft', candidate.id]);
    return { checkId };
  });
  return readonly(async client => {
    await projectRow(client, principal, projectId); await candidateRow(client, principal, projectId, candidateId);
    return checkView((await client.query<CheckRow>('SELECT * FROM candidate_checks WHERE id=$1 AND candidate_id=$2', [result.checkId, candidateId])).rows[0]);
  });
}
const presentationView = (row: PresentationRow): CandidatePresentation => ({ id: row.id, candidateId: row.candidate_id, candidateRevision: row.candidate_revision, baseRevision: row.base_revision, checkId: row.check_id, createdAt: row.created_at.toISOString() });
/** Browser-only presentation receipt. Previewing or recording presentation never adopts a layout. */
export async function presentCandidate(user: BrowserUser, projectId: string, candidateId: string, input: unknown): Promise<CandidatePresentation> {
  assertBrowserUser(user); const request = presentCandidateSchema.parse(input);
  return mutate(user, projectId, 'candidate:present', { ...request, candidateId: idSchema.parse(candidateId), sessionHash: user.sessionHash }, async (client, project) => {
    const candidate = await candidateRow(client, user, project.id, candidateId, true); current(project, candidate, request.expectedCandidateRevision);
    if (project.revision !== request.expectedRevision) throw conflict(); await checked(client, candidate, request.checkId);
    const row = (await client.query<PresentationRow>('INSERT INTO candidate_presentations(id,candidate_id,candidate_revision,base_revision,check_id,owner_id,session_hash,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [randomUUID(), candidate.id, candidate.revision, candidate.base_revision, request.checkId, user.userId, user.sessionHash, contentHash(candidate)])).rows[0];
    return presentationView(row);
  });
}
/** Only a real same-origin authenticated UI event can create this user selection. Never register as a Worker tool. */
export async function selectCandidate(user: BrowserUser, projectId: string, candidateId: string, input: unknown): Promise<CandidateSelection> {
  assertBrowserUser(user); const request = selectCandidateSchema.parse(input);
  return mutate(user, projectId, 'candidate:select', { ...request, candidateId: idSchema.parse(candidateId), sessionHash: user.sessionHash }, async (client, project) => {
    const candidate = await candidateRow(client, user, project.id, candidateId, true); current(project, candidate);
    const presentation = (await client.query<PresentationRow>('SELECT * FROM candidate_presentations WHERE id=$1 AND candidate_id=$2 AND owner_id=$3 AND session_hash=$4', [request.presentationId, candidate.id, user.userId, user.sessionHash])).rows[0];
    if (!presentation) throw new DomainError('USER_SELECTION_REQUIRED', '请先在当前会话展示要采用的候选。', 403);
    if (presentation.candidate_revision !== candidate.revision || presentation.base_revision !== project.revision || presentation.content_hash !== contentHash(candidate)) throw new DomainError('STALE_PRESENTATION', '展示版本已变化，请重新查看后选择。', 409);
    await checked(client, candidate, presentation.check_id);
    const row = (await client.query<SelectionRow>('INSERT INTO candidate_selections(id,presentation_id,owner_id,session_hash) VALUES($1,$2,$3,$4) RETURNING *', [randomUUID(), presentation.id, user.userId, user.sessionHash])).rows[0];
    return { id: row.id, presentationId: presentation.id, candidateId: candidate.id, candidateRevision: candidate.revision, baseRevision: candidate.base_revision, createdAt: row.created_at.toISOString() };
  });
}
function undoable(project: ProjectRow, row: AdoptionRow) {
  return !row.undone_by && project.revision === row.revision && hash(project.snapshot.currentLayout) === hash(row.after_layout) && hash(project.snapshot.fixedFacts) === row.fixed_facts_hash && hash(styleOf(project.snapshot.visualStyle)) === hash(styleOf(row.after_style));
}
const adoptionView = (project: ProjectRow, row: AdoptionRow): AdoptionSummary => ({ operationId: row.operation_id, candidateId: row.candidate_id, candidateRevision: row.candidate_revision, revision: row.revision, undoable: undoable(project, row), undoneBy: row.undone_by });
async function latestUndoable(client: PoolClient, project: ProjectRow): Promise<CandidateList['undoableAdoption']> {
  const row = (await client.query<AdoptionRow>('SELECT * FROM candidate_adoptions WHERE project_id=$1 ORDER BY revision DESC LIMIT 1', [project.id])).rows[0];
  return row && undoable(project, row) ? { operationId: row.operation_id, revision: row.revision } : null;
}
export async function listCandidates(principal: Principal, projectId: string): Promise<CandidateList> {
  return readonly(async client => {
    const project = await projectRow(client, principal, projectId);
    const rows = (await client.query<CandidateRow>('SELECT * FROM candidates WHERE project_id=$1 AND owner_id=$2 ORDER BY updated_at DESC LIMIT 100', [project.id, principal.userId])).rows;
    return { candidates: await Promise.all(rows.map(async row => ({ ...summary(project, row), stale: isStale(project, row) || !await plannerIntentCurrent(client, row) }))), undoableAdoption: await latestUndoable(client, project) };
  });
}
async function adoptionResult(principal: Principal, projectId: string, operationId: string): Promise<AdoptionResult> {
  return readonly(async client => {
    const project = await projectRow(client, principal, projectId);
    const row = (await client.query<AdoptionRow>('SELECT * FROM candidate_adoptions WHERE operation_id=$1 AND project_id=$2 AND owner_id=$3', [operationId, project.id, principal.userId])).rows[0];
    if (!row) throw notFound();
    return { project: await projectView(client, project), adoption: adoptionView(project, row), undoableAdoption: await latestUndoable(client, project) };
  });
}
async function saveLayout(client: PoolClient, project: ProjectRow, layout: SpatialState['currentLayout'], operationId: string, style: VisualStyle | null) {
  const state = spatialStateSchema.parse({ ...project.snapshot, currentLayout: layout, visualStyle: style ?? undefined }), revision = project.revision + 1;
  await client.query('UPDATE projects SET snapshot=$1,revision=$2,updated_at=now() WHERE id=$3', [state, revision, project.id]);
  await client.query('INSERT INTO project_revisions(project_id,revision,snapshot,operation_id) VALUES($1,$2,$3,$4)', [project.id, revision, state, operationId]);
  return revision;
}
/** Worker may consume an existing server-recorded user choice, but cannot construct that choice. */
export async function adoptCandidate(principal: Principal, projectId: string, candidateId: string, input: unknown): Promise<AdoptionResult> {
  const request = adoptCandidateSchema.parse(input);
  await mutate(principal, projectId, 'candidate:adopt', { ...request, candidateId: idSchema.parse(candidateId) }, async (client, project, lockedTaskIds) => {
    const candidate = await candidateRow(client, principal, project.id, candidateId, true); current(project, candidate);
    if (project.revision !== request.expectedRevision) throw conflict();
    const selection = (await client.query<SelectionRow>('SELECT * FROM candidate_selections WHERE id=$1 AND owner_id=$2 FOR UPDATE', [request.selectionId, principal.userId])).rows[0];
    if (!selection || selection.adopted_operation_id) throw new DomainError('USER_SELECTION_REQUIRED', '需要用户对当前展示版本的有效选择。', 403);
    const presentation = (await client.query<PresentationRow>('SELECT * FROM candidate_presentations WHERE id=$1 AND candidate_id=$2 AND owner_id=$3', [selection.presentation_id, candidate.id, principal.userId])).rows[0];
    if (!presentation) throw new DomainError('USER_SELECTION_REQUIRED', '用户选择不属于此候选。', 403);
    if (presentation.candidate_revision !== candidate.revision || presentation.base_revision !== project.revision || presentation.content_hash !== contentHash(candidate)) throw new DomainError('STALE_SELECTION', '用户选择的版本已变化，请重新展示并选择。', 409);
    await checked(client, candidate, presentation.check_id);
    const report = candidateReport(candidate);
    if (!report.adoptable) throw new DomainError('CANDIDATE_NOT_ADOPTABLE', '采用前复核未通过，当前方案保持不变。', 400, report);
    const kind = changeKind(candidate), before = project.snapshot.currentLayout, after = kind === 'style' ? before : { ...before, id: randomUUID(), revision: 1, objects: candidate.objects };
    const style = visualStyle(candidate), revision = await saveLayout(client, project, after, request.operationId, style);
    // The ledger row is inserted by mutate after this callback; deferred FK keeps all writes atomic.
    await client.query('SET CONSTRAINTS candidate_adoptions_owner_id_operation_id_fkey DEFERRED');
    await client.query('INSERT INTO candidate_adoptions(operation_id,owner_id,project_id,candidate_id,candidate_revision,selection_id,revision,before_layout,after_layout,fixed_facts_hash,before_style,after_style,change_kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [request.operationId, principal.userId, project.id, candidate.id, candidate.revision, selection.id, revision, before, after, hash(project.snapshot.fixedFacts), project.snapshot.visualStyle ?? null, style, kind]);
    await client.query("UPDATE candidates SET status='adopted',updated_at=now() WHERE id=$1", [candidate.id]);
    await client.query('UPDATE candidate_selections SET adopted_operation_id=$1 WHERE id=$2', [request.operationId, selection.id]);
    if (candidate.planner_context && lockedTaskIds.includes(candidate.planner_context.taskId ?? '')) {
      // Explicit selection above binds the current edited candidate revision. The task still
      // references its originally generated revision, so comparing those revisions would strand
      // an otherwise successfully adopted task. Match candidate identity and source intent,
      // then record the adoption without ending a newer task or recommendation. Keep the
      // original outcome revision: its attached planReport describes that generated revision.
      const done = await client.query(`UPDATE design_tasks SET status='completed',lease_until=NULL,event_seq=event_seq+1,
        conversation=jsonb_set(conversation,'{outcome}',(conversation->'outcome') || $4::jsonb),updated_at=clock_timestamp()
        WHERE id=$1 AND status='waiting_selection' AND conversation->'brief'->>'intentVersion'=$2
          AND conversation->'outcome'->>'candidateId'=$3 RETURNING id,event_seq`,
      [candidate.planner_context.taskId, String(candidate.planner_context.intentVersion), candidate.id,
        JSON.stringify({ projectRevision: revision, operationId: request.operationId, message: '已采用所选布局候选，可在当前空间查看并整体撤销。' })]);
      if (done.rows[0]) await client.query("INSERT INTO task_events(task_id,seq,type,data) VALUES($1,$2,'status',$3)", [done.rows[0].id, done.rows[0].event_seq,
        { status: 'completed', phase: 'finished', authoritative: true, adoptedOperationId: request.operationId, projectRevision: revision, candidateId: candidate.id, candidateRevision: candidate.revision, intentVersion: candidate.planner_context.intentVersion }]);
    }
    return { operationId: request.operationId, candidateId: candidate.id, revision };
  });
  return adoptionResult(principal, projectId, request.operationId);
}
export async function undoAdoption(principal: Principal, projectId: string, adoptionId: string, input: unknown): Promise<AdoptionResult> {
  const request = undoAdoptionSchema.parse(input); idSchema.parse(adoptionId);
  await mutate(principal, projectId, 'candidate:undo-adoption', { ...request, adoptionId }, async (client, project) => {
    const row = (await client.query<AdoptionRow>('SELECT * FROM candidate_adoptions WHERE operation_id=$1 AND project_id=$2 AND owner_id=$3 FOR UPDATE', [adoptionId, project.id, principal.userId])).rows[0];
    if (!row) throw notFound();
    if (project.revision !== request.expectedRevision || !undoable(project, row)) throw new DomainError('UNDO_ADOPTION_CONFLICT', '采用后已有项目修改或该采用已撤销，不能整体覆盖。', 409);
    const state = spatialStateSchema.parse({ ...project.snapshot, currentLayout: row.before_layout, visualStyle: row.before_style ?? undefined });
    const report = inspectLayout(state, state.currentLayout.objects);
    if (!report.adoptable) throw new DomainError('UNDO_ADOPTION_REJECTED', '原布局未通过当前空间检查，未执行撤销。', 400, report);
    validateStyle(state, state.currentLayout.objects, styleOf(row.before_style));
    const layout = row.change_kind === 'style' ? state.currentLayout : { ...state.currentLayout, id: randomUUID(), revision: 1 };
    const revision = await saveLayout(client, project, layout, request.operationId, row.before_style);
    await client.query('UPDATE candidate_adoptions SET undone_by=$1 WHERE operation_id=$2', [request.operationId, adoptionId]);
    return { operationId: request.operationId, adoptionId, revision };
  });
  return adoptionResult(principal, projectId, adoptionId);
}
