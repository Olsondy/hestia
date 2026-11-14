import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, transaction } from '../../persistence/src/client';
import { modelCalls, modelPrices, models, modelServices, workspaceDomains, workspaceModels, workspaceModelSettings, workspaces } from '../../persistence/src/schema';
import { DomainError } from '../../contracts/src/project';
import { workspaceSlugSchema } from '../../contracts/src/workspaces';
import { getWorkspace } from '../../workspaces/src/service';
import type { Principal } from '../../workspaces/src/access';
import { recordAudit } from '../../platform-admin/src/service';
import type { PlatformAdmin } from '../../platform-admin/src/guard';

// Grants, quota and per-call reservations (ADR-0018). The platform admin decides which admitted, priced models an
// enterprise may use, its monthly quota in fen (null = no limit) and how many Agent tasks it runs at once. The
// enterprise admin enables granted models and picks a default. Every call reserves before it is sent and settles after.

type Actor = Pick<PlatformAdmin, 'userId' | 'email'>;
type Tx = Parameters<Parameters<typeof transaction>[0]>[1];
/** Calendar month in Asia/Shanghai, as M03's usage report. */
export const monthSql = sql<string>`to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM')`;
// A reservation still open after this long is a call whose Worker died; it keeps counting against the quota (never
// as zero) until recovery settles it, but no longer holds a concurrency slot.
const IN_FLIGHT_WINDOW = sql`now() - interval '30 minutes'`;
const DEFAULT_CONCURRENCY = 2;

const grantable = (state: string, priced: boolean) => state === 'admitted' && priced;
const notFound = () => new DomainError('NOT_FOUND', '企业不存在。', 404);

async function workspaceBySlug(slug: string) {
  const parsed = workspaceSlugSchema.safeParse(slug);
  const [row] = parsed.success ? await db.select({ id: workspaces.id, slug: workspaces.slug, name: workspaces.name }).from(workspaces)
    .where(and(eq(workspaces.slug, parsed.data), sql`${workspaces.personalUserId} IS NULL`)) : [];
  if (!row?.slug) throw notFound();
  return { id: row.id, slug: row.slug, name: row.name };
}

async function monthTotals(workspaceIds: string[], tx: Tx | typeof db = db) {
  if (!workspaceIds.length) return new Map<string, { used: number; reserved: number }>();
  const rows = await tx.select({ workspaceId: modelCalls.workspaceId,
    used: sql<number>`coalesce(sum(${modelCalls.costFen}) FILTER (WHERE ${modelCalls.status} = 'settled'), 0)::bigint`,
    reserved: sql<number>`coalesce(sum(${modelCalls.reservedFen}) FILTER (WHERE ${modelCalls.status} = 'reserved'), 0)::bigint` })
    .from(modelCalls).where(and(inArray(modelCalls.workspaceId, workspaceIds), eq(modelCalls.month, monthSql))).groupBy(modelCalls.workspaceId);
  return new Map(rows.map(row => [row.workspaceId, { used: Number(row.used), reserved: Number(row.reserved) }]));
}

async function grantsOf(workspaceIds: string[]) {
  if (!workspaceIds.length) return [];
  return db.select({ workspaceId: workspaceModels.workspaceId, id: models.id, modelId: models.modelId, name: models.name, description: models.description,
    state: models.state, enabled: workspaceModels.enabled, isDefault: workspaceModels.isDefault, serviceName: modelServices.name })
    .from(workspaceModels).innerJoin(models, eq(models.id, workspaceModels.modelId)).innerJoin(modelServices, eq(modelServices.id, models.serviceId))
    .where(inArray(workspaceModels.workspaceId, workspaceIds)).orderBy(asc(workspaceModels.grantedAt), asc(models.modelId));
}

