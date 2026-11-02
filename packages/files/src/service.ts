import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { PoolClient } from 'pg';
import { and, eq, ne, sql } from 'drizzle-orm';
import { db, orm, pool, transaction, type Database } from '../../persistence/src/client';
import { projects, projectUnderlays, resources, underlayOperations } from '../../persistence/src/schema';
import { DomainError, idSchema } from '../../contracts/src/project';
import { MAX_IMAGE_PIXELS, MAX_UPLOAD_BYTES, saveUnderlaySchema, sourceToImage, updateUnderlaySchema, type UnderlayView } from '../../contracts/src/underlay';
import { getProject, getResource, type Principal } from '../../projects/src/service';
import { canAccessProject } from '../../workspaces/src/access';
import { privateStore, type PrivateFileStore } from './storage';

async function leaseTransaction<T>(client: PoolClient, work: (tx: Database) => Promise<T>) {
  await client.query('BEGIN');
  try { const value = await work(orm(client)); await client.query('COMMIT'); return value; }
  catch(error) { await client.query('ROLLBACK'); throw error; }
}
const conflict = () => new DomainError('UNDERLAY_VERSION_CONFLICT', '底图已更新，请重新读取后再保存。', 409);
const notFound = () => new DomainError('NOT_FOUND', '项目或资源不存在。', 404);
// hashtextextended (not advisoryXactLock's hashtext): saveUnderlay's session lock and updateUnderlay's xact lock must share a key.
const lockKey = (key: string) => sql`hashtextextended(${key},0)`;
const lockProject = async (tx: Database, projectId: string, owner: string) => (await tx.select({ id: projects.id }).from(projects)
  .where(and(eq(projects.id, projectId), canAccessProject(projects.id, owner))).for('update'))[0];
const currentVersion = async (tx: Database, projectId: string) =>
  (await tx.select({ version: projectUnderlays.version }).from(projectUnderlays).where(eq(projectUnderlays.projectId, projectId)))[0]?.version || 0;
const readyUnderlay = (tx: Database, ...where: Parameters<typeof and>) => tx.select({ view: projectUnderlays.view }).from(projectUnderlays)
  .innerJoin(resources, and(eq(resources.id, projectUnderlays.resourceId), eq(resources.projectId, projectUnderlays.projectId)))
  .where(and(...where, eq(resources.state, 'ready')));
export async function getUnderlay(principal: Principal, projectId: string): Promise<UnderlayView | null> {
  await getProject(principal, projectId);
  const [row] = await readyUnderlay(db, eq(projectUnderlays.projectId, projectId));
  return (row?.view as UnderlayView) || null;
}
async function decodeImage(bytes: Uint8Array, mediaType: string) {
  if (!['image/png','image/jpeg','image/webp'].includes(mediaType)) throw new DomainError('INVALID_FILE_TYPE', '只接受 PNG、JPEG 或 WebP 图片；PDF 请先在浏览器选择页面。', 415);
  if (!bytes.byteLength || bytes.byteLength > MAX_UPLOAD_BYTES) throw new DomainError('FILE_TOO_LARGE', '所选图像不能超过 12 MB。', 413);
  try {
    const image = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' });
    const meta = await image.metadata();
    const expected = { 'image/png':'png', 'image/jpeg':'jpeg', 'image/webp':'webp' }[mediaType];
    if (meta.format !== expected || (meta.pages || 1) > 1) throw new Error('Mismatched or animated image');
    const normalized = await image.rotate().png().toBuffer({ resolveWithObject: true });
    if (normalized.info.width * normalized.info.height > MAX_IMAGE_PIXELS || normalized.data.length > 24*1024*1024) throw new Error('Decoded image exceeds limits');
    return normalized;
  } catch { throw new DomainError('INVALID_IMAGE', '图片损坏、类型不符或像素过大，请重新选择不超过 1600 万像素的静态图片。', 400); }
}

