import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { PgBoss } from 'pg-boss';
import { DomainError, idSchema, spatialStateSchema, type SpatialState } from '../../contracts/src/project';
import { effectiveLevels, levelOf, stairToPlan } from '../../contracts/src/building';
import type { Finish } from '../../contracts/src/finishes';
import type { SceneSnapshot } from '../../contracts/src/scene';
import { createFinishRequestSchema, createMemberRequestSchema, leadFilterSchema, publishFinishRequestSchema, type ClientCatalogView, type DemoVillaPlanView, type FinishRequestStatus, type FinishRequestView,
  type RequestFinishView, type RequestPreferences,
  type FinishSchemeView, type LeadView } from '../../contracts/src/finish-requests';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { advisoryXactLock, orm, transaction } from '../../persistence/src/client';
import { finishRequestEvents, finishRequests, finishSchemeRevisions, finishSchemes, floorplanImports, hestiaAuthUser, operations, projectRenders, projectRevisions,
  projects, workspaceMembers, workspaces } from '../../persistence/src/schema';
import { actorOf, type Principal } from '../../workspaces/src/access';
import { customerEntry, ensureCustomer } from '../../workspaces/src/customers';
import { initialState, insertProjectInTransaction, stateFromScene } from '../../projects/src/service';
import { workspaceStones } from '../../finishes/src/catalog';
import { stoneKey } from '../../finishes/src/plan';
import { createFloorplanImport, getFloorplanCandidate } from '../../drawing-imports/src/service';
import type { PrivateFileStore } from '../../files/src/storage';
import { enqueueSchemeRender, readRenderImage, renderStatuses } from '../../renders/src/service';
import { generateSchemes } from './generate';
import { sharingOf } from './sharing-view';
import { followOf, lastCustomerAction } from './follow-view';

export type RequestRow = {
  id: string; workspace_id: string; customer_id: string | null; created_by: string; origin: 'customer' | 'member'; project_id: string; request_id: string; request_hash: string;
  source: 'demo-villa' | 'drawing'; floorplan_import_id: string | null; finish_ids: string[]; stones: { stoneId: string; stoneVersion: number }[];
  note: string | null; preferences: RequestPreferences | null; status: 'awaiting_drawing' | 'converting' | 'pending_review' | 'published'; review_reason: string | null;
  published_at: Date | null; published_by: string | null; created_at: Date; updated_at: Date;
};
export type SchemeRow = { id: string; request_id: string; ordinal: number; name: string; summary: string; revision: number;
  surface_design: FinishSchemeView['surfaceDesign']; report: { adoptable: boolean; issues: FinishSchemeView['issues'] }; render_id: string | null };
export type RequestDeps = { renderQueue?: PgBoss; importQueue?: PgBoss; store?: PrivateFileStore };
/** Drizzle selections in the `RequestRow` / `SchemeRow` (column-named) shape. */
export const requestColumns = { id: finishRequests.id, workspace_id: finishRequests.workspaceId, customer_id: finishRequests.customerId, created_by: finishRequests.createdBy,
  origin: finishRequests.origin, project_id: finishRequests.projectId, request_id: finishRequests.requestId, request_hash: finishRequests.requestHash, source: finishRequests.source,
  floorplan_import_id: finishRequests.floorplanImportId, finish_ids: finishRequests.finishIds, stones: finishRequests.stones, note: finishRequests.note,
  preferences: finishRequests.preferences, status: finishRequests.status, review_reason: finishRequests.reviewReason, published_at: finishRequests.publishedAt,
  published_by: finishRequests.publishedBy, created_at: finishRequests.createdAt, updated_at: finishRequests.updatedAt };
export const schemeColumns = { id: finishSchemes.id, request_id: finishSchemes.requestId, ordinal: finishSchemes.ordinal, name: finishSchemes.name, summary: finishSchemes.summary,
  revision: finishSchemes.revision, surface_design: finishSchemes.surfaceDesign, report: finishSchemes.report, render_id: finishSchemes.renderId };
/** Drizzle over a caller's connection; it only issues `query`. */
const ormOf = (client: Pick<PoolClient, 'query'>) => orm(client as PoolClient);

