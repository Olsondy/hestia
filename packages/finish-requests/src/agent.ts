import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { PgBoss } from 'pg-boss';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DomainError, idSchema, spatialStateSchema } from '../../contracts/src/project';
import { effectiveLevels, levelOf } from '../../contracts/src/building';
import type { StoneSpec, SurfaceDesign } from '../../contracts/src/finishes';
import type { SoftStyleReference } from '../../contracts/src/soft-styles';
import { adoptSchemeCandidateSchema, publishSchemeSchema, type SchemeCandidateIssue, type SchemeCandidateView, type SchemeDecision } from '../../contracts/src/agent-schemes';
import type { LeadView } from '../../contracts/src/finish-requests';
import { advisoryXactLock, orm, transaction } from '../../persistence/src/client';
import { finishRequests, finishSchemeRevisions, finishSchemes, operations, projects, schemeCandidates } from '../../persistence/src/schema';
import { actorOf, type Principal } from '../../workspaces/src/access';
import { workspaceStones } from '../../finishes/src/catalog';
import { inspectSurfaceDesign } from '../../finishes/src/plan';
import { lookupOf, resolveScheme } from './scheme-check';
import { softStyleCatalog, workspaceSoftStyles } from '../../soft-styles/src/catalog';
import { styledState } from '../../soft-styles/src/state';
import { enqueueSchemeRender, renderStatuses } from '../../renders/src/service';
import { listLeads, lockedRequest, memberOf, requestColumns, requestFinishes, type RequestRow } from './service';

// K03 (ADR-0019): the enterprise Agent proposes a whole scheme for a lead's space; the application resolves catalog
// versions, checks tiling and furnishing, and stores a candidate. Candidates never change the space or the lead's
// schemes. A member adopts one into a scheme pending review (hidden from customers) and publishes it.

const MAX_SCHEMES = 6;
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const notFound = () => new DomainError('NOT_FOUND', '方案需求不存在。', 404);

/** What the model is told about a lead: its finishes by level, the enterprise's active catalogs and the existing schemes. No prices. */
export type LeadContext = {
  requestId: string; title: string; note: string | null; preferences: RequestRow['preferences'];
  levels: { id: string; name: string }[];
  rooms: { id: string; name: string | null; levelId: string | null }[];
  finishes: { id: string; name: string; kind: 'floor' | 'wall' | 'stair'; level: string | null; requested: boolean }[];
  stones: { id: string; name: string; surface: StoneSpec['surface']; lengthMm: [number, number]; widthMm: [number, number] }[];
  softStyles: { id: string; name: string; line: string }[];
  schemes: { name: string; summary: string; softStyle: string | null; pendingReview: boolean }[];
};
const mm = (metres: number) => Math.round(metres * 1000);

/** Null when the project is not a lead's space (personal projects keep the existing tools only). */
export async function leadContext(client: Pool | PoolClient, projectId: string): Promise<LeadContext | null> {
  const tx = orm(client as PoolClient);
  const [row] = await tx.select(requestColumns).from(finishRequests).where(eq(finishRequests.projectId, projectId)) as RequestRow[];
  if (!row) return null;
  const [project] = await tx.select({ name: projects.name, snapshot: projects.snapshot }).from(projects).where(eq(projects.id, projectId));
  const facts = spatialStateSchema.parse(project.snapshot).fixedFacts, levels = effectiveLevels(facts);
  const levelNames = new Map((facts.levels ?? []).map((level, index) => [level.id, level.name ?? `${index + 1} 层`]));
  const requested = new Set(row.finish_ids);
  const [stones, styles, schemes] = await Promise.all([workspaceStones(client, row.workspace_id), workspaceSoftStyles(client, row.workspace_id),
    tx.select({ name: finishSchemes.name, summary: finishSchemes.summary, softStyle: finishSchemes.softStyle, pendingReview: finishSchemes.pendingReview })
      .from(finishSchemes).where(eq(finishSchemes.requestId, row.id)).orderBy(finishSchemes.ordinal)]);
  return {
    requestId: row.id, title: project.name, note: row.note, preferences: row.preferences,
    levels: levels.map((level, index) => ({ id: level.id, name: levelNames.get(level.id) ?? `${index + 1} 层` })),
    rooms: facts.rooms.map(room => ({ id: room.id, name: room.name ?? null, levelId: facts.levels?.length ? levelOf(room, levels) ?? null : null })),
    finishes: requestFinishes(facts, (facts.finishes ?? []).map(finish => finish.id))
      .map(finish => ({ id: finish.id, name: finish.name, kind: finish.kind, level: finish.levelName, requested: requested.has(finish.id) })),
    stones: stones.map(stone => ({ id: stone.id, name: stone.name, surface: stone.surface,
      lengthMm: [mm(stone.sizes.length.min), mm(stone.sizes.length.max)], widthMm: [mm(stone.sizes.width.min), mm(stone.sizes.width.max)] })),
    softStyles: styles.map(style => ({ id: style.id, name: style.name, line: style.line })),
    schemes: schemes.map(scheme => ({ name: scheme.name, summary: scheme.summary, pendingReview: scheme.pendingReview,
      softStyle: styles.find(style => style.id === (scheme.softStyle as SoftStyleReference | null)?.styleId)?.name ?? null })),
  };
}

