import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { PgBoss } from 'pg-boss';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { DomainError, idSchema } from '../../contracts/src/project';
import {
  createFloorplanImportSchema, floorplanFormats, importHouseSpecSchema, MAX_FLOORPLAN_BYTES,
  type FloorplanCandidateView, type FloorplanFormat, type FloorplanImportView, type FloorplanIssue,
} from '../../contracts/src/floorplan-imports';
import { actorOf, canAccessProject, type Principal } from '../../workspaces/src/access';
import { db, orm, pool, transaction, type Database } from '../../persistence/src/client';
import { floorplanCandidates, floorplanImportOperations, floorplanImports, projects, resources } from '../../persistence/src/schema';
import { privateStore, type PrivateFileStore } from '../../files/src/storage';
import { buildFloorplanCandidate } from '../../floorplan-import/src/dxf';
import { enqueueImport } from './queue';

export type ImportRow = typeof floorplanImports.$inferSelect;
export type CandidateRow = typeof floorplanCandidates.$inferSelect;
type CandidateShape = { scale: { status: string; evidenceId?: string }; levels: unknown[]; floors: { walls: { openings: unknown[] }[]; rooms: { labels: { name: string }[] }[] }[] };
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
  const c = row.candidate as CandidateShape | null, issues = row.issues as FloorplanIssue[];
  return { id: row.id, importRevision: row.importRevision, source: row.source, reviewStatus: row.reviewStatus,
    valid: !!row.scene && !issues.some(i => i.severity === 'blocking'),
    scale: c?.scale ?? { status: 'missing' },
    summary: c ? { levels: c.levels.length, walls: c.floors.reduce((n, f) => n + f.walls.length, 0),
      openings: c.floors.reduce((n, f) => n + f.walls.reduce((m, w) => m + w.openings.length, 0), 0),
      rooms: c.floors.reduce((n, f) => n + f.rooms.length, 0),
      roomNames: c.floors.flatMap(f => f.rooms.flatMap(r => r.labels.map(l => l.name))) } : null,
    dimensionConflicts: (row.conversion as { dimensionConflicts?: unknown[] } | null)?.dimensionConflicts ?? [], issues, createdAt: row.createdAt.toISOString() };
}
export function importView(row: ImportRow, candidate?: CandidateRow | null): FloorplanImportView {
  return { id: row.id, projectId: row.projectId, status: row.status, mode: row.mode, label: labels[row.mode],
    file: { name: row.fileName, format: row.fileFormat, mediaType: floorplanFormats[row.fileFormat].mediaType, bytes: row.byteSize,
      sha256: row.sha256, resourceId: row.resourceId },
    revision: row.revision, attempts: row.attempts, error: row.error as FloorplanImportView['error'], candidate: candidate ? candidateView(candidate) : null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
async function latestCandidate(tx: Database, importId: string) {
  const [row] = await tx.select().from(floorplanCandidates).where(eq(floorplanCandidates.importId, importId))
    .orderBy(desc(floorplanCandidates.importRevision)).limit(1);
  return row ?? null;
}
async function lockedImport(tx: Database, actor: string, projectId: string, importId: string) {
  const [row] = await tx.select().from(floorplanImports).where(and(eq(floorplanImports.id, importId), eq(floorplanImports.projectId, projectId),
    canAccessProject(floorplanImports.projectId, actor))).for('update');
  if (!row) throw notFound(); return row;
}

/**
 * Accepts an uploaded drawing. Bytes are written to private storage before the transaction that publishes the
 * ready resource, the import record and (for DXF) the queued conversion job; a failed write never leaves a visible
 * import. Same operationId + same file returns the same import; a different file is an idempotency conflict.
 */
export async function createFloorplanImport(principal: Principal, projectId: string, input: unknown, bytes: Uint8Array,
  fileName: string, deps: { store?: PrivateFileStore; queue?: PgBoss; /** Caller already authorised the actor for this project (customer request flow). */ authorized?: boolean } = {}) {
  const actor = actorOf(principal), id = idSchema.parse(projectId), value = createFloorplanImportSchema.parse(input);
  const store = deps.store ?? privateStore();
  const name = cleanName(fileName);
  if (!bytes.byteLength) throw new DomainError('INVALID_INPUT', '图纸文件为空。');
  if (bytes.byteLength > MAX_FLOORPLAN_BYTES) throw new DomainError('FILE_TOO_LARGE', `图纸文件不能超过 ${MAX_FLOORPLAN_BYTES / 1024 / 1024} MB。`, 413);
  const format = detectFloorplanFormat(name, bytes), digest = sha256(bytes);
  const automatic = floorplanFormats[format].automatic, requestHash = sha256(JSON.stringify({ projectId: id, name, digest }));
  const lease = await pool.connect(), leaseDb = orm(lease), lock = `floorplan-import:${actor}:${value.operationId}`;
  let resourceId = '', key = '', complete = false;
  const tx = async <T>(work: () => Promise<T>) => {
    await lease.query('BEGIN');
    try { const result = await work(); await lease.query('COMMIT'); return result; }
    catch (error) { await lease.query('ROLLBACK'); throw error; }
  };
  const previous = async () => {
    const [row] = await leaseDb.select().from(floorplanImports)
      .where(and(eq(floorplanImports.actorId, actor), eq(floorplanImports.requestId, value.operationId)));
    if (row && (row.projectId !== id || row.requestHash !== requestHash)) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同的文件或项目。', 409);
    return row;
  };
  const access = async () => {
    const [project] = await leaseDb.select({ one: sql`1` }).from(projects)
      .where(and(eq(projects.id, id), deps.authorized ? undefined : canAccessProject(projects.id, actor))).for('share');
    if (!project) throw notFound();
  };
  try {
    await leaseDb.execute(sql`SELECT pg_advisory_lock(hashtextextended(${lock},0))`);
    const existing = await tx(async () => {
      await access();
      const row = await previous();
      if (row) return row;
      resourceId = randomUUID(); key = `projects/${id}/resources/${resourceId}.src`;
      await leaseDb.insert(resources).values({ id: resourceId, projectId: id, objectKey: key, mediaType: floorplanFormats[format].mediaType, state: 'pending' });
      return null;
    });
    if (existing) { complete = true; return importView(existing, await latestCandidate(db, existing.id)); }
    await store.put(key, bytes);
    const row = await tx(async () => {
      await access();
      if (await previous()) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作已在处理中。', 409);
      const importId = randomUUID();
      const [inserted] = await leaseDb.insert(floorplanImports).values({ id: importId, projectId: id, actorId: actor, requestId: value.operationId,
        requestHash, resourceId, fileName: name, fileFormat: format, byteSize: bytes.byteLength, sha256: digest,
        mode: automatic ? 'automatic' : 'assisted', status: automatic ? 'queued' : 'assisted_conversion' }).returning();
      await leaseDb.update(resources).set({ state: 'ready' })
        .where(and(eq(resources.id, resourceId), eq(resources.projectId, id), eq(resources.state, 'pending')));
      if (automatic) await enqueueImport(lease, importId, deps.queue);
      return inserted;
    });
    complete = true;
    return importView(row, null);
  } catch (error) {
    if (resourceId && !complete) {
      // A lost COMMIT acknowledgement may still have published the resource; delete bytes only when it is not ready.
      const failed = await leaseDb.update(resources).set({ state: 'failed' })
        .where(and(eq(resources.id, resourceId), eq(resources.projectId, id), ne(resources.state, 'ready'))).returning({ id: resources.id }).catch(() => null);
      if (failed?.length) await store.remove(key).catch(() => {});
    }
    if (error instanceof DomainError) throw error;
    throw new DomainError('FILE_SAVE_FAILED', '图纸未能保存，请重试。', 503);
  } finally { await leaseDb.execute(sql`SELECT pg_advisory_unlock(hashtextextended(${lock},0))`).finally(() => lease.release()); }
}

export async function getFloorplanImport(principal: Principal, projectId: string, importId: string) {
  const target = idSchema.parse(importId), id = idSchema.parse(projectId);
  const [row] = await db.select().from(floorplanImports)
    .where(and(eq(floorplanImports.id, target), eq(floorplanImports.projectId, id), canAccessProject(floorplanImports.projectId, actorOf(principal))));
  if (!row) throw notFound();
  return importView(row, await latestCandidate(db, row.id));
}
export async function listFloorplanImports(principal: Principal, projectId: string) {
  const id = idSchema.parse(projectId), actor = actorOf(principal);
  const [project] = await db.select({ one: sql`1` }).from(projects).where(and(eq(projects.id, id), canAccessProject(projects.id, actor)));
  if (!project) throw notFound();
  const rows = await db.select().from(floorplanImports).where(eq(floorplanImports.projectId, id)).orderBy(desc(floorplanImports.createdAt)).limit(20);
  return Promise.all(rows.map(async row => importView(row, await latestCandidate(db, row.id))));
}
/** Full latest candidate for review: HouseSpec, import candidate, preview scene and issues. */
export async function getFloorplanCandidate(principal: Principal, projectId: string, importId: string) {
  const view = await getFloorplanImport(principal, projectId, importId);
  const row = await latestCandidate(db, view.id);
  if (!row) throw new DomainError('CANDIDATE_NOT_READY', '该图纸还没有空间候选。', 409);
  return { ...candidateView(row), houseSpec: row.houseSpec, candidate: row.candidate as CandidateShape | null, scene: row.scene,
    conversion: row.conversion as { dimensionConflicts?: unknown[] } | null };
}

/**
 * Member import of a HouseSpec (one storey or whole building) for an assisted, failed or pending-review drawing.
 * The result is validated by floorplan-import and the building contract and always waits for review.
 */
export async function importHouseSpec(principal: Principal, projectId: string, importId: string, input: unknown) {
  const actor = actorOf(principal), id = idSchema.parse(projectId), target = idSchema.parse(importId);
  const value = importHouseSpecSchema.parse(input);
  const requestHash = sha256(JSON.stringify({ kind: 'housespec', projectId: id, importId: target, ...value }));
  return transaction(async (_client, tx) => {
    // hashtextextended (not advisoryXactLock's hashtext) keeps the existing lock key space.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`floorplan-housespec:${actor}:${value.operationId}`},0))`);
    const row = await lockedImport(tx, actor, id, target);
    const [prior] = await tx.select({ requestHash: floorplanImportOperations.requestHash, result: floorplanImportOperations.result })
      .from(floorplanImportOperations).where(and(eq(floorplanImportOperations.actorId, actor), eq(floorplanImportOperations.id, value.operationId)));
    if (prior) {
      if (prior.requestHash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于另一请求。', 409);
      return prior.result as FloorplanImportView;
    }
    if (!['assisted_conversion', 'failed', 'pending_review'].includes(row.status))
      throw new DomainError('IMPORT_BUSY', '图纸正在自动转换，请等待结果后再导入户型。', 409);
    if (row.revision !== value.expectedRevision) throw new DomainError('IMPORT_REVISION_CONFLICT', '图纸记录已更新，请重新读取后再导入。', 409);
    const result = buildFloorplanCandidate(value.houseSpec, importSourceId(row.id), { status: 'estimated', evidenceId: `member-housespec-${row.id}` },
      `${value.name ?? '导入户型'} · 成员导入 · 待审核`);
    const revision = row.revision + 1;
    await tx.insert(floorplanCandidates).values({ id: randomUUID(), importId: row.id, projectId: id, importRevision: revision, source: 'member-housespec',
      createdBy: actor, reviewStatus: 'pending_review', houseSpec: value.houseSpec, candidate: result.candidate, scene: result.scene, issues: result.issues });
    const [updated] = await tx.update(floorplanImports).set({ status: 'pending_review', revision, error: null, leaseUntil: null, updatedAt: sql`now()` })
      .where(eq(floorplanImports.id, row.id)).returning();
    const view = importView(updated, await latestCandidate(tx, row.id));
    await tx.insert(floorplanImportOperations).values({ actorId: actor, id: value.operationId, importId: row.id, requestHash, result: view });
    return view;
  });
}

/** Original uploaded bytes, for project members only; the digest is checked before returning. */
export async function readFloorplanSource(principal: Principal, projectId: string, importId: string, store: PrivateFileStore = privateStore()) {
  const view = await getFloorplanImport(principal, projectId, importId);
  const [resource] = await db.select({ objectKey: resources.objectKey }).from(resources)
    .where(and(eq(resources.id, view.file.resourceId), eq(resources.projectId, view.projectId), eq(resources.state, 'ready')));
  if (!resource) throw new DomainError('RESOURCE_UNAVAILABLE', '图纸文件暂时不可用。', 503);
  try {
    const bytes = await store.read(resource.objectKey);
    if (sha256(bytes) !== view.file.sha256) throw new Error('digest mismatch');
    return { bytes, mediaType: view.file.mediaType, fileName: view.file.name };
  } catch { throw new DomainError('RESOURCE_UNAVAILABLE', '图纸文件暂时不可读取，请稍后重试。', 503); }
}
