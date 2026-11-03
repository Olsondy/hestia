import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DomainError, idSchema, spatialStateSchema } from '../../contracts/src/project';
import { surfaceDesignSchema, type Finish, type StoneSpec, type SurfaceDesign, type Tiling, type TilePattern } from '../../contracts/src/finishes';
import { adjustSchemeSchema, confirmSchemeSchema, requestMessageSchema, undoSchemeSchema, type FinishRequestView, type SchemeOptionsView } from '../../contracts/src/finish-requests';
import { and, eq, sql } from 'drizzle-orm';
import { advisoryXactLock, orm, transaction } from '../../persistence/src/client';
import { finishRequestEvents, finishRequestOperations, finishRequests, finishSchemeRevisions, finishSchemes, projects } from '../../persistence/src/schema';
import type { Principal } from '../../workspaces/src/access';
import { workspaceStones } from '../../finishes/src/catalog';
import { inspectSurfaceDesign, stoneKey } from '../../finishes/src/plan';
import { enqueueSchemeRender } from '../../renders/src/service';
import { customerRequest, requestColumns, schemeColumns, view, type RequestDeps, type RequestRow, type SchemeRow } from './service';

// D07: option-based adjustment of published schemes. Every change is a new scheme revision checked by the layout engine
// and rendered in the background; undo restores the previous revision (re-using its image); confirmation binds one
// revision. No free geometry editing and no generative AI.

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const SIZES: [number, number][] = [[1.2, 1.2], [.8, .8], [.6, .6], [1.2, .6], [.9, .6], [1.2, .4], [1.2, .3], [.6, .3], [.6, .2]];
const PATTERNS: Record<Finish['kind'], TilePattern[]> = { floor: ['straight', 'running-bond', 'diagonal', 'herringbone'], wall: ['straight', 'running-bond'], stair: ['straight'] };
const fits = (stone: StoneSpec, [length, width]: [number, number]) =>
  length >= stone.sizes.length.min && length <= stone.sizes.length.max && width >= stone.sizes.width.min && width <= stone.sizes.width.max;
const sizesFor = (stone: StoneSpec, kind: Finish['kind']) => SIZES.filter(size => fits(stone, size) && (kind !== 'stair' || size[1] <= .4) && (kind === 'floor' || size[0] !== size[1]));
const brightness = (stone: StoneSpec) => [1, 3, 5].reduce((sum, i) => sum + parseInt(stone.texture.base.slice(i, i + 2), 16), 0);

/** Idempotent customer mutation on a published request; the result is stored per operation. */
async function mutate<T>(principal: Principal, slug: string, requestId: string, kind: string, input: { operationId: string } & Record<string, unknown>, work: (client: PoolClient, row: RequestRow, userId: string) => Promise<T>) {
  return transaction(async (client, tx) => {
    const { row, userId } = await customerRequest(client, principal, slug, requestId), hash = sha({ kind, requestId, ...input });
    await advisoryXactLock(tx, `finish-request-op:${userId}:${input.operationId}`);
    const [previous] = await tx.select({ requestHash: finishRequestOperations.requestHash }).from(finishRequestOperations)
      .where(and(eq(finishRequestOperations.actorId, userId), eq(finishRequestOperations.id, input.operationId)));
    if (previous) {
      if (previous.requestHash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409);
    } else {
      if (row.status !== 'published') throw new DomainError('NOT_PUBLISHED', '方案尚未发布，暂不能调整或确认。', 409);
      const result = await work(client, row, userId);
      await tx.insert(finishRequestOperations).values({ actorId: userId, id: input.operationId, requestId: row.id, requestHash: hash, result: result ?? {} });
    }
    const [saved] = await tx.select(requestColumns).from(finishRequests).where(eq(finishRequests.id, row.id)) as RequestRow[];
    return view(client, saved, 'customer', slug);
  });
}
async function lockedScheme(client: PoolClient, row: RequestRow, schemeId: string) {
  const [scheme] = await orm(client).select(schemeColumns).from(finishSchemes)
    .where(and(eq(finishSchemes.id, idSchema.parse(schemeId)), eq(finishSchemes.requestId, row.id))).for('update') as SchemeRow[];
  if (!scheme) throw new DomainError('NOT_FOUND', '方案不存在。', 404);
  return scheme;
}
async function projectState(client: PoolClient, projectId: string) {
  const [project] = await orm(client).select({ revision: projects.revision, snapshot: projects.snapshot }).from(projects).where(eq(projects.id, projectId));
  return { revision: project.revision, state: spatialStateSchema.parse(project.snapshot) };
}
async function saveRevision(client: PoolClient, row: RequestRow, scheme: SchemeRow, design: SurfaceDesign, report: SchemeRow['report'], userId: string,
  change: unknown, renderId: string | null, deps: RequestDeps) {
  const revision = scheme.revision + 1, { revision: projectRevision, state } = await projectState(client, row.project_id);
  const render = renderId ?? await enqueueSchemeRender(client, { projectId: row.project_id, actorId: userId, projectRevision,
    state: spatialStateSchema.parse({ ...state, surfaceDesign: design }), scheme: { schemeId: scheme.id, revision }, label: `方案 ${scheme.name} · 调整 ${revision}` }, deps.renderQueue);
  const tx = orm(client);
  await tx.update(finishSchemes).set({ revision, surfaceDesign: design, report, renderId: render, updatedAt: sql`now()` }).where(eq(finishSchemes.id, scheme.id));
  await tx.insert(finishSchemeRevisions).values({ schemeId: scheme.id, revision, surfaceDesign: design, report, renderId: render, change, createdBy: userId });
  await tx.update(finishRequests).set({ updatedAt: sql`now()` }).where(eq(finishRequests.id, row.id));
}