const notFound = () => new DomainError('NOT_FOUND', '方案需求不存在。', 404);
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const labels: Record<FinishRequestStatus, string> = {
  awaiting_drawing: '请上传户型图纸',
  converting: '图纸自动转换中',
  assisted_conversion: '该图纸格式不会自动识别，企业将协助转换后出方案',
  pending_review: '方案已生成，等待企业审核后发布',
  published: '方案已发布',
};

/** Customer access: logged in, entered through this workspace's entry. Recorded as a customer relation. */
export async function customer(client: PoolClient, principal: Principal, slug: string) {
  const userId = actorOf(principal), entry = await customerEntry(client, slug);
  await ensureCustomer(client, entry.id, userId);
  return { userId, entry };
}
export async function memberOf(client: Pick<PoolClient, 'query'>, userId: string, workspaceId: string) {
  const [member] = await ormOf(client).select({ one: sql`1` }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))).limit(1);
  if (!member) throw notFound();
}
async function importStatus(client: Pick<PoolClient, 'query'>, row: RequestRow): Promise<FinishRequestStatus> {
  if (row.status !== 'converting' || !row.floorplan_import_id) return row.status;
  const status = (await ormOf(client).select({ status: floorplanImports.status }).from(floorplanImports).where(eq(floorplanImports.id, row.floorplan_import_id)))[0]?.status;
  return status === 'assisted_conversion' ? 'assisted_conversion' : status === 'pending_review' || status === 'failed' ? 'pending_review' : 'converting';
}
/** Name, kind and level of each requested finish, read from the project's fixed facts. */
export function requestFinishes(facts: SpatialState['fixedFacts'], ids: string[]): RequestFinishView[] {
  const levels = effectiveLevels(facts), named = new Map((facts.levels ?? []).map((level, index) => [level.id, level.name ?? `${index + 1} 层`]));
  return ids.flatMap(id => {
    const finish = facts.finishes?.find(item => item.id === id);
    if (!finish) return [];
    const levelId = finish.kind === 'stair' ? facts.stairs?.find(stair => stair.id === finish.stairId)?.fromLevelId
      : finish.kind === 'wall' ? levelOf(facts.walls.find(wall => wall.id === finish.wallId) ?? {}, levels)
        : finish.levelId ?? (finish.roomId ? levelOf(facts.rooms.find(room => room.id === finish.roomId) ?? {}, levels) : undefined);
    const level = facts.levels?.length ? levelId ?? null : null;
    return [{ id, name: finish.name ?? id, kind: finish.kind, levelId: level, levelName: level ? named.get(level) ?? null : null }];
  });
}
export async function view(client: Pick<PoolClient, 'query'>, row: RequestRow, audience: 'customer' | 'member', slug?: string): Promise<FinishRequestView> {
  const tx = ormOf(client), status = await importStatus(client, row);
  const [project] = await tx.select({ name: projects.name, snapshot: projects.snapshot }).from(projects).where(eq(projects.id, row.project_id));
  const drawingName = row.floorplan_import_id
    ? (await tx.select({ fileName: floorplanImports.fileName }).from(floorplanImports).where(eq(floorplanImports.id, row.floorplan_import_id)))[0]?.fileName ?? null : null;
  const facts = spatialStateSchema.parse(project.snapshot).fixedFacts;
  const schemes = audience === 'customer' && row.status !== 'published' ? []
    : await tx.select(schemeColumns).from(finishSchemes).where(eq(finishSchemes.requestId, row.id)).orderBy(asc(finishSchemes.ordinal)) as SchemeRow[];
  const renders = await renderStatuses(row.project_id, schemes.flatMap(s => s.render_id ? [s.render_id] : []), client);
  return { id: row.id, workspaceId: row.workspace_id, projectId: row.project_id, source: row.source, status, statusLabel: labels[status],
    title: project.name, origin: row.origin, drawingName, finishes: requestFinishes(facts, row.finish_ids), preferences: row.preferences ?? null,
    finishIds: row.finish_ids, stones: row.stones, note: row.note, floorplanImportId: row.floorplan_import_id,
    schemes: schemes.map(s => {
      const render = s.render_id ? renders.get(s.render_id) : undefined;
      const imageHref = render?.status === 'completed' ? (audience === 'customer' ? `/api/client/${slug}/requests/${row.id}/schemes/${s.id}/image` : render.contentHref) : null;
      return { id: s.id, ordinal: s.ordinal, name: s.name, summary: s.summary, revision: s.revision, adoptable: s.report.adoptable, issues: s.report.issues,
        surfaceDesign: s.surface_design, render: render ? { id: render.id, status: render.status, width: render.width, height: render.height, error: render.error, imageHref } : null };
    }),
    confirmation: await confirmationOf(client, row.id, schemes),
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), publishedAt: row.published_at?.toISOString() ?? null };
}
async function confirmationOf(client: Pick<PoolClient, 'query'>, requestId: string, schemes: SchemeRow[]): Promise<FinishRequestView['confirmation']> {
  const [event] = await ormOf(client).select({ schemeId: finishRequestEvents.schemeId, schemeRevision: finishRequestEvents.schemeRevision, createdAt: finishRequestEvents.createdAt })
    .from(finishRequestEvents).where(and(eq(finishRequestEvents.requestId, requestId), eq(finishRequestEvents.kind, 'confirmation')))
    .orderBy(desc(finishRequestEvents.createdAt)).limit(1);
  if (!event) return null;
  const scheme = schemes.find(s => s.id === event.schemeId);
  return { schemeId: event.schemeId!, revision: event.schemeRevision!, current: !!scheme && scheme.revision === event.schemeRevision, confirmedAt: event.createdAt.toISOString() };
}
export async function lockedRequest(client: PoolClient, id: string) {
  const [row] = await orm(client).select(requestColumns).from(finishRequests).where(eq(finishRequests.id, idSchema.parse(id))).for('update') as RequestRow[];
  if (!row) throw notFound(); return row;
}

