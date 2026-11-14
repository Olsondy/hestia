import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, transaction } from '../../persistence/src/client';
import { modelPrices, models, modelServices } from '../../persistence/src/schema';
import { DomainError } from '../../contracts/src/project';
import {
  compatDefaults, compatSchemas, createServiceSchema, enableModelSchema, paramDefaults, paramSchemas, replaceKeySchema, updateModelSchema, updateServiceSchema,
  type Compat, type ModelParams, type ModelView, type Protocol, type ServiceView,
} from '../../contracts/src/models';
import { recordAudit } from '../../platform-admin/src/service';
import type { PlatformAdmin } from '../../platform-admin/src/guard';
import { keyTail, openSecret, sealSecret } from './secret';

// Model registry (ADR-0018): platform admins register model services and enable model IDs on them. Every change is
// audited; the key is sealed at rest, shown as its last four characters and never returned, logged or audited.

type Actor = Pick<PlatformAdmin, 'userId' | 'email'>;
const audit = (actor: Actor, action: string, target: string, detail: Record<string, unknown> = {}, tx?: Parameters<typeof recordAudit>[1]) =>
  recordAudit({ actorUserId: actor.userId, actor: actor.email, action, target, detail }, tx);
const notFound = (what: string) => new DomainError('NOT_FOUND', `${what}不存在。`, 404);

function checkBaseUrl(raw: string): string {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash) throw new DomainError('INVALID_BASE_URL', '接口地址不能包含账号、密码、查询参数或锚点。');
  if (!['https:', 'http:'].includes(url.protocol) || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:'))
    throw new DomainError('INVALID_BASE_URL', '接口地址必须是 HTTPS。');
  return url.href.replace(/\/+$/, '');
}
const parseCompat = (protocol: Protocol, raw: unknown): Compat => {
  const parsed = compatSchemas[protocol].safeParse(raw ?? compatDefaults[protocol]);
  if (!parsed.success) throw new DomainError('INVALID_COMPAT', '兼容设置不符合所选协议。');
  return parsed.data;
};
const parseParams = (protocol: Protocol, raw: unknown): ModelParams => {
  const parsed = paramSchemas[protocol].safeParse(raw);
  if (!parsed.success) throw new DomainError('INVALID_PARAMS', '调用参数不符合所在服务的协议。');
  return parsed.data;
};

type ServiceRow = typeof modelServices.$inferSelect;
type ModelRow = typeof models.$inferSelect;
type PriceRow = typeof modelPrices.$inferSelect;
const iso = (value: unknown) => typeof value === 'string' ? value : value instanceof Date ? value.toISOString() : String(value);
function serviceView(row: ServiceRow): ServiceView {
  return { id: row.id, name: row.name, protocol: row.protocol, baseUrl: row.baseUrl, keyTail: row.keyTail, compat: row.compat as Compat,
    timeoutSeconds: row.timeoutSeconds, concurrency: row.concurrency,
    ping: row.ping ? { ...(row.ping as ServiceView['ping'] & object), at: iso(row.ping.at) } : null,
    catalog: row.catalog ? { ...(row.catalog as ServiceView['catalog'] & object), at: iso(row.catalog.at) } : null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
function modelView(row: ModelRow, prices: PriceRow[], catalog: ServiceView['catalog']): ModelView {
  return { id: row.id, serviceId: row.serviceId, modelId: row.modelId, manual: row.manual, name: row.name, description: row.description,
    maxOutput: row.maxOutput, params: row.params as ModelParams, state: row.state,
    prices: prices.map(p => ({ from: p.effectiveAt.toISOString(), input: p.inputPerMillion, output: p.outputPerMillion })),
    missingFromCatalog: !!catalog && !catalog.unsupported && !row.manual && !catalog.ids.includes(row.modelId) };
}

async function serviceRow(id: string): Promise<ServiceRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('模型服务');
  const [row] = await db.select().from(modelServices).where(eq(modelServices.id, id));
  if (!row) throw notFound('模型服务');
  return row;
}
async function modelRow(id: string): Promise<ModelRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('模型');
  const [row] = await db.select().from(models).where(eq(models.id, id));
  if (!row) throw notFound('模型');
  return row;
}
async function pricesOf(ids: string[]) {
  const rows = ids.length ? await db.select().from(modelPrices).where(inArray(modelPrices.modelId, ids)).orderBy(asc(modelPrices.effectiveAt), asc(modelPrices.id)) : [];
  return (id: string) => rows.filter(row => row.modelId === id);
}