/** What the customer may choose for each finish of a scheme. */
export async function schemeOptions(principal: Principal, slug: string, requestId: string, schemeId: string): Promise<SchemeOptionsView> {
  return transaction(async client => {
    const { row } = await customerRequest(client, principal, slug, requestId);
    if (row.status !== 'published') throw new DomainError('NOT_PUBLISHED', '方案尚未发布。', 409);
    const scheme = await lockedScheme(client, row, schemeId), { state } = await projectState(client, row.project_id), catalog = await workspaceStones(client, row.workspace_id);
    const finishes = row.finish_ids.map(id => state.fixedFacts.finishes?.find(finish => finish.id === id)).filter((f): f is Finish => !!f);
    return { schemeId: scheme.id, revision: scheme.revision, finishes: finishes.map(finish => {
      const tiling = scheme.surface_design.tilings.find(t => t.finishId === finish.id);
      return { finishId: finish.id, name: finish.name ?? finish.id, kind: finish.kind,
        current: tiling ? { stoneId: tiling.stoneId, stoneVersion: tiling.stoneVersion, tile: tiling.tile, pattern: tiling.pattern, border: !!tiling.border } : null,
        stones: catalog.map(stone => ({ stoneId: stone.id, stoneVersion: stone.version, name: stone.name, sizes: sizesFor(stone, finish.kind).map(([length, width]) => ({ length, width })) }))
          .filter(stone => stone.sizes.length),
        patterns: PATTERNS[finish.kind], border: finish.kind === 'floor' };
    }) };
  });
}

/** One option change. Rejected choices return the layout engine's reasons and leave the scheme unchanged. */
export async function adjustScheme(principal: Principal, slug: string, requestId: string, schemeId: string, input: unknown, deps: RequestDeps = {}): Promise<FinishRequestView> {
  const value = adjustSchemeSchema.parse(input);
  return mutate(principal, slug, requestId, 'adjust', { ...value, schemeId }, async (client, row, userId) => {
    const scheme = await lockedScheme(client, row, schemeId);
    if (scheme.revision !== value.expectedRevision) throw new DomainError('SCHEME_REVISION_CONFLICT', '方案已有新版本，请刷新后再调整。', 409);
    if (!row.finish_ids.includes(value.finishId)) throw new DomainError('FINISH_NOT_FOUND', '该部位不在这个方案需求中。', 404);
    const { state } = await projectState(client, row.project_id), finish = state.fixedFacts.finishes!.find(f => f.id === value.finishId)!;
    const catalog = await workspaceStones(client, row.workspace_id), current = scheme.surface_design.tilings.find(t => t.finishId === value.finishId);
    const ref = value.stone ?? (current ? { stoneId: current.stoneId, stoneVersion: current.stoneVersion } : undefined);
    const stone = ref && catalog.find(item => stoneKey({ stoneId: item.id, stoneVersion: item.version }) === stoneKey(ref));
    if (!stone) throw new DomainError('STONE_NOT_AVAILABLE', '所选石材不在企业石材库中或已下架。', 409);
    const pattern = value.pattern ?? current?.pattern ?? 'straight';
    if (!PATTERNS[finish.kind].includes(pattern)) throw new DomainError('OPTION_NOT_ALLOWED', '该部位不提供这种铺法。', 400);
    const sizes = sizesFor(stone, finish.kind), requested = value.tile ?? current?.tile;
    const size = requested && sizes.find(([l, w]) => Math.abs(l - requested.length) < 1e-9 && Math.abs(w - requested.width) < 1e-9);
    const tile = size ?? (value.tile ? undefined : sizes[0]);
    if (!tile) throw new DomainError('OPTION_NOT_ALLOWED', '这款石材不提供所选规格。', 400);
    const wantsBorder = value.border ?? !!current?.border;
    if (wantsBorder && finish.kind !== 'floor') throw new DomainError('OPTION_NOT_ALLOWED', '只有地面可以加波打线。', 400);
    const borderStone = [...catalog].sort((a, b) => brightness(a) - brightness(b)).find(item => item.id !== stone.id);
    const tiling: Tiling = { finishId: finish.id, stoneId: stone.id, stoneVersion: stone.version, tile: { length: tile[0], width: tile[1] }, pattern,
      joint: current?.joint ?? { width: .002, color: stone.texture.cloud }, origin: current?.origin ?? (finish.kind === 'stair' ? 'edge' : 'center'), angle: current?.angle ?? 0,
      ...(wantsBorder && borderStone ? { border: { stoneId: borderStone.id, stoneVersion: borderStone.version, width: current?.border?.width ?? .18, pieceLength: current?.border?.pieceLength ?? .6 } } : {}) };
    const tilings = [...scheme.surface_design.tilings.filter(t => t.finishId !== finish.id), tiling].sort((a, b) => a.finishId.localeCompare(b.finishId));
    const used = new Set(tilings.flatMap(t => [stoneKey(t), ...t.border ? [stoneKey(t.border)] : []]));
    const stones = [...new Map([...scheme.surface_design.stones, ...catalog].map(s => [stoneKey({ stoneId: s.id, stoneVersion: s.version }), s])).values()]
      .filter(s => used.has(stoneKey({ stoneId: s.id, stoneVersion: s.version }))).sort((a, b) => a.id.localeCompare(b.id));
    const design = surfaceDesignSchema.parse({ version: 1, stones, tilings });
    if (JSON.stringify(design) === JSON.stringify(scheme.surface_design)) throw new DomainError('NO_CHANGE', '方案没有变化。');
    const report = inspectSurfaceDesign(state.fixedFacts, design, r => { const s = catalog.find(c => c.id === r.stoneId && c.version === r.stoneVersion); return s ? { status: 'active', spec: s } : undefined; },
      { changedFinishIds: [finish.id] });
    if (!report.adoptable) throw new DomainError('ADJUSTMENT_REJECTED', report.issues.find(i => i.severity === 'conflict')?.message ?? '这个组合无法排版。', 409,
      { issues: report.issues });
    await saveRevision(client, row, scheme, design, { adoptable: true, issues: report.issues.map(i => ({ code: i.code, objectId: i.objectId, message: i.message })) },
      userId, { parent: scheme.revision, finishId: finish.id, stone: ref, tile: tiling.tile, pattern, border: wantsBorder }, null, deps);
    return { schemeId: scheme.id };
  });
}

