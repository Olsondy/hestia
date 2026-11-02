import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { PoolClient } from 'pg';
import type { PgBoss } from 'pg-boss';
import { DomainError, idSchema } from '../../contracts/src/project';
import {
  createFloorplanImportSchema, floorplanFormats, importHouseSpecSchema, MAX_FLOORPLAN_BYTES,
  type FloorplanCandidateView, type FloorplanFormat, type FloorplanImportView, type FloorplanIssue,
} from '../../contracts/src/floorplan-imports';
import { actorOf, projectAccess, type Principal } from '../../workspaces/src/access';
import { pool, transaction } from '../../persistence/src/client';
import { privateStore, type PrivateFileStore } from '../../files/src/storage';
import { buildFloorplanCandidate } from '../../floorplan-import/src/dxf';
import { enqueueImport } from './queue';

export type ImportRow = {
  id: string; project_id: string; actor_id: string; request_id: string; request_hash: string; resource_id: string;
  file_name: string; file_format: FloorplanFormat; byte_size: number; sha256: string; mode: 'automatic' | 'assisted';
  status: FloorplanImportView['status']; generation: number; attempts: number; lease_until: Date | null; revision: number;
  error: { code: string; message: string } | null; created_at: Date; updated_at: Date;
};
export type CandidateRow = {
  id: string; import_id: string; import_revision: number; source: FloorplanCandidateView['source']; review_status: 'pending_review';
  house_spec: unknown; candidate: { scale: { status: string; evidenceId?: string }; levels: unknown[]; floors: { walls: { openings: unknown[] }[]; rooms: { labels: { name: string }[] }[] }[] } | null;
  scene: unknown; issues: FloorplanIssue[]; conversion: { dimensionConflicts?: unknown[] } | null; created_at: Date;
};
const notFound = () => new DomainError('NOT_FOUND', '项目或图纸不存在。', 404);
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const labels = {
  automatic: 'DXF 自动转换 · 结果须经企业审核后才会发布',
  assisted: '辅助转换 · 该格式不会自动识别，由企业成员导入户型后继续',
} as const;
export const importSourceId = (importId: string) => `imp-${importId.slice(0, 8)}`;