export async function listServices(): Promise<{ services: ServiceView[]; models: ModelView[] }> {
  const services = (await db.select().from(modelServices).orderBy(asc(modelServices.createdAt))).map(serviceView);
  const rows = await db.select().from(models).orderBy(asc(models.createdAt));
  const prices = await pricesOf(rows.map(row => row.id));
  return { services, models: rows.map(row => modelView(row, prices(row.id), services.find(s => s.id === row.serviceId)?.catalog ?? null)) };
}
export async function getService(id: string) {
  const service = serviceView(await serviceRow(id));
  const rows = await db.select().from(models).where(eq(models.serviceId, id)).orderBy(asc(models.createdAt));
  const prices = await pricesOf(rows.map(row => row.id));
  return { service, models: rows.map(row => modelView(row, prices(row.id), service.catalog)) };
}
export async function getModel(id: string) {
  const row = await modelRow(id), service = serviceView(await serviceRow(row.serviceId));
  return { model: modelView(row, (await pricesOf([row.id]))(row.id), service.catalog), service };
}

export async function createService(actor: Actor, input: unknown) {
  const data = createServiceSchema.parse(input), compat = parseCompat(data.protocol, data.compat), baseUrl = checkBaseUrl(data.baseUrl);
  return transaction(async (_client, tx) => {
    const [row] = await tx.insert(modelServices).values({ name: data.name, protocol: data.protocol, baseUrl, keyCiphertext: sealSecret(data.apiKey),
      keyTail: keyTail(data.apiKey), compat, timeoutSeconds: data.timeoutSeconds, concurrency: data.concurrency }).returning();
    await audit(actor, 'register_service', row.name, { protocol: row.protocol, baseUrl }, tx);
    return serviceView(row);
  });
}

/** Changing protocol, address or compat invalidates every admitted model on the service. */
export async function updateService(actor: Actor, id: string, input: unknown) {
  const data = updateServiceSchema.parse(input), current = await serviceRow(id);
  const protocol = data.protocol ?? current.protocol;
  const compat = data.compat !== undefined ? parseCompat(protocol, data.compat) : protocol !== current.protocol ? compatDefaults[protocol] : current.compat;
  const next = { name: data.name ?? current.name, protocol, baseUrl: data.baseUrl !== undefined ? checkBaseUrl(data.baseUrl) : current.baseUrl, compat,
    timeoutSeconds: data.timeoutSeconds ?? current.timeoutSeconds, concurrency: data.concurrency ?? current.concurrency };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter(key => JSON.stringify(next[key]) !== JSON.stringify(current[key]));
  if (!changed.length) return serviceView(current);
  const recheck = changed.some(key => key === 'protocol' || key === 'baseUrl' || key === 'compat');
  return transaction(async (_client, tx) => {
    const [row] = await tx.update(modelServices).set({ ...next, updatedAt: sql`now()` }).where(eq(modelServices.id, id)).returning();
    let stale: string[] = [];
    if (recheck) {
      stale = (await tx.update(models).set({ state: 'stale', updatedAt: sql`now()` }).where(and(eq(models.serviceId, id), inArray(models.state, ['admitted', 'failed'])))
        .returning({ modelId: models.modelId })).map(m => m.modelId);
      if (protocol !== current.protocol) {
        const all = await tx.select({ id: models.id }).from(models).where(eq(models.serviceId, id));
        if (all.length) await tx.update(models).set({ params: paramDefaults[protocol] }).where(inArray(models.id, all.map(m => m.id)));
      }
    }
    await audit(actor, 'update_service', row.name, { changed: Object.fromEntries(changed.map(key => [key, next[key]])), ...(stale.length ? { recheck: stale } : {}) }, tx);
    return serviceView(row);
  });
}

/** Replacing the key keeps the registration and admission; a connectivity test is enough afterwards. */
export async function replaceServiceKey(actor: Actor, id: string, input: unknown) {
  const { apiKey } = replaceKeySchema.parse(input), current = await serviceRow(id);
  return transaction(async (_client, tx) => {
    const [row] = await tx.update(modelServices).set({ keyCiphertext: sealSecret(apiKey), keyTail: keyTail(apiKey), ping: null, updatedAt: sql`now()` })
      .where(eq(modelServices.id, id)).returning();
    await audit(actor, 'replace_key', current.name, { key: 'replaced' }, tx);
    return serviceView(row);
  });
}