export type ProposalResult = { status: 'candidate'; candidateId: string; issues: SchemeCandidateIssue[] } | { status: 'rejected'; message: string; issues: SchemeCandidateIssue[] };

/**
 * Inside the conversation commit: one candidate per task turn (`operationId`), so a replayed response returns the same
 * candidate. A rejected proposal stores nothing; its reasons go back to the member in the outcome.
 */
export async function proposeSchemeInTransaction(client: PoolClient, input: { projectId: string; actorId: string; taskId: string; operationId: string;
  baseRevision: number; decision: SchemeDecision; renderQueue?: PgBoss }): Promise<ProposalResult> {
  const tx = orm(client);
  const [existing] = await tx.select({ id: schemeCandidates.id, report: schemeCandidates.report }).from(schemeCandidates)
    .where(and(eq(schemeCandidates.taskId, input.taskId), eq(schemeCandidates.operationId, input.operationId)));
  if (existing) return { status: 'candidate', candidateId: existing.id, issues: (existing.report as { issues: SchemeCandidateIssue[] }).issues };
  // No row lock on the request: the commit already holds the project lock, and request-then-project is the order elsewhere.
  const [row] = await tx.select(requestColumns).from(finishRequests).where(eq(finishRequests.projectId, input.projectId)) as RequestRow[];
  if (!row) return { status: 'rejected', message: '整体方案只能在企业线索的空间里提出；这个项目不是线索，空间未修改。',
    issues: [{ code: 'SCHEME_NOT_LEAD', severity: 'conflict', message: '这个项目不是企业线索的空间。' }] };
  const [project] = await tx.select({ revision: projects.revision, snapshot: projects.snapshot }).from(projects).where(eq(projects.id, input.projectId));
  if (project.revision !== input.baseRevision) throw new DomainError('REVISION_CONFLICT', '项目已有新修订，本轮旧结果未应用；请重新发起。', 409);
  const state = spatialStateSchema.parse(project.snapshot);
  const resolved = resolveScheme(state, input.decision, await workspaceStones(client, row.workspace_id), await workspaceSoftStyles(client, row.workspace_id), row.finish_ids);
  const conflicts = resolved.issues.filter(issue => issue.severity === 'conflict');
  if (!('design' in resolved) || conflicts.length) {
    const reasons = conflicts.slice(0, 3).map(issue => issue.message).join('；');
    return { status: 'rejected', message: `这套方案没有通过校验，没有保存：${reasons}${conflicts.length > 3 ? ` 等 ${conflicts.length} 处` : ''}。`, issues: resolved.issues };
  }
  const id = randomUUID(), report = { adoptable: true, issues: resolved.issues };
  await tx.insert(schemeCandidates).values({ id, requestId: row.id, projectId: input.projectId, taskId: input.taskId, operationId: input.operationId,
    baseRevision: project.revision, name: input.decision.name, summary: input.decision.summary, surfaceDesign: resolved.design, report,
    softStyle: { styleId: resolved.style.id, styleVersion: resolved.style.version }, softChoices: resolved.choices, createdBy: input.actorId });
  const renderId = await enqueueSchemeRender(client, { projectId: input.projectId, actorId: input.actorId, projectRevision: project.revision, kind: 'scheme-candidate',
    state: spatialStateSchema.parse(styledState({ ...state, surfaceDesign: resolved.design }, resolved.style)), scheme: { schemeId: id, revision: 1 },
    label: `Agent 候选 ${input.decision.name} · ${resolved.style.name}` }, input.renderQueue);
  await tx.update(schemeCandidates).set({ renderId }).where(eq(schemeCandidates.id, id));
  return { status: 'candidate', candidateId: id, issues: resolved.issues };
}