// ---------- 平台管理员 ----------
export async function listEnterprises() {
  const rows = await db.select({ id: workspaces.id, slug: workspaces.slug, name: workspaces.name, quota: workspaceModelSettings.monthlyQuota,
    concurrency: workspaceModelSettings.concurrency, configured: sql<boolean>`${workspaceModelSettings.workspaceId} IS NOT NULL` })
    .from(workspaces).leftJoin(workspaceModelSettings, eq(workspaceModelSettings.workspaceId, workspaces.id))
    .where(sql`${workspaces.personalUserId} IS NULL AND ${workspaces.slug} IS NOT NULL`).orderBy(asc(workspaces.createdAt));
  const ids = rows.map(row => row.id), [totals, grants, domains] = await Promise.all([monthTotals(ids), grantsOf(ids),
    ids.length ? db.select().from(workspaceDomains).where(inArray(workspaceDomains.workspaceId, ids)).orderBy(asc(workspaceDomains.host)) : []]);
  return rows.map(row => ({ id: row.id, slug: row.slug!, name: row.name, domains: domains.filter(d => d.workspaceId === row.id).map(d => d.host),
    quota: row.configured ? row.quota : 0, concurrency: row.concurrency ?? DEFAULT_CONCURRENCY, ...(totals.get(row.id) ?? { used: 0, reserved: 0 }),
    grants: grants.filter(g => g.workspaceId === row.id).map(({ workspaceId: _, ...grant }) => grant) }));
}
export async function getEnterprise(slug: string) {
  const { id } = await workspaceBySlug(slug);
  return (await listEnterprises()).find(row => row.id === id)!;
}

export const updateEnterpriseSchema = z.object({
  grants: z.array(z.string().uuid()).max(100),
  quota: z.number().int().min(0).max(1_000_000_000).nullable(),
  concurrency: z.number().int().min(1).max(100),
}).partial().strict();

/** Only admitted, priced models can be newly granted; a model that was granted earlier may stay while it is rechecked. */
export async function updateEnterprise(actor: Actor, slug: string, input: unknown) {
  const data = updateEnterpriseSchema.parse(input), workspace = await workspaceBySlug(slug);
  await transaction(async (_client, tx) => {
    const [current] = await tx.select().from(workspaceModelSettings).where(eq(workspaceModelSettings.workspaceId, workspace.id)).for('update');
    const before = { quota: current ? current.monthlyQuota : 0, concurrency: current?.concurrency ?? DEFAULT_CONCURRENCY };
    const next = { quota: data.quota !== undefined ? data.quota : before.quota, concurrency: data.concurrency ?? before.concurrency };
    await tx.insert(workspaceModelSettings).values({ workspaceId: workspace.id, monthlyQuota: next.quota, concurrency: next.concurrency })
      .onConflictDoUpdate({ target: workspaceModelSettings.workspaceId, set: { monthlyQuota: next.quota, concurrency: next.concurrency, updatedAt: sql`now()` } });
    const label = (q: number | null) => q === null ? '不限' : (q / 100).toFixed(2);
    if (next.quota !== before.quota) await recordAudit({ actorUserId: actor.userId, actor: actor.email, action: 'set_quota', target: workspace.name, detail: { from: label(before.quota), to: label(next.quota) } }, tx);
    if (next.concurrency !== before.concurrency) await recordAudit({ actorUserId: actor.userId, actor: actor.email, action: 'set_concurrency', target: workspace.name, detail: { from: before.concurrency, to: next.concurrency } }, tx);

    if (data.grants) {
      const wanted = [...new Set(data.grants)];
      const existing = (await tx.select({ modelId: workspaceModels.modelId }).from(workspaceModels).where(eq(workspaceModels.workspaceId, workspace.id))).map(r => r.modelId);
      const added = wanted.filter(id => !existing.includes(id)), removed = existing.filter(id => !wanted.includes(id));
      const info = added.length || removed.length ? await tx.select({ id: models.id, modelId: models.modelId, state: models.state,
        // Qualified by hand: in a single-table select Drizzle leaves column names unqualified, which a subquery would rebind.
        priced: sql<boolean>`EXISTS (SELECT 1 FROM model_prices p WHERE p.model_id = "models"."id")` }).from(models).where(inArray(models.id, [...added, ...removed])) : [];
      for (const id of added) {
        const model = info.find(m => m.id === id);
        if (!model) throw new DomainError('NOT_FOUND', '模型不存在。', 404);
        if (!grantable(model.state, model.priced)) throw new DomainError('NOT_GRANTABLE', `「${model.modelId}」还没有通过接入检查或没有填写单价，不能分配。`, 409);
      }
      if (added.length) await tx.insert(workspaceModels).values(added.map(modelId => ({ workspaceId: workspace.id, modelId })));
      if (removed.length) await tx.delete(workspaceModels).where(and(eq(workspaceModels.workspaceId, workspace.id), inArray(workspaceModels.modelId, removed)));
      const names = (ids: string[]) => ids.map(id => info.find(m => m.id === id)!.modelId);
      if (added.length || removed.length) await recordAudit({ actorUserId: actor.userId, actor: actor.email, action: 'grant_models', target: workspace.name,
        detail: { added: names(added), removed: names(removed) } }, tx);
    }
  });
  return getEnterprise(slug);
}

