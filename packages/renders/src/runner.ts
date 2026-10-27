import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import sharp from 'sharp';
import { DomainError } from '../../contracts/src/project';
import { transaction } from '../../persistence/src/client';
import { privateStore, type PrivateFileStore } from '../../files/src/storage';
import type { RenderRow } from './service';
import { renderArtifact } from './image';
import { hash, bytesHash, renderVersions } from './versions';

// Capture the code/assets this module was loaded alongside. A long-lived Worker must not
// label an old in-memory renderer with newer source files' fingerprints after a hot edit.
const loadedVersions = renderVersions();

export type RenderClaim = { render: RenderRow; generation: number; resourceId: string; key: string };
async function locked(client: PoolClient, id: string) {
  const row = (await client.query<RenderRow>('SELECT * FROM project_renders WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!row) throw new DomainError('NOT_FOUND', '静态成果不存在。', 404); return row;
}
async function fence(client: PoolClient, claim: RenderClaim) {
  const row = await locked(client, claim.render.id);
  const valid = (await client.query('SELECT lease_until>clock_timestamp() AS valid FROM project_renders WHERE id=$1', [row.id])).rows[0].valid;
  if (row.status !== 'running' || row.generation !== claim.generation || !valid)
    throw new DomainError('RENDER_FENCE_LOST', '渲染执行权已过期。', 409);
  return row;
}
export async function claimRender(id: string): Promise<RenderClaim | null> {
  return transaction(async client => {
    const row = await locked(client, id);
    if (['completed', 'failed'].includes(row.status)) return null;
    const valid = (await client.query('SELECT lease_until>clock_timestamp() AS valid FROM project_renders WHERE id=$1', [id])).rows[0].valid;
    if (row.status === 'running' && valid) throw new DomainError('RENDER_BUSY', '此成果正在生成。', 409);
    if (row.attempts >= 3) {
      await client.query("UPDATE project_renders SET status='failed',lease_until=NULL,error=$2,updated_at=now() WHERE id=$1", [id,
        { code: 'RETRY_LIMIT', message: '生成失败并达到重试上限，可重新发起。' }]); return null;
    }
    const generation = row.generation + 1, resourceId = randomUUID(), key = `projects/${row.project_id}/resources/${resourceId}.png`;
    await client.query("INSERT INTO resources(id,project_id,object_key,media_type,state) VALUES($1,$2,$3,'image/png','pending')", [resourceId, row.project_id, key]);
    await client.query('INSERT INTO render_attempts(render_id,generation,resource_id) VALUES($1,$2,$3)', [id, generation, resourceId]);
    await client.query("UPDATE project_renders SET status='running',generation=$2,attempts=attempts+1,lease_until=clock_timestamp()+interval '120 seconds',error=NULL,updated_at=now() WHERE id=$1", [id, generation]);
    return { render: row, generation, resourceId, key };
  });
}
export async function publishRender(claim: RenderClaim, bytes: Uint8Array, store: PrivateFileStore) {
  // Each generation owns a different key. A late upload cannot overwrite a published generation.
  const imageHash = bytesHash(bytes), metadata = await sharp(bytes).metadata();
  if (metadata.format !== 'png' || !metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096 || bytes.byteLength > 24 * 1024 * 1024)
    throw new DomainError('INVALID_RENDER_OUTPUT', '生成文件格式或尺寸不正确。');
  await transaction(client => fence(client, claim));
  await store.put(claim.key, bytes);
  if (bytesHash(await store.read(claim.key)) !== imageHash) throw new Error('Uploaded render digest mismatch');
  await transaction(async client => {
    await fence(client, claim);
    await client.query("UPDATE resources SET state='ready' WHERE id=$1 AND project_id=$2", [claim.resourceId, claim.render.project_id]);
    await client.query(`UPDATE project_renders SET status='completed',resource_id=$2,width=$3,height=$4,image_hash=$5,
      lease_until=NULL,error=NULL,updated_at=now() WHERE id=$1`, [claim.render.id, claim.resourceId, metadata.width, metadata.height, imageHash]);
  });
}
/** Finite render invocation; does not start a queue consumer, HTTP server or background loop. */
export async function runRender(id: string, options: { store?: PrivateFileStore; render?: (...args: Parameters<typeof renderArtifact>) => Promise<Uint8Array> } = {}) {
  const claim = await claimRender(id);
  if (!claim) return;
  try {
    const { render: row } = claim, versions = await renderVersions(), loaded = await loadedVersions;
    if (loaded.assetVersion !== versions.assetVersion || loaded.rendererVersion !== versions.rendererVersion)
      throw new DomainError('RENDER_VERSION_CHANGED', '渲染进程加载的规则已过期，请更新后重新生成。', 409);
    if (versions.assetVersion !== row.asset_version || versions.rendererVersion !== row.renderer_version)
      throw new DomainError('RENDER_VERSION_CHANGED', '生成规则已更新，请按当前规则重新生成。', 409);
    if (hash({ scene: row.snapshot, source: row.source, scale: row.scale, synthetic: row.synthetic }) !== row.snapshot_hash)
      throw new DomainError('SNAPSHOT_MISMATCH', '来源快照校验失败。', 409);
    const bytes = await (options.render ?? renderArtifact)(row.snapshot, row.label,
      `项目修订 ${row.source.projectRevision}　快照 ${row.snapshot_hash.slice(0, 12)}　资产 ${row.asset_version.slice(0, 8)}　渲染 ${row.renderer_version.slice(0, 8)}`);
    const after = await renderVersions();
    if (after.assetVersion !== versions.assetVersion || after.rendererVersion !== versions.rendererVersion)
      throw new DomainError('RENDER_VERSION_CHANGED', '生成期间规则已更新，请重新生成。', 409);
    await publishRender(claim, bytes, options.store ?? privateStore());
  } catch (error) {
    const retry = await transaction(async client => {
      const row = await locked(client, id);
      if (row.status !== 'running' || row.generation !== claim.generation) return false;
      if (!(await client.query('SELECT lease_until>clock_timestamp() AS valid FROM project_renders WHERE id=$1', [id])).rows[0].valid) return true;
      const terminal = error instanceof DomainError && error.code !== 'RENDER_FENCE_LOST' || row.attempts >= 3;
      await client.query('UPDATE project_renders SET status=$2,lease_until=NULL,error=$3,updated_at=now() WHERE id=$1', [id, terminal ? 'failed' : 'retry_wait',
        error instanceof DomainError ? { code: error.code, message: error.message } : { code: 'RENDER_INTERRUPTED', message: terminal ? '生成失败，请重新发起。' : '生成中断，等待重试。' }]);
      return !terminal;
    });
    // Do not delete any upload here: its response or the publishing COMMIT may have been lost.
    if (retry) throw error;
  }
}
