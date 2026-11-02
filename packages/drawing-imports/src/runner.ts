import { createHash, randomUUID } from 'node:crypto';
import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import { DomainError } from '../../contracts/src/project';
import { transaction, type Database } from '../../persistence/src/client';
import { floorplanCandidates, floorplanImports, resources } from '../../persistence/src/schema';
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

async function locked(tx: Database, id: string) {
  const [row] = await tx.select({ ...getTableColumns(floorplanImports), leaseValid: sql<boolean | null>`${floorplanImports.leaseUntil}>clock_timestamp()` })
    .from(floorplanImports).where(eq(floorplanImports.id, id)).for('update');
  if (!row) throw new DomainError('NOT_FOUND', '图纸不存在。', 404);
  return row;
}
/** Takes the conversion with a new generation and lease, or returns null when there is nothing left to do. */
export async function claimImport(id: string): Promise<ImportClaim | null> {
  return transaction(async (_client, tx) => {
    const row = await locked(tx, id);
    if (!['queued', 'retry_wait', 'converting'].includes(row.status)) return null;
    if (row.status === 'converting' && row.leaseValid) throw new DomainError('IMPORT_BUSY', '该图纸正在转换。', 409);
    if (row.attempts >= MAX_IMPORT_ATTEMPTS) {
      await tx.update(floorplanImports).set({ status: 'failed', leaseUntil: null, error: { code: 'RETRY_LIMIT', message: '转换多次中断并达到重试上限，可由企业成员辅助转换或重新上传。' },
        updatedAt: sql`now()` }).where(eq(floorplanImports.id, id));
      return null;
    }
    const generation = row.generation + 1;
    await tx.update(floorplanImports).set({ status: 'converting', generation, attempts: sql`${floorplanImports.attempts}+1`,
      leaseUntil: sql`clock_timestamp()+make_interval(secs=>${leaseSeconds()})`, error: null, updatedAt: sql`now()` }).where(eq(floorplanImports.id, id));
    const key = (await tx.select({ objectKey: resources.objectKey }).from(resources)
      .where(and(eq(resources.id, row.resourceId), eq(resources.projectId, row.projectId))))[0].objectKey;
    return { row, generation, key };
  });
}
async function fence(tx: Database, claim: ImportClaim) {
  const row = await locked(tx, claim.row.id);
  if (row.status !== 'converting' || row.generation !== claim.generation || !row.leaseValid)
    throw new DomainError('IMPORT_FENCE_LOST', '转换执行权已过期。', 409);
  return row;
}
/** Publishes the single automatic candidate (import revision 1) under the claim's fence. */
export async function publishImport(claim: ImportClaim, value: { houseSpec: unknown; candidate: unknown; scene: unknown; issues: unknown[]; conversion: unknown }) {
  await transaction(async (_client, tx) => {
    await fence(tx, claim);
    await tx.insert(floorplanCandidates).values({ id: randomUUID(), importId: claim.row.id, projectId: claim.row.projectId, importRevision: 1, source: 'dxf-automatic',
      generation: claim.generation, reviewStatus: 'pending_review', houseSpec: value.houseSpec, candidate: value.candidate, scene: value.scene,
      issues: value.issues, conversion: value.conversion });
    await tx.update(floorplanImports).set({ status: 'pending_review', leaseUntil: null, error: null, updatedAt: sql`now()` }).where(eq(floorplanImports.id, claim.row.id));
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
    const output = parsed.data, name = claim.row.fileName.replace(/\.dxf$/i, '');
    const { houseSpec, issues } = dxfDraftToHouseSpec(output, name);
    const result = buildFloorplanCandidate(houseSpec, importSourceId(claim.row.id), dxfScaleEvidence(output, claim.row.resourceId),
      `${name} · DXF 自动转换 · 待审核`);
    const { draft: _draft, ...conversion } = output;
    await publishImport(claim, { houseSpec, candidate: result.candidate, scene: result.scene, issues: [...issues, ...result.issues], conversion });
  } catch (error) {
    const retry = await transaction(async (_client, tx) => {
      const row = await locked(tx, id);
      if (row.status !== 'converting' || row.generation !== claim.generation) return false;
      if (!row.leaseValid) return true;
      const known = error instanceof DxfConversionError || (error instanceof DomainError && error.code !== 'IMPORT_FENCE_LOST');
      const terminal = known || row.attempts >= MAX_IMPORT_ATTEMPTS;
      const detail = known ? { code: (error as DxfConversionError).code, message: (error as Error).message }
        : { code: 'IMPORT_INTERRUPTED', message: terminal ? '转换失败，可由企业成员辅助转换或重新上传。' : '转换中断，等待重试。' };
      await tx.update(floorplanImports).set({ status: terminal ? 'failed' : 'retry_wait', leaseUntil: null, error: detail, updatedAt: sql`now()` })
        .where(eq(floorplanImports.id, id));
      return !terminal;
    });
    if (retry) throw error;
  }
}
