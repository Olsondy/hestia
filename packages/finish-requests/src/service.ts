import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { PgBoss } from 'pg-boss';
import { DomainError, idSchema, spatialStateSchema, type SpatialState } from '../../contracts/src/project';
import { effectiveLevels, levelOf, stairToPlan } from '../../contracts/src/building';
import type { Finish } from '../../contracts/src/finishes';
import type { SceneSnapshot } from '../../contracts/src/scene';
import { createFinishRequestSchema, createMemberRequestSchema, publishFinishRequestSchema, type ClientCatalogView, type DemoVillaPlanView, type FinishRequestStatus, type FinishRequestView,
  type RequestFinishView, type RequestPreferences,
  type FinishSchemeView, type LeadView } from '../../contracts/src/finish-requests';
import { pool, transaction } from '../../persistence/src/client';
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

export type RequestRow = {
  id: string; workspace_id: string; customer_id: string | null; created_by: string; origin: 'customer' | 'member'; project_id: string; request_id: string; request_hash: string;
  source: 'demo-villa' | 'drawing'; floorplan_import_id: string | null; finish_ids: string[]; stones: { stoneId: string; stoneVersion: number }[];
  note: string | null; preferences: RequestPreferences | null; status: 'awaiting_drawing' | 'converting' | 'pending_review' | 'published'; review_reason: string | null;
  published_at: Date | null; published_by: string | null; created_at: Date; updated_at: Date;
};
export type SchemeRow = { id: string; request_id: string; ordinal: number; name: string; summary: string; revision: number;
  surface_design: FinishSchemeView['surfaceDesign']; report: { adoptable: boolean; issues: FinishSchemeView['issues'] }; render_id: string | null };
