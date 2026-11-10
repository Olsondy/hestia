import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { and, eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { DomainError } from '../../contracts/src/project';
import { orm, transaction } from '../../persistence/src/client';
import { projectRenders, renderAttempts, resources } from '../../persistence/src/schema';
import { privateStore, type PrivateFileStore } from '../../files/src/storage';
import type { RenderRow } from './service';
import { renderArtifact, schemeShot } from './image';
import { hash, bytesHash, renderVersions } from './versions';
import { RENDER_LEASE_SECONDS } from './queue';
import { resourceKey } from '../../files/src/keys';

// Capture the code/assets this module was loaded alongside. A long-lived Worker must not
// label an old in-memory renderer with newer source files' fingerprints after a hot edit.
const loadedVersions = renderVersions();

export type RenderClaim = { render: RenderRow; generation: number; resourceId: string; key: string };
async function locked(client: PoolClient, id: string) {
  const [row] = await orm(client).select().from(projectRenders).where(eq(projectRenders.id, id)).for('update');
  if (!row) throw new DomainError('NOT_FOUND', '静态成果不存在。', 404); return row as RenderRow;
}
/** Read after the row lock: the lease is judged at lock time, not before a lock wait. */
async function leaseValid(client: PoolClient, id: string) {
  const [{ valid }] = await orm(client).select({ valid: sql<boolean | null>`${projectRenders.leaseUntil}>clock_timestamp()` }).from(projectRenders).where(eq(projectRenders.id, id));
  return valid;
}
async function fence(client: PoolClient, claim: RenderClaim) {
  const row = await locked(client, claim.render.id), valid = await leaseValid(client, row.id);
  if (row.status !== 'running' || row.generation !== claim.generation || !valid)
    throw new DomainError('RENDER_FENCE_LOST', '渲染执行权已过期。', 409);
  return row;
}
export async function claimRender(id: string): Promise<RenderClaim | null> {
  return transaction(async (client, tx) => {
    const row = await locked(client, id);
    if (['completed', 'failed'].includes(row.status)) return null;
    const valid = await leaseValid(client, id);
    if (row.status === 'running' && valid) throw new DomainError('RENDER_BUSY', '此成果正在生成。', 409);
    if (row.attempts >= 3) {
      await tx.update(projectRenders).set({ status: 'failed', leaseUntil: null, error: { code: 'RETRY_LIMIT', message: '生成失败并达到重试上限，可重新发起。' },
        updatedAt: sql`now()` }).where(eq(projectRenders.id, id)); return null;
    }
    const generation = row.generation + 1, resourceId = randomUUID(), key = await resourceKey(tx, row.projectId, resourceId, 'png');
    await tx.insert(resources).values({ id: resourceId, projectId: row.projectId, objectKey: key, mediaType: 'image/png', state: 'pending' });
    await tx.insert(renderAttempts).values({ renderId: id, generation, resourceId });
    await tx.update(projectRenders).set({ status: 'running', generation, attempts: sql`${projectRenders.attempts}+1`,
      leaseUntil: sql`clock_timestamp()+make_interval(secs => ${RENDER_LEASE_SECONDS})`, error: null, updatedAt: sql`now()` }).where(eq(projectRenders.id, id));
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
  await transaction(async (client, tx) => {
    await fence(client, claim);
    await tx.update(resources).set({ state: 'ready' }).where(and(eq(resources.id, claim.resourceId), eq(resources.projectId, claim.render.projectId)));
    await tx.update(projectRenders).set({ status: 'completed', resourceId: claim.resourceId, width: metadata.width, height: metadata.height, imageHash,
      leaseUntil: null, error: null, updatedAt: sql`now()` }).where(eq(projectRenders.id, claim.render.id));
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
    if (versions.assetVersion !== row.assetVersion || versions.rendererVersion !== row.rendererVersion)
      throw new DomainError('RENDER_VERSION_CHANGED', '生成规则已更新，请按当前规则重新生成。', 409);
    if (hash({ scene: row.snapshot, source: row.source, scale: row.scale, synthetic: row.synthetic }) !== row.snapshotHash)
      throw new DomainError('SNAPSHOT_MISMATCH', '来源快照校验失败。', 409);
    const preset = row.source.kind === 'scheme' ? schemeShot(row.snapshot) : undefined;
    const bytes = await (options.render ?? renderArtifact)(row.snapshot, row.label,
      `项目修订 ${row.source.projectRevision}　快照 ${row.snapshotHash.slice(0, 12)}　资产 ${row.assetVersion.slice(0, 8)}　渲染 ${row.rendererVersion.slice(0, 8)}`,
      undefined, preset ? { preset } : undefined);
    const after = await renderVersions();
    if (after.assetVersion !== versions.assetVersion || after.rendererVersion !== versions.rendererVersion)
      throw new DomainError('RENDER_VERSION_CHANGED', '生成期间规则已更新，请重新生成。', 409);
    await publishRender(claim, bytes, options.store ?? privateStore());
  } catch (error) {
    const retry = await transaction(async (client, tx) => {
      const row = await locked(client, id);
      if (row.status !== 'running' || row.generation !== claim.generation) return false;
      if (!(await leaseValid(client, id))) return true;
      const terminal = error instanceof DomainError && error.code !== 'RENDER_FENCE_LOST' || row.attempts >= 3;
      await tx.update(projectRenders).set({ status: terminal ? 'failed' : 'retry_wait', leaseUntil: null, updatedAt: sql`now()`,
        error: error instanceof DomainError ? { code: error.code, message: error.message } : { code: 'RENDER_INTERRUPTED', message: terminal ? '生成失败，请重新发起。' : '生成中断，等待重试。' } })
        .where(eq(projectRenders.id, id));
      return !terminal;
    });
    // Do not delete any upload here: its response or the publishing COMMIT may have been lost.
    if (retry) throw error;
  }
}