/** Floor finish per room and a tread finish per stair, for spaces imported from drawings. */
export function derivedFinishes(scene: SceneSnapshot): Finish[] {
  return [...scene.rooms.map(room => ({ id: `finish-floor-${room.id}`, kind: 'floor' as const, name: `${room.name ?? '房间'}地面`, roomId: room.id })),
    ...(scene.stairs ?? []).map(stair => ({ id: `finish-stair-${stair.id}`, kind: 'stair' as const, name: '楼梯踏面', stairId: stair.id, risers: true }))];
}

/**
 * Generates and stores 2–3 schemes for the request's current project state, queues their renders, and returns whether
 * all are adoptable. Existing schemes of the request are replaced (only before publication).
 */
async function generate(client: PoolClient, row: RequestRow, state: SpatialState, projectRevision: number, deps: RequestDeps) {
  const catalog = await workspaceStones(client, row.workspace_id);
  const preferred = row.stones.map(ref => catalog.find(stone => stoneKey({ stoneId: stone.id, stoneVersion: stone.version }) === stoneKey(ref)))
    .filter((stone): stone is NonNullable<typeof stone> => !!stone);
  const schemes = generateSchemes(state.fixedFacts, row.finish_ids, preferred, catalog);
  const tx = orm(client);
  await tx.delete(finishSchemes).where(eq(finishSchemes.requestId, row.id));
  for (const [index, scheme] of schemes.entries()) {
    const id = randomUUID(), report = { adoptable: scheme.adoptable, issues: scheme.issues };
    await tx.insert(finishSchemes).values({ id, requestId: row.id, ordinal: index + 1, name: scheme.name, summary: scheme.summary, surfaceDesign: scheme.design, report });
    const renderId = await enqueueSchemeRender(client, { projectId: row.project_id, actorId: row.customer_id ?? row.created_by, projectRevision,
      state: spatialStateSchema.parse({ ...state, surfaceDesign: scheme.design }), scheme: { schemeId: id, revision: 1 }, label: `方案 ${scheme.name}` }, deps.renderQueue);
    await tx.update(finishSchemes).set({ renderId }).where(eq(finishSchemes.id, id));
    await tx.insert(finishSchemeRevisions).values({ schemeId: id, revision: 1, surfaceDesign: scheme.design, report, renderId });
  }
  return { count: schemes.length, adoptable: schemes.length >= 2 && schemes.every(s => s.adoptable) };
}
async function settle(client: PoolClient, row: RequestRow, result: { count: number; adoptable: boolean }, publishedBy: string | null) {
  const tx = orm(client), [workspace] = await tx.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, row.workspace_id));
  const settings = workspace.settings as { reviewAllRequests?: boolean };
  const reason = !result.count ? '没有可生成的铺贴方案' : !result.adoptable ? '方案未全部通过排版校验' : settings.reviewAllRequests && !publishedBy ? '企业设置为全部审核后发布' : null;
  if (reason && !publishedBy) await tx.update(finishRequests).set({ status: 'pending_review', reviewReason: reason, updatedAt: sql`now()` }).where(eq(finishRequests.id, row.id));
  else await tx.update(finishRequests).set({ status: 'published', reviewReason: null, publishedAt: sql`now()`, publishedBy, updatedAt: sql`now()` }).where(eq(finishRequests.id, row.id));
}