/** Undo: a new revision equal to the previous one, re-using that revision's image (no new render). */
export async function undoSchemeAdjustment(principal: Principal, slug: string, requestId: string, schemeId: string, input: unknown, deps: RequestDeps = {}) {
  const value = undoSchemeSchema.parse(input);
  return mutate(principal, slug, requestId, 'undo', { ...value, schemeId }, async (client, row, userId) => {
    const scheme = await lockedScheme(client, row, schemeId);
    if (scheme.revision !== value.expectedRevision) throw new DomainError('SCHEME_REVISION_CONFLICT', '方案已有新版本，请刷新后再撤回。', 409);
    // Each revision records the revision it was derived from (`parent`); undo returns to that content, so repeated
    // undo keeps stepping back through real adjustments.
    type Revision = { revision: number; surface_design: SurfaceDesign; report: SchemeRow['report']; render_id: string | null; change: { parent?: number } | null };
    const revisions = await orm(client).select({ revision: finishSchemeRevisions.revision, surface_design: finishSchemeRevisions.surfaceDesign, report: finishSchemeRevisions.report,
      render_id: finishSchemeRevisions.renderId, change: finishSchemeRevisions.change }).from(finishSchemeRevisions).where(eq(finishSchemeRevisions.schemeId, scheme.id)) as Revision[];
    const latest = revisions.find(r => r.revision === scheme.revision), target = revisions.find(r => r.revision === latest?.change?.parent);
    if (!target) throw new DomainError('NOTHING_TO_UNDO', '已经是最初的方案。', 409);
    await saveRevision(client, row, scheme, target.surface_design, target.report, userId, { parent: target.change?.parent, undoOf: scheme.revision }, target.render_id, deps);
    return { schemeId: scheme.id };
  });
}

/** Confirm one scheme revision; may carry a message and contact request. Later adjustments need a new confirmation. */
export async function confirmScheme(principal: Principal, slug: string, requestId: string, input: unknown) {
  const value = confirmSchemeSchema.parse(input);
  return mutate(principal, slug, requestId, 'confirm', value, async (client, row, userId) => {
    const scheme = await lockedScheme(client, row, value.schemeId);
    if (scheme.revision !== value.revision) throw new DomainError('SCHEME_REVISION_CONFLICT', '方案已有新版本，请查看最新效果后再确认。', 409);
    await orm(client).insert(finishRequestEvents).values({ id: randomUUID(), requestId: row.id, actorId: userId, kind: 'confirmation', schemeId: scheme.id,
      schemeRevision: scheme.revision, surfaceDesign: scheme.surface_design, message: value.message ?? null, contactRequested: value.contactRequested ?? false,
      preferredTime: value.preferredTime ?? null });
    return { schemeId: scheme.id, revision: scheme.revision };
  });
}
export async function leaveMessage(principal: Principal, slug: string, requestId: string, input: unknown) {
  const value = requestMessageSchema.parse(input);
  return mutate(principal, slug, requestId, 'message', value, async (client, row, userId) => {
    await orm(client).insert(finishRequestEvents).values({ id: randomUUID(), requestId: row.id, actorId: userId, kind: 'message', message: value.message ?? null,
      contactRequested: value.contactRequested, preferredTime: value.preferredTime ?? null });
    return {};
  });
}