export async function enableModel(actor: Actor, serviceId: string, input: unknown) {
  const data = enableModelSchema.parse(input), service = await serviceRow(serviceId);
  const listed = (service.catalog as { ids?: string[]; unsupported?: boolean } | null);
  const manual = !listed?.ids?.includes(data.modelId);
  if (manual && !data.manual) throw new DomainError('NOT_IN_CATALOG', `「${data.modelId}」不在获取到的模型列表里；确认无误时请手动添加。`, 409);
  return transaction(async (_client, tx) => {
    const [row] = await tx.insert(models).values({ serviceId, modelId: data.modelId, manual, name: data.modelId, maxOutput: 4000, params: paramDefaults[service.protocol] })
      .onConflictDoNothing().returning();
    if (!row) throw new DomainError('MODEL_EXISTS', `「${data.modelId}」已经启用。`, 409);
    await audit(actor, 'enable_model_id', service.name, { modelId: data.modelId, manual }, tx);
    return modelView(row, [], serviceView(service).catalog);
  });
}

/** Changing call parameters needs a new access check; a price change is a new version used from the next call. */
export async function updateModel(actor: Actor, id: string, input: unknown) {
  const data = updateModelSchema.parse(input), current = await modelRow(id), service = await serviceRow(current.serviceId);
  if (current.state === 'checking') throw new DomainError('CHECK_RUNNING', '接入检查进行中，结束后再修改。', 409);
  const params = data.params !== undefined ? parseParams(service.protocol, data.params) : current.params;
  const next = { name: data.name ?? current.name, description: data.description ?? current.description, maxOutput: data.maxOutput ?? current.maxOutput, params };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter(key => JSON.stringify(next[key]) !== JSON.stringify(current[key]));
  const recheck = changed.includes('params') && ['admitted', 'failed'].includes(current.state);
  return transaction(async (_client, tx) => {
    let row = current;
    if (changed.length) {
      [row] = await tx.update(models).set({ ...next, ...(recheck ? { state: 'stale' as const } : {}), updatedAt: sql`now()` }).where(eq(models.id, id)).returning();
      await audit(actor, 'update_model', current.modelId, { changed: Object.fromEntries(changed.map(key => [key, next[key]])), ...(recheck ? { recheck: true } : {}) }, tx);
    }
    if (data.price) {
      const [last] = await tx.select().from(modelPrices).where(eq(modelPrices.modelId, id)).orderBy(sql`${modelPrices.effectiveAt} DESC, ${modelPrices.id} DESC`).limit(1);
      if (!last || last.inputPerMillion !== data.price.input || last.outputPerMillion !== data.price.output) {
        await tx.insert(modelPrices).values({ modelId: id, inputPerMillion: data.price.input, outputPerMillion: data.price.output });
        await audit(actor, 'change_price', current.modelId, { input: data.price.input, output: data.price.output,
          previous: last ? { input: last.inputPerMillion, output: last.outputPerMillion } : null }, tx);
      }
    }
    return modelView(row, (await tx.select().from(modelPrices).where(eq(modelPrices.modelId, id)).orderBy(asc(modelPrices.effectiveAt), asc(modelPrices.id))),
      serviceView(service).catalog);
  });
}

/** Disabled models can no longer be picked; enabling again needs a fresh access check. */
export async function setModelDisabled(actor: Actor, id: string, disabled: boolean) {
  const current = await modelRow(id);
  if (disabled === (current.state === 'disabled')) return (await getModel(id)).model;
  if (current.state === 'checking') throw new DomainError('CHECK_RUNNING', '接入检查进行中，结束后再操作。', 409);
  await transaction(async (_client, tx) => {
    await tx.update(models).set({ state: disabled ? 'disabled' : 'stale', updatedAt: sql`now()` }).where(eq(models.id, id));
    await audit(actor, disabled ? 'disable_model' : 'reenable_model', current.modelId, {}, tx);
  });
  return (await getModel(id)).model;
}

/** Server-side only: what an adapter needs to call the service. Never serialize this. */
export async function serviceCredentials(id: string) {
  const row = await serviceRow(id);
  return { protocol: row.protocol, baseUrl: row.baseUrl, apiKey: openSecret(row.keyCiphertext), compat: row.compat as Compat, timeoutSeconds: row.timeoutSeconds };
}