function planOf(facts: SpatialState['fixedFacts']): DemoVillaPlanView {
  const levels = effectiveLevels(facts);
  return {
    levels: levels.map((level, index) => ({ id: level.id, name: level.name ?? `${index + 1} 层` })),
    rooms: facts.rooms.map(room => ({ id: room.id, name: room.name ?? null, levelId: levelOf(room, levels), outline: room.outline })),
    walls: facts.walls.map(wall => ({ id: wall.id, levelId: levelOf(wall, levels), a: wall.a, b: wall.b })),
    stairs: (facts.stairs ?? []).map(stair => ({ id: stair.id, levelId: stair.fromLevelId,
      outline: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => stairToPlan(stair, { x: x * stair.width / 2, z: z * stair.depth / 2 })) })),
  };
}
/** Public: what a customer can choose from at an entry. */
export async function clientCatalog(slug: string): Promise<ClientCatalogView> {
  return transaction(async client => {
    const entry = await customerEntry(client, slug), state = initialState('demo-villa');
    return { workspace: { slug: entry.slug, name: entry.name }, stones: await workspaceStones(client, entry.id),
      demoVilla: { finishes: state.fixedFacts.finishes ?? [], plan: planOf(state.fixedFacts) } };
  });
}

/** A member prepares a demo-villa request for a customer (origin member, no customer until bound) and publishes it. */
export async function createMemberRequest(principal: Principal, workspaceId: string, input: unknown, deps: RequestDeps = {}): Promise<LeadView> {
  const value = createMemberRequestSchema.parse(input), userId = actorOf(principal), id = idSchema.parse(workspaceId), hash = sha({ workspaceId: id, ...value });
  const requestId = await transaction(async (client, tx) => {
    await memberOf(client, userId, id);
    await advisoryXactLock(tx, `finish-request:${userId}:${value.operationId}`);
    const [previous] = await tx.select({ id: finishRequests.id, requestHash: finishRequests.requestHash }).from(finishRequests)
      .where(and(eq(finishRequests.createdBy, userId), eq(finishRequests.requestId, value.operationId)));
    if (previous) {
      if (previous.requestHash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409);
      return previous.id;
    }
    const catalog = await workspaceStones(client, id);
    for (const ref of value.stones) if (!catalog.some(stone => stoneKey({ stoneId: stone.id, stoneVersion: stone.version }) === stoneKey(ref)))
      throw new DomainError('STONE_NOT_FOUND', '所选石材不在该企业的石材库中。', 404);
    const state = spatialStateSchema.parse({ ...initialState('demo-villa'), surfaceDesign: undefined });
    for (const finishId of value.finishIds) if (!state.fixedFacts.finishes?.some(finish => finish.id === finishId))
      throw new DomainError('FINISH_NOT_FOUND', '所选部位不在示例别墅中。', 404);
    const projectId = await insertProjectInTransaction(client, { workspaceId: id, createdBy: userId, name: value.name, state, operationId: value.operationId });
    const [row] = await tx.insert(finishRequests).values({ id: randomUUID(), workspaceId: id, customerId: null, createdBy: userId, origin: 'member', projectId,
      requestId: value.operationId, requestHash: hash, source: 'demo-villa', finishIds: value.finishIds, stones: value.stones, note: value.note ?? null, status: 'pending_review' })
      .returning(requestColumns) as RequestRow[];
    const result = await generate(client, row, state, 1, deps);
    await settle(client, row, result, result.adoptable ? userId : null);
    return row.id;
  });
  return (await listLeads(principal, id)).find(lead => lead.id === requestId)!;
}
export async function createFinishRequest(principal: Principal, slug: string, input: unknown, deps: RequestDeps = {}): Promise<FinishRequestView> {
  const value = createFinishRequestSchema.parse(input);
  return transaction(async (client, tx) => {
    const { userId, entry } = await customer(client, principal, slug), hash = sha({ slug, ...value });
    await advisoryXactLock(tx, `finish-request:${userId}:${value.operationId}`);
    const [previous] = await tx.select(requestColumns).from(finishRequests)
      .where(and(eq(finishRequests.createdBy, userId), eq(finishRequests.requestId, value.operationId))) as RequestRow[];
    if (previous) {
      if (previous.request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409);
      return view(client, previous, 'customer', slug);
    }
    const catalog = await workspaceStones(client, entry.id);
    for (const ref of value.stones) if (!catalog.some(stone => stoneKey({ stoneId: stone.id, stoneVersion: stone.version }) === stoneKey(ref)))
      throw new DomainError('STONE_NOT_FOUND', '所选石材不在该企业的石材库中。', 404);
    const demo = value.source === 'demo-villa', base = initialState(demo ? 'demo-villa' : 'empty');
    const state = spatialStateSchema.parse({ ...base, surfaceDesign: undefined });
    if (demo) for (const id of value.finishIds) if (!state.fixedFacts.finishes?.some(finish => finish.id === id))
      throw new DomainError('FINISH_NOT_FOUND', '所选部位不在示例别墅中。', 404);
    const projectId = await insertProjectInTransaction(client, { workspaceId: entry.id, createdBy: userId, name: demo ? '方案需求 · 示例别墅' : '方案需求 · 户型图纸', state, operationId: value.operationId });
    const [row] = await tx.insert(finishRequests).values({ id: randomUUID(), workspaceId: entry.id, customerId: userId, createdBy: userId, projectId,
      requestId: value.operationId, requestHash: hash, source: value.source, finishIds: demo ? value.finishIds : [], stones: value.stones, note: value.note ?? null,
      status: demo ? 'pending_review' : 'awaiting_drawing', preferences: value.preferences ?? null }).returning(requestColumns) as RequestRow[];
    if (demo) await settle(client, row, await generate(client, row, state, 1, deps), null);
    const [saved] = await tx.select(requestColumns).from(finishRequests).where(eq(finishRequests.id, row.id)) as RequestRow[];
    return view(client, saved, 'customer', slug);
  });
}