type CandidateRow = typeof schemeCandidates.$inferSelect;
async function candidateViews(client: PoolClient, row: RequestRow, rows: CandidateRow[]): Promise<SchemeCandidateView[]> {
  const tx = orm(client), [project] = await tx.select({ revision: projects.revision }).from(projects).where(eq(projects.id, row.project_id));
  const renders = await renderStatuses(row.project_id, rows.flatMap(c => c.renderId ? [c.renderId] : []), client);
  const catalog = rows.length ? await softStyleCatalog(client, row.workspace_id) : [];
  const summary = (ref: SoftStyleReference | null) => {
    const style = ref && catalog.find(e => e.style.id === ref.styleId && e.style.version === ref.styleVersion)?.style;
    return style ? { id: style.id, version: style.version, name: style.name, line: style.line, palette: style.palette } : null;
  };
  return rows.map(c => {
    const render = c.renderId ? renders.get(c.renderId) : undefined;
    return { id: c.id, requestId: c.requestId, taskId: c.taskId, baseRevision: c.baseRevision, stale: c.baseRevision !== project.revision,
      name: c.name, summary: c.summary, status: c.status as SchemeCandidateView['status'], adoptedSchemeId: c.adoptedSchemeId,
      surfaceDesign: c.surfaceDesign as SurfaceDesign, issues: (c.report as { issues: SchemeCandidateIssue[] }).issues,
      softStyle: summary(c.softStyle as SoftStyleReference | null), softChoices: (c.softChoices as SoftStyleReference[]).map(summary).filter((x): x is NonNullable<typeof x> => !!x),
      render: render ? { id: render.id, status: render.status, width: render.width, height: render.height, error: render.error, imageHref: render.status === 'completed' ? render.contentHref : null,
        label: render.label, updatedAt: render.updatedAt, trace: { snapshotHash: render.snapshotHash, assetVersion: render.assetVersion, rendererVersion: render.rendererVersion } } : null,
      createdAt: c.createdAt.toISOString() };
  });
}
async function memberRequest(client: PoolClient, userId: string, workspaceId: string, requestId: string, lock = false) {
  const tx = orm(client);
  const row = lock ? await lockedRequest(client, requestId)
    : (await tx.select(requestColumns).from(finishRequests).where(eq(finishRequests.id, idSchema.parse(requestId))) as RequestRow[])[0];
  if (!row || row.workspace_id !== idSchema.parse(workspaceId)) throw notFound();
  await memberOf(client, userId, row.workspace_id);
  return row;
}

/** Members only: the Agent's candidates for a lead, newest first. */
export async function listSchemeCandidates(principal: Principal, workspaceId: string, requestId: string) {
  const userId = actorOf(principal);
  return transaction(async (client, tx) => {
    const row = await memberRequest(client, userId, workspaceId, requestId);
    return candidateViews(client, row, await tx.select().from(schemeCandidates).where(eq(schemeCandidates.requestId, row.id)).orderBy(desc(schemeCandidates.createdAt)).limit(50));
  });
}

/** Run a member's write once per operation id (same request → same result; a different request with the id → conflict). */
async function once(client: PoolClient, userId: string, operationId: string, projectId: string, hash: string, work: () => Promise<void>) {
  const tx = orm(client);
  await advisoryXactLock(tx, `${userId}:${operationId}`);
  const [previous] = await tx.select({ requestHash: operations.requestHash }).from(operations).where(and(eq(operations.actorId, userId), eq(operations.id, operationId)));
  if (previous) { if (previous.requestHash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409); return; }
  await work();
  await tx.insert(operations).values({ actorId: userId, id: operationId, projectId, requestHash: hash, result: {} });
}

/**
 * A member adopts a candidate: it becomes a scheme of the lead, pending review, rendered afresh as a scheme. The
 * space must be unchanged since the candidate and its stones still in the catalog; customers cannot see it yet.
 */