export type RequestDeps = { renderQueue?: PgBoss; importQueue?: PgBoss; store?: PrivateFileStore };

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
  if (!(await client.query('SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2', [workspaceId, userId])).rowCount) throw notFound();
}
async function importStatus(client: Pick<PoolClient, 'query'>, row: RequestRow): Promise<FinishRequestStatus> {
  if (row.status !== 'converting' || !row.floorplan_import_id) return row.status;
  const status = (await client.query<{ status: string }>('SELECT status FROM floorplan_imports WHERE id=$1', [row.floorplan_import_id])).rows[0]?.status;
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
  const status = await importStatus(client, row);
  const project = (await client.query<{ name: string; snapshot: unknown }>('SELECT name,snapshot FROM projects WHERE id=$1', [row.project_id])).rows[0];
  const drawingName = row.floorplan_import_id
    ? (await client.query<{ file_name: string }>('SELECT file_name FROM floorplan_imports WHERE id=$1', [row.floorplan_import_id])).rows[0]?.file_name ?? null : null;
  const facts = spatialStateSchema.parse(project.snapshot).fixedFacts;
  const schemes = audience === 'customer' && row.status !== 'published' ? []
    : (await client.query<SchemeRow>('SELECT * FROM finish_schemes WHERE request_id=$1 ORDER BY ordinal', [row.id])).rows;
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
  const event = (await client.query<{ scheme_id: string; scheme_revision: number; created_at: Date }>(
    "SELECT scheme_id,scheme_revision,created_at FROM finish_request_events WHERE request_id=$1 AND kind='confirmation' ORDER BY created_at DESC LIMIT 1", [requestId])).rows[0];
  if (!event) return null;
  const scheme = schemes.find(s => s.id === event.scheme_id);
  return { schemeId: event.scheme_id, revision: event.scheme_revision, current: !!scheme && scheme.revision === event.scheme_revision, confirmedAt: event.created_at.toISOString() };
}
export async function lockedRequest(client: PoolClient, id: string) {
  const row = (await client.query<RequestRow>('SELECT * FROM finish_requests WHERE id=$1 FOR UPDATE', [idSchema.parse(id)])).rows[0];
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
  await client.query('DELETE FROM finish_schemes WHERE request_id=$1', [row.id]);
  for (const [index, scheme] of schemes.entries()) {
    const id = randomUUID();
    await client.query('INSERT INTO finish_schemes(id,request_id,ordinal,name,summary,surface_design,report) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id, row.id, index + 1, scheme.name, scheme.summary, scheme.design, { adoptable: scheme.adoptable, issues: scheme.issues }]);
    const renderId = await enqueueSchemeRender(client, { projectId: row.project_id, actorId: row.customer_id ?? row.created_by, projectRevision,
      state: spatialStateSchema.parse({ ...state, surfaceDesign: scheme.design }), scheme: { schemeId: id, revision: 1 }, label: `方案 ${scheme.name}` }, deps.renderQueue);
    await client.query('UPDATE finish_schemes SET render_id=$1 WHERE id=$2', [renderId, id]);
    await client.query('INSERT INTO finish_scheme_revisions(scheme_id,revision,surface_design,report,render_id) VALUES($1,1,$2,$3,$4)',
      [id, scheme.design, { adoptable: scheme.adoptable, issues: scheme.issues }, renderId]);
  }
  return { count: schemes.length, adoptable: schemes.length >= 2 && schemes.every(s => s.adoptable) };
}
async function settle(client: PoolClient, row: RequestRow, result: { count: number; adoptable: boolean }, publishedBy: string | null) {
  const settings = (await client.query<{ settings: { reviewAllRequests?: boolean } }>('SELECT settings FROM workspaces WHERE id=$1', [row.workspace_id])).rows[0].settings;
  const reason = !result.count ? '没有可生成的铺贴方案' : !result.adoptable ? '方案未全部通过排版校验' : settings.reviewAllRequests && !publishedBy ? '企业设置为全部审核后发布' : null;
  if (reason && !publishedBy) await client.query("UPDATE finish_requests SET status='pending_review',review_reason=$2,updated_at=now() WHERE id=$1", [row.id, reason]);
  else await client.query("UPDATE finish_requests SET status='published',review_reason=NULL,published_at=now(),published_by=$2,updated_at=now() WHERE id=$1", [row.id, publishedBy]);
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
  const requestId = await transaction(async client => {
    await memberOf(client, userId, id);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`finish-request:${userId}:${value.operationId}`]);
    const previous = (await client.query<RequestRow>('SELECT * FROM finish_requests WHERE created_by=$1 AND request_id=$2', [userId, value.operationId])).rows[0];
    if (previous) {
      if (previous.request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409);
      return previous.id;
    }
    const catalog = await workspaceStones(client, id);
    for (const ref of value.stones) if (!catalog.some(stone => stoneKey({ stoneId: stone.id, stoneVersion: stone.version }) === stoneKey(ref)))
      throw new DomainError('STONE_NOT_FOUND', '所选石材不在该企业的石材库中。', 404);
    const state = spatialStateSchema.parse({ ...initialState('demo-villa'), surfaceDesign: undefined });
    for (const finishId of value.finishIds) if (!state.fixedFacts.finishes?.some(finish => finish.id === finishId))
      throw new DomainError('FINISH_NOT_FOUND', '所选部位不在示例别墅中。', 404);
    const projectId = await insertProjectInTransaction(client, { workspaceId: id, createdBy: userId, name: value.name, state, operationId: value.operationId });
    const row = (await client.query<RequestRow>(`INSERT INTO finish_requests(id,workspace_id,customer_id,created_by,origin,project_id,request_id,request_hash,source,finish_ids,stones,note,status)
      VALUES($1,$2,NULL,$3,'member',$4,$5,$6,'demo-villa',$7,$8,$9,'pending_review') RETURNING *`, [randomUUID(), id, userId, projectId, value.operationId, hash,
      JSON.stringify(value.finishIds), JSON.stringify(value.stones), value.note ?? null])).rows[0];
    const result = await generate(client, row, state, 1, deps);
    await settle(client, row, result, result.adoptable ? userId : null);
    return row.id;
  });
  return (await listLeads(principal, id)).find(lead => lead.id === requestId)!;
}
export async function createFinishRequest(principal: Principal, slug: string, input: unknown, deps: RequestDeps = {}): Promise<FinishRequestView> {
  const value = createFinishRequestSchema.parse(input);
  return transaction(async client => {
    const { userId, entry } = await customer(client, principal, slug), hash = sha({ slug, ...value });
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`finish-request:${userId}:${value.operationId}`]);
    const previous = (await client.query<RequestRow>('SELECT * FROM finish_requests WHERE created_by=$1 AND request_id=$2', [userId, value.operationId])).rows[0];
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
    const row = (await client.query<RequestRow>(`INSERT INTO finish_requests(id,workspace_id,customer_id,created_by,project_id,request_id,request_hash,source,finish_ids,stones,note,status,preferences)
      VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [randomUUID(), entry.id, userId, projectId, value.operationId, hash, value.source,
      JSON.stringify(demo ? value.finishIds : []), JSON.stringify(value.stones), value.note ?? null, demo ? 'pending_review' : 'awaiting_drawing',
      value.preferences ? JSON.stringify(value.preferences) : null])).rows[0];
    if (demo) await settle(client, row, await generate(client, row, state, 1, deps), null);
    return view(client, (await client.query<RequestRow>('SELECT * FROM finish_requests WHERE id=$1', [row.id])).rows[0], 'customer', slug);
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
  return transaction(async client => {
    await client.query("UPDATE finish_requests SET floorplan_import_id=$2,status='converting',updated_at=now() WHERE id=$1 AND status='awaiting_drawing'", [row.id, imported.id]);
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
  return transaction(async client => {
    const { userId, entry } = await customer(client, principal, slug);
    const rows = (await client.query<RequestRow>('SELECT * FROM finish_requests WHERE customer_id=$1 AND workspace_id=$2 ORDER BY created_at DESC LIMIT 50', [userId, entry.id])).rows;
    return Promise.all(rows.map(row => view(client, row, 'customer', slug)));
  });
}
/** Published scheme image for the request's customer. */
export async function readSchemeImage(principal: Principal, slug: string, requestId: string, schemeId: string, store?: PrivateFileStore) {
  const { row, renderId } = await transaction(async client => {
    const { userId, entry } = await customer(client, principal, slug), row = await lockedRequest(client, requestId);
    if (row.customer_id !== userId || row.workspace_id !== entry.id || row.status !== 'published') throw notFound();
    const scheme = (await client.query<SchemeRow>('SELECT * FROM finish_schemes WHERE id=$1 AND request_id=$2', [idSchema.parse(schemeId), row.id])).rows[0];
    if (!scheme?.render_id) throw notFound();
    return { row, renderId: scheme.render_id };
  });
  return readRenderImage(row.project_id, renderId, store);
}

/** Frozen scene of a scheme's current render: the same snapshot the still was rendered from, for the 3D viewer. */
export async function renderScene(client: Pick<PoolClient, 'query'>, row: RequestRow, schemeId: string): Promise<SceneSnapshot> {
  const scheme = (await client.query<SchemeRow>('SELECT * FROM finish_schemes WHERE id=$1 AND request_id=$2', [idSchema.parse(schemeId), row.id])).rows[0];
  if (!scheme?.render_id) throw notFound();
  const render = (await client.query<{ snapshot: SceneSnapshot }>('SELECT snapshot FROM project_renders WHERE id=$1 AND project_id=$2', [scheme.render_id, row.project_id])).rows[0];
  if (!render) throw notFound();
  return render.snapshot;
}
export async function readSchemeScene(principal: Principal, slug: string, requestId: string, schemeId: string) {
  return transaction(async client => {
    const { userId, entry } = await customer(client, principal, slug), row = (await client.query<RequestRow>('SELECT * FROM finish_requests WHERE id=$1', [idSchema.parse(requestId)])).rows[0];
    if (!row || row.customer_id !== userId || row.workspace_id !== entry.id || row.status !== 'published') throw notFound();
    return renderScene(client, row, schemeId);
  });
}

/** Leads (线索) of a workspace, for members. */
export async function listLeads(principal: Principal, workspaceId: string): Promise<LeadView[]> {
  const userId = actorOf(principal), id = idSchema.parse(workspaceId);
  return transaction(async client => {
    await memberOf(client, userId, id);
    const rows = (await client.query<RequestRow & { phone_number: string | null; name: string | null }>(`SELECT r.*,u.phone_number,u.name FROM finish_requests r
      LEFT JOIN hestia_auth_user u ON u.id=r.customer_id WHERE r.workspace_id=$1 ORDER BY r.created_at DESC LIMIT 200`, [id])).rows;
    return Promise.all(rows.map(async row => ({ ...await view(client, row, 'member'), reviewReason: row.review_reason,
      origin: row.origin, customer: row.customer_id ? { userId: row.customer_id, phone: row.phone_number, name: row.name } : null,
      sharing: await sharingOf(client, row.id),
      events: (await client.query<{ id: string; kind: 'confirmation' | 'message'; scheme_id: string | null; scheme_revision: number | null; message: string | null;
        contact_requested: boolean; preferred_time: string | null; created_at: Date }>('SELECT * FROM finish_request_events WHERE request_id=$1 ORDER BY created_at', [row.id])).rows
        .map(event => ({ id: event.id, kind: event.kind, schemeId: event.scheme_id, schemeRevision: event.scheme_revision, message: event.message,
          contactRequested: event.contact_requested, preferredTime: event.preferred_time, createdAt: event.created_at.toISOString() })) })));
  });
}

/**
 * Member review: publish a pending request. A drawing request first takes the reviewed import candidate as the
 * project's space (floor and stair finishes derived), then schemes are generated. Only adoptable schemes are kept.
 */
export async function publishFinishRequest(principal: Principal, workspaceId: string, requestId: string, input: unknown, deps: RequestDeps = {}): Promise<LeadView> {
  const userId = actorOf(principal), value = publishFinishRequestSchema.parse(input), hash = sha({ kind: 'publish-request', requestId, ...value });
  const id = await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${userId}:${value.operationId}`]);
    const row = await lockedRequest(client, requestId);
    if (row.workspace_id !== idSchema.parse(workspaceId)) throw notFound();
    await memberOf(client, userId, row.workspace_id);
    const previous = (await client.query('SELECT request_hash FROM operations WHERE actor_id=$1 AND id=$2', [userId, value.operationId])).rows[0];
    if (previous) { if (previous.request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409); return row.id; }
    if (row.status === 'published') throw new DomainError('ALREADY_PUBLISHED', '方案已发布。', 409);
    if (row.source === 'drawing' && (await importStatus(client, row)) !== 'pending_review') throw new DomainError('DRAWING_NOT_READY', '图纸尚未转换完成，请先完成转换或辅助导入户型。', 409);
    if (row.source === 'drawing' && !(await client.query('SELECT 1 FROM finish_schemes WHERE request_id=$1', [row.id])).rowCount) {
      const candidate = await getFloorplanCandidate({ userId }, row.project_id, row.floorplan_import_id!);
      if (!candidate.valid || !candidate.scene) throw new DomainError('DRAWING_INVALID', '图纸候选未通过校验，请先修正或辅助导入户型。', 409);
      const scene = candidate.scene as SceneSnapshot, finishes = derivedFinishes(scene);
      const state = stateFromScene({ ...scene, finishes }, candidate.scale.status === 'calibrated' ? 'calibrated' : 'estimated');
      const revision = (await client.query<{ revision: number }>('UPDATE projects SET snapshot=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING revision', [row.project_id, state])).rows[0].revision;
      await client.query('INSERT INTO project_revisions(project_id,revision,snapshot,operation_id) VALUES($1,$2,$3,$4)', [row.project_id, revision, state, value.operationId]);
      await client.query('UPDATE finish_requests SET finish_ids=$2 WHERE id=$1', [row.id, JSON.stringify(finishes.map(finish => finish.id))]);
      row.finish_ids = finishes.map(finish => finish.id);
      await generate(client, row, state, revision, deps);
    }
    await client.query("DELETE FROM finish_schemes WHERE request_id=$1 AND NOT (report->>'adoptable')::boolean", [row.id]);
    if (!(await client.query('SELECT 1 FROM finish_schemes WHERE request_id=$1', [row.id])).rowCount) throw new DomainError('NO_ADOPTABLE_SCHEME', '没有通过校验的方案可以发布。', 409);
    await settle(client, row, { count: 1, adoptable: true }, userId);
    await client.query('INSERT INTO operations(actor_id,id,project_id,request_hash,result) VALUES($1,$2,$3,$4,$5)', [userId, value.operationId, row.project_id, hash, { requestId: row.id }]);
    return row.id;
  });
  return (await listLeads(principal, workspaceId)).find(lead => lead.id === id)!;
}