/** Customer uploads the drawing for a drawing request. DXF converts in the background; other formats wait for assistance. */
export async function uploadRequestDrawing(principal: Principal, slug: string, requestId: string, upload: { input: unknown; bytes: Uint8Array; fileName: string }, deps: RequestDeps = {}) {
  const row = await transaction(async client => {
    const { userId } = await customer(client, principal, slug), row = await lockedRequest(client, requestId);
    if (row.customer_id !== userId) throw notFound();
    if (row.source !== 'drawing' || row.status !== 'awaiting_drawing') throw new DomainError('DRAWING_NOT_EXPECTED', '这个方案需求不需要再上传图纸。', 409);
    return row;
  });
  const imported = await createFloorplanImport(principal, row.project_id, upload.input, upload.bytes, upload.fileName, { authorized: true, store: deps.store, queue: deps.importQueue });
  return transaction(async (client, tx) => {
    await tx.update(finishRequests).set({ floorplanImportId: imported.id, status: 'converting', updatedAt: sql`now()` })
      .where(and(eq(finishRequests.id, row.id), eq(finishRequests.status, 'awaiting_drawing')));
    return view(client, await lockedRequest(client, row.id), 'customer', slug);
  });
}

/** The request when the principal is its customer at this entry. */
export async function customerRequest(client: PoolClient, principal: Principal, slug: string, requestId: string) {
  const { userId, entry } = await customer(client, principal, slug), row = await lockedRequest(client, requestId);
  if (row.customer_id !== userId || row.workspace_id !== entry.id) throw notFound();
  return { row, userId };
}
export async function getFinishRequest(principal: Principal, slug: string, requestId: string) {
  return transaction(async client => view(client, (await customerRequest(client, principal, slug, requestId)).row, 'customer', slug));
}
export async function listMyFinishRequests(principal: Principal, slug: string) {
  return transaction(async (client, tx) => {
    const { userId, entry } = await customer(client, principal, slug);
    const rows = await tx.select(requestColumns).from(finishRequests).where(and(eq(finishRequests.customerId, userId), eq(finishRequests.workspaceId, entry.id)))
      .orderBy(desc(finishRequests.createdAt)).limit(50) as RequestRow[];
    return Promise.all(rows.map(row => view(client, row, 'customer', slug)));
  });
}
/** Published scheme image for the request's customer. */
export async function readSchemeImage(principal: Principal, slug: string, requestId: string, schemeId: string, store?: PrivateFileStore) {
  const { row, renderId } = await transaction(async (client, tx) => {
    const { userId, entry } = await customer(client, principal, slug), row = await lockedRequest(client, requestId);
    if (row.customer_id !== userId || row.workspace_id !== entry.id || row.status !== 'published') throw notFound();
    const [scheme] = await tx.select(schemeColumns).from(finishSchemes).where(and(eq(finishSchemes.id, idSchema.parse(schemeId)), eq(finishSchemes.requestId, row.id)));
    if (!scheme?.render_id) throw notFound();
    return { row, renderId: scheme.render_id };
  });
  return readRenderImage(row.project_id, renderId, store);
}