// ---------- 企业 ----------
type Availability = 'ok' | 'platform_disabled' | 'not_ready';
const availability = (state: string): Availability => state === 'admitted' ? 'ok' : state === 'disabled' ? 'platform_disabled' : 'not_ready';

/** Members see the models they can pick; the enterprise admin also sees disabled ones and the quota summary. */
export async function enterpriseModels(principal: Principal, workspaceId: string) {
  const workspace = await getWorkspace(principal, workspaceId), admin = workspace.role === 'admin';
  const [settings] = await db.select().from(workspaceModelSettings).where(eq(workspaceModelSettings.workspaceId, workspace.id));
  const totals = (await monthTotals([workspace.id])).get(workspace.id) ?? { used: 0, reserved: 0 };
  const quota = settings ? settings.monthlyQuota : 0;
  const all = (await grantsOf([workspace.id])).map(g => ({ id: g.id, modelId: g.modelId, name: g.name, description: g.description, enabled: g.enabled,
    isDefault: g.isDefault, availability: availability(g.state) }));
  const usable = all.filter(m => m.enabled && m.availability === 'ok');
  const defaultModel = usable.find(m => m.isDefault)?.id ?? usable[0]?.id ?? null;
  const exhausted = quota !== null && totals.used + totals.reserved >= quota;
  return { role: workspace.role, models: admin ? all : usable.map(({ enabled: _, availability: __, ...m }) => m), defaultModel,
    quota: { limit: quota, used: totals.used, reserved: totals.reserved, exhausted, ...(admin ? { concurrency: settings?.concurrency ?? DEFAULT_CONCURRENCY } : {}) } };
}

export const enterpriseModelSchema = z.object({ enabled: z.boolean(), isDefault: z.literal(true) }).partial().strict();
export async function setEnterpriseModel(principal: Principal, workspaceId: string, modelId: string, input: unknown) {
  const data = enterpriseModelSchema.parse(input), workspace = await getWorkspace(principal, workspaceId);
  if (workspace.role !== 'admin') throw new DomainError('FORBIDDEN', '只有企业管理员可以修改模型设置。', 403);
  await transaction(async (_client, tx) => {
    const rows = await tx.select().from(workspaceModels).where(eq(workspaceModels.workspaceId, workspace.id)).for('update');
    const target = rows.find(row => row.modelId === modelId);
    if (!target) throw new DomainError('NOT_FOUND', '这个模型没有分配给本企业。', 404);
    if (data.enabled === false && target.isDefault) throw new DomainError('DEFAULT_MODEL', '这是默认模型，先把其他模型设为默认再停用。', 409);
    if (data.isDefault) {
      const [model] = await tx.select({ state: models.state }).from(models).where(eq(models.id, modelId));
      if (model.state !== 'admitted') throw new DomainError('MODEL_UNAVAILABLE', '这个模型暂时不可用，不能设为默认。', 409);
      await tx.update(workspaceModels).set({ isDefault: false }).where(and(eq(workspaceModels.workspaceId, workspace.id), eq(workspaceModels.isDefault, true)));
    }
    await tx.update(workspaceModels).set({ ...(data.enabled !== undefined ? { enabled: data.enabled } : {}), ...(data.isDefault ? { enabled: true, isDefault: true } : {}) })
      .where(and(eq(workspaceModels.workspaceId, workspace.id), eq(workspaceModels.modelId, modelId)));
  });
  return enterpriseModels(principal, workspaceId);
}

// ---------- 每次调用：预占与结算 ----------
const costOf = (input: number, output: number, price: { inputPerMillion: number; outputPerMillion: number }) =>
  Math.ceil((input * price.inputPerMillion + output * price.outputPerMillion) / 1_000_000);

export type Reservation = { callId: string; reservedFen: number; maxOutput: number };
/**
 * Before a model call. Refuses (nothing is sent) when the model is not usable for this enterprise, the quota cannot
 * cover input estimate + max output, or a concurrency limit is reached (ENTERPRISE_BUSY / SERVICE_BUSY are retryable:
 * the caller queues and tries again). Serialized per enterprise and per service by row locks.
 */