/** File name only, without directories or control characters. */
function cleanName(fileName: string) {
  const name = path.basename(String(fileName).replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  if (!name) throw new DomainError('INVALID_INPUT', '图纸文件缺少文件名。');
  return name;
}
/** Extension selects the format; DXF bytes must also look like ASCII or binary DXF (a renamed DWG is rejected). */
export function detectFloorplanFormat(fileName: string, bytes: Uint8Array): FloorplanFormat {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  if (!Object.hasOwn(floorplanFormats, extension))
    throw new DomainError('UNSUPPORTED_FILE_TYPE', '支持 DXF（自动转换）以及 DWG、PDF、PNG、JPEG、WebP（辅助转换）。', 415);
  const format = extension as FloorplanFormat;
  if (format === 'dxf') {
    const head = Buffer.from(bytes.subarray(0, 4096)).toString('latin1');
    const binary = head.startsWith('AutoCAD Binary DXF');
    // ASCII DXF: optional 999 comments, then group code 0 + SECTION.
    const ascii = /^(?:﻿|\xEF\xBB\xBF)?\s*(?:999\r?\n[^\n]*\r?\n\s*)*0\r?\n\s*SECTION\s*\r?\n/.test(head);
    if (!binary && !ascii) throw new DomainError('INVALID_DXF', '文件扩展名是 DXF，但内容不是 DXF。DWG 请先在 CAD 中另存为 DXF。', 400);
  }
  return format;
}

function candidateView(row: CandidateRow): FloorplanCandidateView {
  const c = row.candidate;
  return { id: row.id, importRevision: row.import_revision, source: row.source, reviewStatus: row.review_status,
    valid: !!row.scene && !row.issues.some(i => i.severity === 'blocking'),
    scale: c?.scale ?? { status: 'missing' },
    summary: c ? { levels: c.levels.length, walls: c.floors.reduce((n, f) => n + f.walls.length, 0),
      openings: c.floors.reduce((n, f) => n + f.walls.reduce((m, w) => m + w.openings.length, 0), 0),
      rooms: c.floors.reduce((n, f) => n + f.rooms.length, 0),
      roomNames: c.floors.flatMap(f => f.rooms.flatMap(r => r.labels.map(l => l.name))) } : null,
    dimensionConflicts: row.conversion?.dimensionConflicts ?? [], issues: row.issues, createdAt: row.created_at.toISOString() };
}
export function importView(row: ImportRow, candidate?: CandidateRow | null): FloorplanImportView {
  return { id: row.id, projectId: row.project_id, status: row.status, mode: row.mode, label: labels[row.mode],
    file: { name: row.file_name, format: row.file_format, mediaType: floorplanFormats[row.file_format].mediaType, bytes: row.byte_size,
      sha256: row.sha256, resourceId: row.resource_id },
    revision: row.revision, attempts: row.attempts, error: row.error, candidate: candidate ? candidateView(candidate) : null,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
async function latestCandidate(client: Pick<PoolClient, 'query'>, importId: string) {
  return (await client.query<CandidateRow>('SELECT * FROM floorplan_candidates WHERE import_id=$1 ORDER BY import_revision DESC LIMIT 1', [importId])).rows[0] ?? null;
}
async function lockedImport(client: PoolClient, actor: string, projectId: string, importId: string) {
  const row = (await client.query<ImportRow>(`SELECT i.* FROM floorplan_imports i WHERE i.id=$1 AND i.project_id=$2
    AND ${projectAccess('i.project_id', '$3')} FOR UPDATE`, [importId, projectId, actor])).rows[0];
  if (!row) throw notFound(); return row;
}

/**
 * Accepts an uploaded drawing. Bytes are written to private storage before the transaction that publishes the
 * ready resource, the import record and (for DXF) the queued conversion job; a failed write never leaves a visible
 * import. Same operationId + same file returns the same import; a different file is an idempotency conflict.
 */
export async function createFloorplanImport(principal: Principal, projectId: string, input: unknown, bytes: Uint8Array,
  fileName: string, deps: { store?: PrivateFileStore; queue?: PgBoss } = {}) {
  const actor = actorOf(principal), id = idSchema.parse(projectId), value = createFloorplanImportSchema.parse(input);
  const store = deps.store ?? privateStore();
  const name = cleanName(fileName);
  if (!bytes.byteLength) throw new DomainError('INVALID_INPUT', '图纸文件为空。');
  if (bytes.byteLength > MAX_FLOORPLAN_BYTES) throw new DomainError('FILE_TOO_LARGE', `图纸文件不能超过 ${MAX_FLOORPLAN_BYTES / 1024 / 1024} MB。`, 413);
  const format = detectFloorplanFormat(name, bytes), digest = sha256(bytes);
  const automatic = floorplanFormats[format].automatic, requestHash = sha256(JSON.stringify({ projectId: id, name, digest }));
  const lease = await pool.connect(), lock = `floorplan-import:${actor}:${value.operationId}`;
  let resourceId = '', key = '', complete = false;
  const tx = async <T>(work: (client: PoolClient) => Promise<T>) => {
    await lease.query('BEGIN');
    try { const result = await work(lease); await lease.query('COMMIT'); return result; }
    catch (error) { await lease.query('ROLLBACK'); throw error; }
  };
  const previous = async (client: PoolClient) => {
    const row = (await client.query<ImportRow>('SELECT * FROM floorplan_imports WHERE actor_id=$1 AND request_id=$2', [actor, value.operationId])).rows[0];
    if (row && (row.project_id !== id || row.request_hash !== requestHash)) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同的文件或项目。', 409);
    return row;
  };
  const access = async (client: PoolClient) => {
    if (!(await client.query(`SELECT 1 FROM projects p WHERE p.id=$1 AND ${projectAccess('p.id', '$2')} FOR SHARE`, [id, actor])).rowCount) throw notFound();
  };
  try {
    await lease.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lock]);
    const existing = await tx(async client => {
      await access(client);
      const row = await previous(client);
      if (row) return row;
      resourceId = randomUUID(); key = `projects/${id}/resources/${resourceId}.src`;
      await client.query("INSERT INTO resources(id,project_id,object_key,media_type,state) VALUES($1,$2,$3,$4,'pending')",
        [resourceId, id, key, floorplanFormats[format].mediaType]);
      return null;
    });
    if (existing) { complete = true; return importView(existing, await latestCandidate(pool, existing.id)); }
    await store.put(key, bytes);
    const row = await tx(async client => {
      await access(client);
      if (await previous(client)) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作已在处理中。', 409);
      const importId = randomUUID();
      const inserted = (await client.query<ImportRow>(`INSERT INTO floorplan_imports(id,project_id,actor_id,request_id,request_hash,resource_id,
        file_name,file_format,byte_size,sha256,mode,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [importId, id, actor, value.operationId, requestHash, resourceId, name, format, bytes.byteLength, digest,
        automatic ? 'automatic' : 'assisted', automatic ? 'queued' : 'assisted_conversion'])).rows[0];
      await client.query("UPDATE resources SET state='ready' WHERE id=$1 AND project_id=$2 AND state='pending'", [resourceId, id]);
      if (automatic) await enqueueImport(client, importId, deps.queue);
      return inserted;
    });
    complete = true;
    return importView(row, null);
  } catch (error) {
    if (resourceId && !complete) {
      // A lost COMMIT acknowledgement may still have published the resource; delete bytes only when it is not ready.
      const failed = await lease.query("UPDATE resources SET state='failed' WHERE id=$1 AND project_id=$2 AND state<>'ready' RETURNING id", [resourceId, id]).catch(() => null);
      if (failed?.rowCount) await store.remove(key).catch(() => {});
    }
    if (error instanceof DomainError) throw error;
    throw new DomainError('FILE_SAVE_FAILED', '图纸未能保存，请重试。', 503);
  } finally { await lease.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock]).finally(() => lease.release()); }
}

export async function getFloorplanImport(principal: Principal, projectId: string, importId: string) {
  const row = (await pool.query<ImportRow>(`SELECT i.* FROM floorplan_imports i WHERE i.id=$1 AND i.project_id=$2 AND ${projectAccess('i.project_id', '$3')}`,
    [idSchema.parse(importId), idSchema.parse(projectId), actorOf(principal)])).rows[0];
  if (!row) throw notFound();
  return importView(row, await latestCandidate(pool, row.id));
}
export async function listFloorplanImports(principal: Principal, projectId: string) {
  const id = idSchema.parse(projectId), actor = actorOf(principal);
  if (!(await pool.query(`SELECT 1 FROM projects p WHERE p.id=$1 AND ${projectAccess('p.id', '$2')}`, [id, actor])).rowCount) throw notFound();
  const rows = (await pool.query<ImportRow>('SELECT * FROM floorplan_imports WHERE project_id=$1 ORDER BY created_at DESC LIMIT 20', [id])).rows;
  return Promise.all(rows.map(async row => importView(row, await latestCandidate(pool, row.id))));
}
/** Full latest candidate for review: HouseSpec, import candidate, preview scene and issues. */
export async function getFloorplanCandidate(principal: Principal, projectId: string, importId: string) {
  const view = await getFloorplanImport(principal, projectId, importId);
  const row = await latestCandidate(pool, view.id);
  if (!row) throw new DomainError('CANDIDATE_NOT_READY', '该图纸还没有空间候选。', 409);
  return { ...candidateView(row), houseSpec: row.house_spec, candidate: row.candidate, scene: row.scene, conversion: row.conversion };
}

/**
 * Member import of a HouseSpec (one storey or whole building) for an assisted, failed or pending-review drawing.
 * The result is validated by floorplan-import and the building contract and always waits for review.
 */
export async function importHouseSpec(principal: Principal, projectId: string, importId: string, input: unknown) {
  const actor = actorOf(principal), id = idSchema.parse(projectId), target = idSchema.parse(importId);
  const value = importHouseSpecSchema.parse(input);
  const requestHash = sha256(JSON.stringify({ kind: 'housespec', projectId: id, importId: target, ...value }));
  return transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`floorplan-housespec:${actor}:${value.operationId}`]);
    const row = await lockedImport(client, actor, id, target);
    const prior = (await client.query('SELECT request_hash,result FROM floorplan_import_operations WHERE actor_id=$1 AND id=$2', [actor, value.operationId])).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于另一请求。', 409);
      return prior.result as FloorplanImportView;
    }
    if (!['assisted_conversion', 'failed', 'pending_review'].includes(row.status))
      throw new DomainError('IMPORT_BUSY', '图纸正在自动转换，请等待结果后再导入户型。', 409);
    if (row.revision !== value.expectedRevision) throw new DomainError('IMPORT_REVISION_CONFLICT', '图纸记录已更新，请重新读取后再导入。', 409);
    const result = buildFloorplanCandidate(value.houseSpec, importSourceId(row.id), { status: 'estimated', evidenceId: `member-housespec-${row.id}` },
      `${value.name ?? '导入户型'} · 成员导入 · 待审核`);
    const revision = row.revision + 1;
    await client.query(`INSERT INTO floorplan_candidates(id,import_id,project_id,import_revision,source,created_by,review_status,house_spec,candidate,scene,issues)
      VALUES($1,$2,$3,$4,'member-housespec',$5,'pending_review',$6,$7,$8,$9)`,
    [randomUUID(), row.id, id, revision, actor, value.houseSpec, result.candidate, result.scene, JSON.stringify(result.issues)]);
    const updated = (await client.query<ImportRow>(`UPDATE floorplan_imports SET status='pending_review',revision=$2,error=NULL,lease_until=NULL,updated_at=now()
      WHERE id=$1 RETURNING *`, [row.id, revision])).rows[0];
    const view = importView(updated, await latestCandidate(client, row.id));
    await client.query('INSERT INTO floorplan_import_operations(actor_id,id,import_id,request_hash,result) VALUES($1,$2,$3,$4,$5)',
      [actor, value.operationId, row.id, requestHash, view]);
    return view;
  });
}

/** Original uploaded bytes, for project members only; the digest is checked before returning. */
export async function readFloorplanSource(principal: Principal, projectId: string, importId: string, store: PrivateFileStore = privateStore()) {
  const view = await getFloorplanImport(principal, projectId, importId);
  const resource = (await pool.query("SELECT object_key FROM resources WHERE id=$1 AND project_id=$2 AND state='ready'", [view.file.resourceId, view.projectId])).rows[0];
  if (!resource) throw new DomainError('RESOURCE_UNAVAILABLE', '图纸文件暂时不可用。', 503);
  try {
    const bytes = await store.read(resource.object_key);
    if (sha256(bytes) !== view.file.sha256) throw new Error('digest mismatch');
    return { bytes, mediaType: view.file.mediaType, fileName: view.file.name };
  } catch { throw new DomainError('RESOURCE_UNAVAILABLE', '图纸文件暂时不可读取，请稍后重试。', 503); }
}