/** Frozen scene of a scheme's current render: the same snapshot the still was rendered from, for the 3D viewer. */
export async function renderScene(client: Pick<PoolClient, 'query'>, row: RequestRow, schemeId: string): Promise<SceneSnapshot> {
  const tx = ormOf(client), schemeKey = idSchema.parse(schemeId);
  const [scheme] = await tx.select({ render_id: finishSchemes.renderId }).from(finishSchemes).where(and(eq(finishSchemes.id, schemeKey), eq(finishSchemes.requestId, row.id)));
  if (!scheme?.render_id) throw notFound();
  const [render] = await tx.select({ snapshot: projectRenders.snapshot }).from(projectRenders)
    .where(and(eq(projectRenders.id, scheme.render_id), eq(projectRenders.projectId, row.project_id)));
  if (!render) throw notFound();
  return render.snapshot as SceneSnapshot;
}
/** Members: the frozen scene a scheme's still was rendered from (3D view in the workbench). */
export async function readLeadScene(principal: Principal, workspaceId: string, requestId: string, schemeId: string) {
  const userId = actorOf(principal);
  return transaction(async (client, tx) => {
    const [row] = await tx.select(requestColumns).from(finishRequests).where(eq(finishRequests.id, idSchema.parse(requestId))) as RequestRow[];
    if (!row || row.workspace_id !== idSchema.parse(workspaceId)) throw notFound();
    await memberOf(client, userId, row.workspace_id);
    return renderScene(client, row, schemeId);
  });
}
export async function readSchemeScene(principal: Principal, slug: string, requestId: string, schemeId: string) {
  return transaction(async (client, tx) => {
    const { userId, entry } = await customer(client, principal, slug);
    const [row] = await tx.select(requestColumns).from(finishRequests).where(eq(finishRequests.id, idSchema.parse(requestId))) as RequestRow[];
    if (!row || row.customer_id !== userId || row.workspace_id !== entry.id || row.status !== 'published') throw notFound();
    return renderScene(client, row, schemeId);
  });
}

/**
 * Leads (线索) of a workspace, for members, newest first (200 at most). Filters: follow status and contact requests in
 * the query; the request status (which for drawings depends on the import) after building the views.
 */
export async function listLeads(principal: Principal, workspaceId: string, filters: unknown = {}): Promise<LeadView[]> {
  const userId = actorOf(principal), id = idSchema.parse(workspaceId), filter = leadFilterSchema.parse(filters);
  return transaction(async (client, tx) => {
    await memberOf(client, userId, id);
    const contact = sql`EXISTS (SELECT 1 FROM ${finishRequestEvents} WHERE ${finishRequestEvents.requestId} = ${finishRequests.id} AND ${finishRequestEvents.contactRequested})`;
    const rows = await tx.select({ ...requestColumns, follow_status: finishRequests.followStatus, phone_number: hestiaAuthUser.phoneNumber, name: hestiaAuthUser.name }).from(finishRequests)
      .leftJoin(hestiaAuthUser, eq(hestiaAuthUser.id, finishRequests.customerId))
      .where(and(eq(finishRequests.workspaceId, id), filter.follow ? eq(finishRequests.followStatus, filter.follow) : undefined, filter.contact ? contact : undefined))
      .orderBy(desc(finishRequests.createdAt)).limit(200) as (RequestRow & { follow_status: string; phone_number: string | null; name: string | null })[];
    const leads = await Promise.all(rows.map(async row => {
      const base = { ...await view(client, row, 'member'), reviewReason: row.review_reason,
        origin: row.origin, customer: row.customer_id ? { userId: row.customer_id, phone: row.phone_number, name: row.name } : null,
        sharing: await sharingOf(client, row.id), follow: await followOf(client, row.id, row.follow_status),
        events: (await tx.select().from(finishRequestEvents).where(eq(finishRequestEvents.requestId, row.id)).orderBy(asc(finishRequestEvents.createdAt)))
          .map(event => ({ id: event.id, kind: event.kind as 'confirmation' | 'message', schemeId: event.schemeId, schemeRevision: event.schemeRevision, message: event.message,
            contactRequested: event.contactRequested, preferredTime: event.preferredTime, createdAt: event.createdAt.toISOString() })) };
      return { ...base, contactRequested: base.events.some(event => event.contactRequested), lastCustomerAction: lastCustomerAction(base) };
    }));
    return filter.status ? leads.filter(lead => lead.status === filter.status) : leads;
  });
}

