import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { PoolClient } from 'pg';
import { pool, transaction } from '../../persistence/src/client';
import { DomainError, idSchema } from '../../contracts/src/project';
import { MAX_IMAGE_PIXELS, MAX_UPLOAD_BYTES, saveUnderlaySchema, sourceToImage, updateUnderlaySchema, type UnderlayView } from '../../contracts/src/underlay';
import { getProject, getResource, type Principal } from '../../projects/src/service';
import { projectAccess } from '../../workspaces/src/access';
import { privateStore, type PrivateFileStore } from './storage';

async function leaseTransaction<T>(client: PoolClient, work: (client: PoolClient) => Promise<T>) {
  await client.query('BEGIN');
  try { const value = await work(client); await client.query('COMMIT'); return value; }
  catch(error) { await client.query('ROLLBACK'); throw error; }
}
const conflict = () => new DomainError('UNDERLAY_VERSION_CONFLICT', '底图已更新，请重新读取后再保存。', 409);
const notFound = () => new DomainError('NOT_FOUND', '项目或资源不存在。', 404);
export async function getUnderlay(principal: Principal, projectId: string): Promise<UnderlayView | null> {
  await getProject(principal, projectId);
  const row = (await pool.query('SELECT u.view FROM project_underlays u JOIN resources r ON r.id=u.resource_id AND r.project_id=u.project_id WHERE u.project_id=$1 AND r.state=\'ready\'', [projectId])).rows[0];
  return row?.view || null;
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
  const lease = await pool.connect();
  const lock = `underlay:${owner}:${value.operationId}`;
  let resourceId = '', objectKey = '', complete = false;
  try {
    await lease.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lock]);
    const reservation = await leaseTransaction(lease, async client => {
      const project = (await client.query(`SELECT id FROM projects p WHERE p.id=$1 AND ${projectAccess('p.id', '$2')} FOR UPDATE`, [projectId, owner])).rows[0];
      if (!project) throw notFound();
      const previous = (await client.query('SELECT * FROM underlay_operations WHERE owner_id=$1 AND id=$2', [owner,value.operationId])).rows[0];
      if (previous && (previous.project_id !== projectId || previous.request_hash !== hash)) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同的文件或请求。', 409);
      if (previous?.result) return { result: previous.result as UnderlayView, resourceId: '', key: '' };
      const version = (await client.query('SELECT version FROM project_underlays WHERE project_id=$1', [projectId])).rows[0]?.version || 0;
      if (version !== value.expectedVersion) throw conflict();
      const resourceId = previous?.resource_id || randomUUID(), key = `projects/${projectId}/resources/${resourceId}.png`;
      if (!previous) {
        await client.query('INSERT INTO resources(id,project_id,object_key,media_type,state) VALUES($1,$2,$3,\'image/png\',\'pending\')', [resourceId,projectId,key]);
        await client.query('INSERT INTO underlay_operations(owner_id,id,project_id,resource_id,request_hash) VALUES($1,$2,$3,$4,$5)', [owner,value.operationId,projectId,resourceId,hash]);
      } else await client.query('UPDATE resources SET state=\'pending\' WHERE id=$1 AND project_id=$2 AND state<>\'ready\'', [resourceId,projectId]);
      return { resourceId, key, result: null };
    });
    if (reservation.result) { complete = true; return reservation.result; }
    resourceId = reservation.resourceId; objectKey = reservation.key;
    await store.put(objectKey, image.data);
    const result = await leaseTransaction(lease, async client => {
      const project = (await client.query(`SELECT id FROM projects p WHERE p.id=$1 AND ${projectAccess('p.id', '$2')} FOR UPDATE`, [projectId,owner])).rows[0];
      if (!project) throw notFound();
      const current = (await client.query('SELECT version FROM project_underlays WHERE project_id=$1', [projectId])).rows[0]?.version || 0;
      if (current !== value.expectedVersion) throw conflict();
      const view: UnderlayView = { projectId,resourceId,version:current+1,width,height,source:value.source,crop:value.crop,rotation:value.rotation,sourceToImage:sourceToImage(value.crop,value.rotation),display:value.display,calibration:'uncalibrated',registration:'unregistered',updatedAt:new Date().toISOString() };
      await client.query('UPDATE resources SET state=\'ready\' WHERE id=$1 AND project_id=$2 AND state=\'pending\'', [resourceId,projectId]);
      await client.query('INSERT INTO project_underlays(project_id,resource_id,version,view) VALUES($1,$2,$3,$4) ON CONFLICT(project_id) DO UPDATE SET resource_id=EXCLUDED.resource_id,version=EXCLUDED.version,view=EXCLUDED.view,updated_at=now()', [projectId,resourceId,view.version,view]);
      await client.query('UPDATE underlay_operations SET result=$3 WHERE owner_id=$1 AND id=$2', [owner,value.operationId,view]);
      return view;
    });
    complete = true; return result;
  } catch (error) {
    if (resourceId && !complete) {
      // COMMIT may have succeeded even when its response was lost. Never delete
      // bytes unless the database positively confirms this resource is not ready.
      const failed = await lease.query('UPDATE resources SET state=\'failed\' WHERE id=$1 AND project_id=$2 AND state<>\'ready\' RETURNING id', [resourceId,projectId]).catch(() => null);
      if (failed?.rowCount) await store.remove(objectKey).catch(() => {});
    }
    if (error instanceof DomainError) throw error;
    throw new DomainError('FILE_SAVE_FAILED', '文件未能保存，当前底图保持不变。请重试。', 503);
  } finally { await lease.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock]).finally(() => lease.release()); }
}

export async function updateUnderlay(principal: Principal, projectId: string, input: unknown) {
  const value = updateUnderlaySchema.parse(input), id = idSchema.parse(projectId), owner = principal.userId;
  if (!owner) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  const hash = createHash('sha256').update(JSON.stringify({kind:'display',projectId:id,...value})).digest('hex');
  return transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`underlay:${owner}:${value.operationId}`]);
    if (!(await client.query(`SELECT id FROM projects p WHERE p.id=$1 AND ${projectAccess('p.id', '$2')} FOR UPDATE`, [id,owner])).rowCount) throw notFound();
    const prior = (await client.query('SELECT request_hash,result FROM underlay_operations WHERE owner_id=$1 AND id=$2', [owner,value.operationId])).rows[0];
    if (prior) { if (prior.request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于另一请求。', 409); return prior.result as UnderlayView; }
    const row = (await client.query('SELECT u.view FROM project_underlays u JOIN resources r ON r.id=u.resource_id AND r.project_id=u.project_id WHERE u.project_id=$1 AND u.resource_id=$2 AND r.state=\'ready\'', [id,value.resourceId])).rows[0];
    if (!row) throw notFound();
    const current = row.view as UnderlayView;
    if (current.version !== value.expectedVersion) throw conflict();
    const view = {...current,display:value.display,version:current.version+1,updatedAt:new Date().toISOString()};
    await client.query('UPDATE project_underlays SET version=$2,view=$3,updated_at=now() WHERE project_id=$1', [id,view.version,view]);
    await client.query('INSERT INTO underlay_operations(owner_id,id,project_id,resource_id,request_hash,result) VALUES($1,$2,$3,$4,$5,$6)', [owner,value.operationId,id,value.resourceId,hash,view]);
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