export async function reserveCall(input: { workspaceId: string; modelId: string; inputTokens: number; userId?: string | null; taskId?: string | null }): Promise<Reservation> {
  return transaction(async (_client, tx) => {
    const [settings] = await tx.select().from(workspaceModelSettings).where(eq(workspaceModelSettings.workspaceId, input.workspaceId)).for('update');
    const [grant] = await tx.select({ enabled: workspaceModels.enabled, state: models.state, maxOutput: models.maxOutput, serviceId: models.serviceId })
      .from(workspaceModels).innerJoin(models, eq(models.id, workspaceModels.modelId))
      .where(and(eq(workspaceModels.workspaceId, input.workspaceId), eq(workspaceModels.modelId, input.modelId)));
    if (!settings || !grant) throw new DomainError('MODEL_NOT_GRANTED', '本企业没有开通这个模型。', 409);
    if (!grant.enabled) throw new DomainError('MODEL_NOT_ENABLED', '企业没有启用这个模型。', 409);
    if (grant.state !== 'admitted') throw new DomainError('MODEL_UNAVAILABLE', '这个模型暂时不可用，请改选其他模型。', 409);
    const [price] = await tx.select().from(modelPrices).where(eq(modelPrices.modelId, input.modelId)).orderBy(desc(modelPrices.effectiveAt), desc(modelPrices.id)).limit(1);
    if (!price) throw new DomainError('MODEL_UNAVAILABLE', '这个模型暂时不可用，请改选其他模型。', 409);
    const reservedFen = costOf(Math.max(0, Math.ceil(input.inputTokens)), grant.maxOutput, price);

    const [{ tasks }] = await tx.select({ tasks: sql<number>`count(DISTINCT coalesce(${modelCalls.taskId}, ${modelCalls.id}))::int` }).from(modelCalls)
      .where(and(eq(modelCalls.workspaceId, input.workspaceId), eq(modelCalls.status, 'reserved'), sql`${modelCalls.startedAt} > ${IN_FLIGHT_WINDOW}`,
        ...(input.taskId ? [sql`${modelCalls.taskId} IS DISTINCT FROM ${input.taskId}`] : [])));
    if (tasks >= settings.concurrency) throw new DomainError('ENTERPRISE_BUSY', '本企业同时运行的 Agent 任务已达上限，正在排队。', 429);

    const [service] = await tx.select({ concurrency: modelServices.concurrency }).from(modelServices).where(eq(modelServices.id, grant.serviceId)).for('update');
    const [{ calls }] = await tx.select({ calls: sql<number>`count(*)::int` }).from(modelCalls).innerJoin(models, eq(models.id, modelCalls.modelId))
      .where(and(eq(models.serviceId, grant.serviceId), eq(modelCalls.status, 'reserved'), sql`${modelCalls.startedAt} > ${IN_FLIGHT_WINDOW}`));
    if (calls >= service.concurrency) throw new DomainError('SERVICE_BUSY', '模型服务的并发已满，正在排队。', 429);

    if (settings.monthlyQuota !== null) {
      const totals = (await monthTotals([input.workspaceId], tx)).get(input.workspaceId) ?? { used: 0, reserved: 0 };
      if (totals.used + totals.reserved + reservedFen > settings.monthlyQuota)
        throw new DomainError('QUOTA_EXCEEDED', settings.monthlyQuota === 0 ? '本企业还没有设置本月额度。' : '本月额度已用完，已有成果不受影响。', 402);
    }
    const [call] = await tx.insert(modelCalls).values({ workspaceId: input.workspaceId, userId: input.userId ?? null, taskId: input.taskId ?? null,
      modelId: input.modelId, priceId: price.id, month: monthSql, reservedFen }).returning({ id: modelCalls.id });
    return { callId: call.id, reservedFen, maxOutput: grant.maxOutput };
  });
}

/** After the call. Known usage is priced at the reserved price version; unknown usage counts as reserved, unverified. Idempotent. */
export async function settleCall(callId: string, result: { inputTokens: number | null; outputTokens: number | null; outcome: string; elapsedMs?: number }) {
  return transaction(async (_client, tx) => {
    const [call] = await tx.select().from(modelCalls).where(eq(modelCalls.id, callId)).for('update');
    if (!call) throw new Error('MODEL_CALL_NOT_FOUND');
    if (call.status === 'settled') return { costFen: call.costFen!, unverified: call.unverified };
    const known = typeof result.inputTokens === 'number' && typeof result.outputTokens === 'number';
    const [price] = await tx.select().from(modelPrices).where(eq(modelPrices.id, call.priceId));
    const costFen = known ? costOf(result.inputTokens!, result.outputTokens!, price) : call.reservedFen;
    await tx.update(modelCalls).set({ status: 'settled', costFen, unverified: !known, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      outcome: result.outcome, elapsedMs: result.elapsedMs ?? null, settledAt: sql`now()` }).where(eq(modelCalls.id, callId));
    return { costFen, unverified: !known };
  });
}