/**
 * Member review: publish a pending request. A drawing request first takes the reviewed import candidate as the
 * project's space (floor and stair finishes derived), then schemes are generated. Only adoptable schemes are kept.
 */
export async function publishFinishRequest(principal: Principal, workspaceId: string, requestId: string, input: unknown, deps: RequestDeps = {}): Promise<LeadView> {
  const userId = actorOf(principal), value = publishFinishRequestSchema.parse(input), hash = sha({ kind: 'publish-request', requestId, ...value });
  const id = await transaction(async (client, tx) => {
    await advisoryXactLock(tx, `${userId}:${value.operationId}`);
    const row = await lockedRequest(client, requestId);
    if (row.workspace_id !== idSchema.parse(workspaceId)) throw notFound();
    await memberOf(client, userId, row.workspace_id);
    const [previous] = await tx.select({ requestHash: operations.requestHash }).from(operations).where(and(eq(operations.actorId, userId), eq(operations.id, value.operationId)));
    if (previous) { if (previous.requestHash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409); return row.id; }
    if (row.status === 'published') throw new DomainError('ALREADY_PUBLISHED', '方案已发布。', 409);
    if (row.source === 'drawing' && (await importStatus(client, row)) !== 'pending_review') throw new DomainError('DRAWING_NOT_READY', '图纸尚未转换完成，请先完成转换或辅助导入户型。', 409);
    const hasSchemes = async () => (await tx.select({ one: sql`1` }).from(finishSchemes).where(eq(finishSchemes.requestId, row.id)).limit(1)).length > 0;
    if (row.source === 'drawing' && !(await hasSchemes())) {
      const candidate = await getFloorplanCandidate({ userId }, row.project_id, row.floorplan_import_id!);
      if (!candidate.valid || !candidate.scene) throw new DomainError('DRAWING_INVALID', '图纸候选未通过校验，请先修正或辅助导入户型。', 409);
      const scene = candidate.scene as SceneSnapshot, finishes = derivedFinishes(scene);
      const state = stateFromScene({ ...scene, finishes }, candidate.scale.status === 'calibrated' ? 'calibrated' : 'estimated');
      const [{ revision }] = await tx.update(projects).set({ snapshot: state, revision: sql`${projects.revision}+1`, updatedAt: sql`now()` })
        .where(eq(projects.id, row.project_id)).returning({ revision: projects.revision });
      await tx.insert(projectRevisions).values({ projectId: row.project_id, revision, snapshot: state, operationId: value.operationId });
      await tx.update(finishRequests).set({ finishIds: finishes.map(finish => finish.id) }).where(eq(finishRequests.id, row.id));
      row.finish_ids = finishes.map(finish => finish.id);
      await generate(client, row, state, revision, deps);
    }
    await tx.delete(finishSchemes).where(and(eq(finishSchemes.requestId, row.id), sql`NOT (${finishSchemes.report}->>'adoptable')::boolean`));
    if (!(await hasSchemes())) throw new DomainError('NO_ADOPTABLE_SCHEME', '没有通过校验的方案可以发布。', 409);
    await settle(client, row, { count: 1, adoptable: true }, userId);
    await tx.insert(operations).values({ actorId: userId, id: value.operationId, projectId: row.project_id, requestHash: hash, result: { requestId: row.id } });
    return row.id;
  });
  return (await listLeads(principal, workspaceId)).find(lead => lead.id === id)!;
}
