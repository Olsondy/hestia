import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DomainError } from '../../contracts/src/project';
import { transaction } from '../../persistence/src/client';
import { privateStore, type PrivateFileStore } from '../../files/src/storage';
import { DxfConversionError, runDxfConverter, type DxfConverterOptions } from '../../floorplan-import/src/dxf-converter';
import { buildFloorplanCandidate, dxfConverterOutputSchema, dxfDraftToHouseSpec, dxfScaleEvidence } from '../../floorplan-import/src/dxf';
import { importSourceId, type ImportRow } from './service';

export const MAX_IMPORT_ATTEMPTS = 3;
const leaseSeconds = () => {
  const value = Number(process.env.HESTIA_IMPORT_LEASE_SECONDS);
  return Number.isInteger(value) && value >= 2 && value <= 3600 ? value : 120;
};
export type ImportClaim = { row: ImportRow; generation: number; key: string };

async function locked(client: PoolClient, id: string) {
  const row = (await client.query<ImportRow & { lease_valid: boolean }>('SELECT *,lease_until>clock_timestamp() AS lease_valid FROM floorplan_imports WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!row) throw new DomainError('NOT_FOUND', '图纸不存在。', 404);
  return row;
}
/** Takes the conversion with a new generation and lease, or returns null when there is nothing left to do. */
export async function claimImport(id: string): Promise<ImportClaim | null> {
  return transaction(async client => {
    const row = await locked(client, id);
    if (!['queued', 'retry_wait', 'converting'].includes(row.status)) return null;
    if (row.status === 'converting' && row.lease_valid) throw new DomainError('IMPORT_BUSY', '该图纸正在转换。', 409);
    if (row.attempts >= MAX_IMPORT_ATTEMPTS) {
      await client.query("UPDATE floorplan_imports SET status='failed',lease_until=NULL,error=$2,updated_at=now() WHERE id=$1",
        [id, { code: 'RETRY_LIMIT', message: '转换多次中断并达到重试上限，可由企业成员辅助转换或重新上传。' }]);
      return null;
    }
    const generation = row.generation + 1;
    await client.query(`UPDATE floorplan_imports SET status='converting',generation=$2,attempts=attempts+1,
      lease_until=clock_timestamp()+make_interval(secs=>$3),error=NULL,updated_at=now() WHERE id=$1`, [id, generation, leaseSeconds()]);
    const key = (await client.query('SELECT object_key FROM resources WHERE id=$1 AND project_id=$2', [row.resource_id, row.project_id])).rows[0].object_key;
    return { row, generation, key };
  });
}
async function fence(client: PoolClient, claim: ImportClaim) {
  const row = await locked(client, claim.row.id);
  if (row.status !== 'converting' || row.generation !== claim.generation || !row.lease_valid)
    throw new DomainError('IMPORT_FENCE_LOST', '转换执行权已过期。', 409);
  return row;
}
/** Publishes the single automatic candidate (import revision 1) under the claim's fence. */
export async function publishImport(claim: ImportClaim, value: { houseSpec: unknown; candidate: unknown; scene: unknown; issues: unknown[]; conversion: unknown }) {
  await transaction(async client => {
    await fence(client, claim);
    await client.query(`INSERT INTO floorplan_candidates(id,import_id,project_id,import_revision,source,generation,review_status,house_spec,candidate,scene,issues,conversion)
      VALUES($1,$2,$3,1,'dxf-automatic',$4,'pending_review',$5,$6,$7,$8,$9)`,
    [randomUUID(), claim.row.id, claim.row.project_id, claim.generation, value.houseSpec, value.candidate, value.scene, JSON.stringify(value.issues), value.conversion]);
    await client.query("UPDATE floorplan_imports SET status='pending_review',lease_until=NULL,error=NULL,updated_at=now() WHERE id=$1", [claim.row.id]);
  });
}

/** Finite conversion of one import; does not start a queue consumer. Called by the import Worker per job. */
export async function runImport(id: string, options: { store?: PrivateFileStore; converter?: DxfConverterOptions } = {}) {
  const claim = await claimImport(id);
  if (!claim) return;
  try {
    const bytes = await (options.store ?? privateStore()).read(claim.key);
    if (createHash('sha256').update(bytes).digest('hex') !== claim.row.sha256)
      throw new DomainError('SOURCE_MISMATCH', '图纸文件校验失败，请重新上传。', 409);
    const parsed = dxfConverterOutputSchema.safeParse(await runDxfConverter(bytes, options.converter));
    if (!parsed.success) throw new DxfConversionError('CONVERTER_OUTPUT_INVALID', 'DXF 转换结果格式不正确。');
    const output = parsed.data, name = claim.row.file_name.replace(/\.dxf$/i, '');
    const { houseSpec, issues } = dxfDraftToHouseSpec(output, name);
    const result = buildFloorplanCandidate(houseSpec, importSourceId(claim.row.id), dxfScaleEvidence(output, claim.row.resource_id),
      `${name} · DXF 自动转换 · 待审核`);
    const { draft: _draft, ...conversion } = output;
    await publishImport(claim, { houseSpec, candidate: result.candidate, scene: result.scene, issues: [...issues, ...result.issues], conversion });
  } catch (error) {
    const retry = await transaction(async client => {
      const row = await locked(client, id);
      if (row.status !== 'converting' || row.generation !== claim.generation) return false;
      if (!row.lease_valid) return true;
      const known = error instanceof DxfConversionError || (error instanceof DomainError && error.code !== 'IMPORT_FENCE_LOST');
      const terminal = known || row.attempts >= MAX_IMPORT_ATTEMPTS;
      const detail = known ? { code: (error as DxfConversionError).code, message: (error as Error).message }
        : { code: 'IMPORT_INTERRUPTED', message: terminal ? '转换失败，可由企业成员辅助转换或重新上传。' : '转换中断，等待重试。' };
      await client.query('UPDATE floorplan_imports SET status=$2,lease_until=NULL,error=$3,updated_at=now() WHERE id=$1', [id, terminal ? 'failed' : 'retry_wait', detail]);
      return !terminal;
    });
    if (retry) throw error;
  }
}