export async function adoptSchemeCandidate(principal: Principal, workspaceId: string, requestId: string, candidateId: string, input: unknown, deps: { renderQueue?: PgBoss } = {}): Promise<LeadView> {
  const userId = actorOf(principal), value = adoptSchemeCandidateSchema.parse(input), id = idSchema.parse(candidateId);
  await transaction(async (client, tx) => {
    const row = await memberRequest(client, userId, workspaceId, requestId, true);
    await once(client, userId, value.operationId, row.project_id, sha({ kind: 'adopt-scheme-candidate', requestId: row.id, candidateId: id }), async () => {
      const [candidate] = await tx.select().from(schemeCandidates).where(and(eq(schemeCandidates.id, id), eq(schemeCandidates.requestId, row.id))).for('update');
      if (!candidate) throw new DomainError('NOT_FOUND', '候选方案不存在。', 404);
      if (candidate.status !== 'draft') throw new DomainError('CANDIDATE_ADOPTED', '这套候选已经采用过。', 409);
      const [project] = await tx.select({ revision: projects.revision, snapshot: projects.snapshot }).from(projects).where(eq(projects.id, row.project_id));
      if (project.revision !== candidate.baseRevision) throw new DomainError('CANDIDATE_STALE', '空间在候选生成后已经变化，请让 Agent 重新出方案。', 409);
      const state = spatialStateSchema.parse(project.snapshot), design = candidate.surfaceDesign as SurfaceDesign;
      const check = inspectSurfaceDesign(state.fixedFacts, design, lookupOf(await workspaceStones(client, row.workspace_id)));
      if (!check.adoptable) throw new DomainError('CANDIDATE_CHECK_FAILED', `候选已不能通过校验：${check.issues.find(i => i.severity === 'conflict')?.message ?? '石材目录已变化'}`, 409);
      const ref = candidate.softStyle as SoftStyleReference;
      const style = (await workspaceSoftStyles(client, row.workspace_id)).find(s => s.id === ref.styleId && s.version === ref.styleVersion);
      if (!style) throw new DomainError('CANDIDATE_CHECK_FAILED', '候选用的软装风格已下架，请让 Agent 重新出方案。', 409);
      const [{ last }] = await tx.select({ last: sql<number>`coalesce(max(${finishSchemes.ordinal}), 0)::int` }).from(finishSchemes).where(eq(finishSchemes.requestId, row.id));
      if (last >= MAX_SCHEMES) throw new DomainError('SCHEMES_FULL', `这条线索已有 ${MAX_SCHEMES} 套方案，不能再添加。`, 409);
      const schemeId = randomUUID(), report = { adoptable: true, issues: check.issues.map(i => ({ code: i.code, objectId: i.objectId, message: i.message })) };
      await tx.insert(finishSchemes).values({ id: schemeId, requestId: row.id, ordinal: last + 1, name: candidate.name, summary: candidate.summary, surfaceDesign: design, report,
        softStyle: ref, softChoices: candidate.softChoices, pendingReview: true });
      const renderId = await enqueueSchemeRender(client, { projectId: row.project_id, actorId: userId, projectRevision: project.revision,
        state: spatialStateSchema.parse(styledState({ ...state, surfaceDesign: design }, style)), scheme: { schemeId, revision: 1 },
        label: `方案 ${candidate.name} · ${style.name}` }, deps.renderQueue);
      await tx.update(finishSchemes).set({ renderId }).where(eq(finishSchemes.id, schemeId));
      await tx.insert(finishSchemeRevisions).values({ schemeId, revision: 1, surfaceDesign: design, report, renderId, softStyle: ref, change: { agentCandidateId: candidate.id }, createdBy: userId });
      await tx.update(schemeCandidates).set({ status: 'adopted', adoptedSchemeId: schemeId, adoptedBy: userId, adoptedAt: sql`now()` }).where(eq(schemeCandidates.id, candidate.id));
      await tx.update(finishRequests).set({ updatedAt: sql`now()` }).where(eq(finishRequests.id, row.id));
    });
  });
  return (await listLeads(principal, workspaceId)).find(lead => lead.id === requestId)!;
}

/** A member publishes a pending scheme; customers see it once the lead itself is published. */
export async function publishScheme(principal: Principal, workspaceId: string, requestId: string, schemeId: string, input: unknown): Promise<LeadView> {
  const userId = actorOf(principal), value = publishSchemeSchema.parse(input), id = idSchema.parse(schemeId);
  await transaction(async (client, tx) => {
    const row = await memberRequest(client, userId, workspaceId, requestId, true);
    await once(client, userId, value.operationId, row.project_id, sha({ kind: 'publish-scheme', requestId: row.id, schemeId: id }), async () => {
      const [scheme] = await tx.select({ pending: finishSchemes.pendingReview }).from(finishSchemes).where(and(eq(finishSchemes.id, id), eq(finishSchemes.requestId, row.id))).for('update');
      if (!scheme) throw new DomainError('NOT_FOUND', '方案不存在。', 404);
      if (!scheme.pending) throw new DomainError('SCHEME_ALREADY_PUBLISHED', '这套方案已经发布。', 409);
      await tx.update(finishSchemes).set({ pendingReview: false, updatedAt: sql`now()` }).where(eq(finishSchemes.id, id));
      await tx.update(finishRequests).set({ updatedAt: sql`now()` }).where(eq(finishRequests.id, row.id));
    });
  });
  return (await listLeads(principal, workspaceId)).find(lead => lead.id === requestId)!;
}