/** Durable file completion precedes the transaction publishing a ready resource and underlay. */
export async function saveUnderlay(principal: Principal, projectId: string, input: unknown, bytes: Uint8Array, mediaType: string, store: PrivateFileStore = privateStore()) {
  await getProject(principal, projectId);
  const value = saveUnderlaySchema.parse(input), owner = principal.userId;
  const image = await decodeImage(bytes, mediaType);
  const width = value.rotation % 180 ? value.crop.height : value.crop.width, height = value.rotation % 180 ? value.crop.width : value.crop.height;
  if (image.info.width !== width || image.info.height !== height) throw new DomainError('IMAGE_TRANSFORM_MISMATCH', '图像尺寸与选定区域不一致，请重新导出所选区域。');
  const hash = createHash('sha256').update(JSON.stringify(value)).update(createHash('sha256').update(bytes).digest()).digest('hex');
  const connection = await pool.connect(), lease = orm(connection);
  const lock = `underlay:${owner}:${value.operationId}`;
  let resourceId = '', objectKey = '', complete = false;
  try {
    await lease.execute(sql`SELECT pg_advisory_lock(${lockKey(lock)})`);
    const reservation = await leaseTransaction(connection, async tx => {
      if (!await lockProject(tx, projectId, owner)) throw notFound();
      const [previous] = await tx.select().from(underlayOperations).where(and(eq(underlayOperations.actorId, owner), eq(underlayOperations.id, value.operationId)));
      if (previous && (previous.projectId !== projectId || previous.requestHash !== hash)) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同的文件或请求。', 409);
      if (previous?.result) return { result: previous.result as UnderlayView, resourceId: '', key: '' };
      if (await currentVersion(tx, projectId) !== value.expectedVersion) throw conflict();
      const resourceId = previous?.resourceId || randomUUID(), key = `projects/${projectId}/resources/${resourceId}.png`;
      if (!previous) {
        await tx.insert(resources).values({ id: resourceId, projectId, objectKey: key, mediaType: 'image/png', state: 'pending' });
        await tx.insert(underlayOperations).values({ actorId: owner, id: value.operationId, projectId, resourceId, requestHash: hash });
      } else await tx.update(resources).set({ state: 'pending' }).where(and(eq(resources.id, resourceId), eq(resources.projectId, projectId), ne(resources.state, 'ready')));
      return { resourceId, key, result: null };
    });
    if (reservation.result) { complete = true; return reservation.result; }
    resourceId = reservation.resourceId; objectKey = reservation.key;
    await store.put(objectKey, image.data);
    const result = await leaseTransaction(connection, async tx => {
      if (!await lockProject(tx, projectId, owner)) throw notFound();
      const current = await currentVersion(tx, projectId);
      if (current !== value.expectedVersion) throw conflict();
      const view: UnderlayView = { projectId,resourceId,version:current+1,width,height,source:value.source,crop:value.crop,rotation:value.rotation,sourceToImage:sourceToImage(value.crop,value.rotation),display:value.display,calibration:'uncalibrated',registration:'unregistered',updatedAt:new Date().toISOString() };
      await tx.update(resources).set({ state: 'ready' }).where(and(eq(resources.id, resourceId), eq(resources.projectId, projectId), eq(resources.state, 'pending')));
      await tx.insert(projectUnderlays).values({ projectId, resourceId, version: view.version, view })
        .onConflictDoUpdate({ target: projectUnderlays.projectId, set: { resourceId, version: view.version, view, updatedAt: sql`now()` } });
      await tx.update(underlayOperations).set({ result: view }).where(and(eq(underlayOperations.actorId, owner), eq(underlayOperations.id, value.operationId)));
      return view;
    });
    complete = true; return result;
  } catch (error) {
    if (resourceId && !complete) {
      // COMMIT may have succeeded even when its response was lost. Never delete
      // bytes unless the database positively confirms this resource is not ready.
      const failed = await lease.update(resources).set({ state: 'failed' })
        .where(and(eq(resources.id, resourceId), eq(resources.projectId, projectId), ne(resources.state, 'ready'))).returning({ id: resources.id }).catch(() => null);
      if (failed?.length) await store.remove(objectKey).catch(() => {});
    }
    if (error instanceof DomainError) throw error;
    throw new DomainError('FILE_SAVE_FAILED', '文件未能保存，当前底图保持不变。请重试。', 503);
  } finally { await lease.execute(sql`SELECT pg_advisory_unlock(${lockKey(lock)})`).finally(() => connection.release()); }
}

export async function updateUnderlay(principal: Principal, projectId: string, input: unknown) {
  const value = updateUnderlaySchema.parse(input), id = idSchema.parse(projectId), owner = principal.userId;
  if (!owner) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  const hash = createHash('sha256').update(JSON.stringify({kind:'display',projectId:id,...value})).digest('hex');
  return transaction(async (_client, tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey(`underlay:${owner}:${value.operationId}`)})`);
    if (!await lockProject(tx, id, owner)) throw notFound();
    const [prior] = await tx.select({ requestHash: underlayOperations.requestHash, result: underlayOperations.result }).from(underlayOperations)
      .where(and(eq(underlayOperations.actorId, owner), eq(underlayOperations.id, value.operationId)));
    if (prior) { if (prior.requestHash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于另一请求。', 409); return prior.result as UnderlayView; }
    const [row] = await readyUnderlay(tx, eq(projectUnderlays.projectId, id), eq(projectUnderlays.resourceId, value.resourceId));
    if (!row) throw notFound();
    const current = row.view as UnderlayView;
    if (current.version !== value.expectedVersion) throw conflict();
    const view = {...current,display:value.display,version:current.version+1,updatedAt:new Date().toISOString()};
    await tx.update(projectUnderlays).set({ version: view.version, view, updatedAt: sql`now()` }).where(eq(projectUnderlays.projectId, id));
    await tx.insert(underlayOperations).values({ actorId: owner, id: value.operationId, projectId: id, resourceId: value.resourceId, requestHash: hash, result: view });
    return view;
  });
}

export async function readPrivateImage(principal: Principal, projectId: string, resourceId: string, store: PrivateFileStore = privateStore()) {
  const resource = await getResource(principal, projectId, resourceId);
  if (resource.state !== 'ready') throw new DomainError('RESOURCE_NOT_READY', '文件尚未保存完成，请稍后重试。', 409);
  if (resource.media_type !== 'image/png') throw new DomainError('INVALID_RESOURCE', '该资源不是可用的底图图片。', 415);
  try { return await store.read(resource.object_key); }
  catch { throw new DomainError('RESOURCE_UNAVAILABLE', '文件暂时不可读取，请稍后重试。', 503); }
}
