import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { pool } from '../../persistence/src/client';
import { DomainError } from '../../contracts/src/project';
import { workspaceSlugSchema } from '../../contracts/src/workspaces';
import { privateStore, type PrivateFileStore } from '../../files/src/storage';
import { legacyKeyPattern, workspaceKey } from '../../files/src/keys';
import { QUEUE_SCHEMA, queueInstalled } from '../../tasks/src/queue';
import { RENDER_SCHEMA } from '../../renders/src/queue';
import { IMPORT_SCHEMA } from '../../drawing-imports/src/queue';

// Export and deletion of one enterprise's data (ADR-0017, M04). Trusted maintainer commands, never request paths.
// What belongs to a workspace is derived from the database's own foreign keys: a row belongs when it references a
// row that belongs, starting from the workspace. New tables are covered without editing this file.
//
// Accounts are special. Customer accounts of the workspace belong to it. Platform accounts (members' e-mail
// accounts) are exported as people the workspace worked with, but never deleted. Secrets and per-person ledgers are
// never exported, and are removed only through their account.

const SECRET_TABLES = new Set(['hestia_auth_session', 'hestia_auth_account', 'hestia_auth_verification', 'hestia_invitation',
  'phone_otp_challenges', 'share_code_failures', 'credit_accounts', 'credit_ledger']);
const USERS = 'hestia_auth_user';
const ACCOUNT_COLUMNS = 'id, name, email, phone_number, workspace_id, created_at';

type ForeignKey = { table: string; columns: string[]; parent: string; references: string[] };
type Plan = { order: string[]; condition: (table: string, alias: string) => string };

async function foreignKeys(client: PoolClient): Promise<ForeignKey[]> {
  const { rows } = await client.query<ForeignKey>(`
    SELECT c.conrelid::regclass::text AS table, c.confrelid::regclass::text AS parent,
      array(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n, i) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n ORDER BY k.i) AS columns,
      array(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n, i) JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n ORDER BY k.i) AS references
    FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`);
  return rows;
}

/** Tables owned through the workspace, parents before children, and the SQL condition selecting a table's rows. */
async function ownership(client: PoolClient): Promise<Plan> {
  const keys = (await foreignKeys(client)).filter(k => !SECRET_TABLES.has(k.table) && k.table !== USERS && k.parent !== USERS);
  const owned = new Set(['workspaces']);
  for (let grew = true; grew;) {
    grew = false;
    for (const k of keys) if (owned.has(k.parent) && !owned.has(k.table)) { owned.add(k.table); grew = true; }
  }
  const parentsOf = (table: string) => keys.filter(k => k.table === table && owned.has(k.parent) && k.parent !== table);
  // Parents before children (Kahn); a cycle among owned tables would make "belongs" ambiguous, so refuse it.
  const order: string[] = [], placed = new Set<string>();
  while (order.length < owned.size) {
    const ready = [...owned].filter(t => !placed.has(t) && parentsOf(t).every(k => placed.has(k.parent))).sort();
    if (!ready.length) throw new Error(`Foreign keys form a cycle among: ${[...owned].filter(t => !placed.has(t)).join(', ')}`);
    for (const t of ready) { order.push(t); placed.add(t); }
  }
  let aliases = 0;
  const condition = (table: string, alias: string): string => {
    if (table === 'workspaces') return `${alias}.id = $1`;
    return parentsOf(table).map(k => {
      const p = `p${++aliases}`;
      return `(${k.columns.map(c => `${alias}.${c}`).join(', ')}) IN (SELECT ${k.references.map(c => `${p}.${c}`).join(', ')} FROM ${k.parent} ${p} WHERE ${condition(k.parent, p)})`;
    }).join(' OR ') || 'false';
  };
  return { order, condition };
}
const accountsOf = (alias: string) => `${alias}.workspace_id = $1
  OR ${alias}.id IN (SELECT user_id FROM workspace_members WHERE workspace_id = $1)
  OR ${alias}.id IN (SELECT user_id FROM workspace_customers WHERE workspace_id = $1)`;

async function workspaceOf(client: PoolClient, slug: string): Promise<{ id: string; slug: string; name: string }> {
  const parsed = workspaceSlugSchema.safeParse(slug);
  const { rows: [row] } = parsed.success ? await client.query('SELECT id, slug, name FROM workspaces WHERE slug = $1', [parsed.data]) : { rows: [] };
  if (!row) throw new DomainError('NOT_FOUND', `工作空间「${slug}」不存在。`, 404);
  return row;
}
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

export type ExportManifest = {
  workspace: { id: string; slug: string; name: string }; exportedAt: string;
  tables: Record<string, { rows: number; sha256: string }>; files: { key: string; bytes: number; sha256: string }[]; missingFiles: string[];
};

/** Writes the workspace's rows (one JSON file per table) and private files into an empty directory, plus a manifest. */
export async function exportWorkspace(slug: string, directory: string, store: PrivateFileStore = privateStore()): Promise<ExportManifest> {
  const target = path.resolve(directory);
  await mkdir(target, { recursive: true });
  if ((await readdir(target)).length) throw new DomainError('EXPORT_TARGET_NOT_EMPTY', `导出目录「${target}」不是空的。`, 409);
  const client = await pool.connect();
  try {
    // One snapshot for every table, so the export is consistent even while the enterprise keeps working.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const workspace = await workspaceOf(client, slug), plan = await ownership(client);
    const manifest: ExportManifest = { workspace, exportedAt: new Date().toISOString(), tables: {}, files: [], missingFiles: [] };
    await mkdir(path.join(target, 'tables'));
    const dump = async (table: string, query: string) => {
      const rows = (await client.query(query, [workspace.id])).rows.map(r => r.row);
      const body = JSON.stringify(rows, null, 1);
      await writeFile(path.join(target, 'tables', `${table}.json`), body, { mode: 0o600 });
      manifest.tables[table] = { rows: rows.length, sha256: sha256(body) };
    };
    for (const table of plan.order) await dump(table, `SELECT row_to_json(t) AS row FROM ${table} t WHERE ${plan.condition(table, 't')}`);
    await dump(USERS, `SELECT row_to_json(t) AS row FROM (SELECT ${ACCOUNT_COLUMNS} FROM ${USERS} u WHERE ${accountsOf('u')}) t`);
    const { rows: files } = await client.query<{ object_key: string }>(`SELECT r.object_key FROM resources r WHERE ${plan.condition('resources', 'r')} AND r.state = 'ready' ORDER BY 1`, [workspace.id]);
    await client.query('COMMIT');
    for (const { object_key: key } of files) {
      let bytes: Buffer;
      try { bytes = await store.read(key); } catch { manifest.missingFiles.push(key); continue; }
      const file = path.join(target, 'files', ...key.split('/'));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes, { mode: 0o600 });
      manifest.files.push({ key, bytes: bytes.byteLength, sha256: sha256(bytes) });
    }
    await writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    return manifest;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export type DeleteResult = { workspace: { id: string; slug: string; name: string }; rows: Record<string, number>; jobs: number; files: number; missingFiles: string[] };

/** Deletes the workspace, everything it owns and its customer accounts; members' platform accounts stay. */
export async function deleteWorkspace(slug: string, confirm: string, store: PrivateFileStore = privateStore()): Promise<DeleteResult> {
  if (confirm !== slug) throw new DomainError('CONFIRMATION_REQUIRED', '删除前须再写一遍企业标识确认。', 400);
  const client = await pool.connect();
  let result: DeleteResult, keys: string[];
  try {
    await client.query('BEGIN');
    const workspace = await workspaceOf(client, slug), plan = await ownership(client);
    await client.query('SELECT 1 FROM workspaces WHERE id = $1 FOR UPDATE', [workspace.id]);
    keys = (await client.query<{ object_key: string }>(`SELECT r.object_key FROM resources r WHERE ${plan.condition('resources', 'r')}`, [workspace.id])).rows.map(r => r.object_key);
    // Queued and running jobs of the workspace go first: a Worker must not pick up work whose rows are gone.
    let jobs = 0;
    for (const schema of [QUEUE_SCHEMA, RENDER_SCHEMA, IMPORT_SCHEMA])
      if (await queueInstalled(schema)) jobs += (await client.query(`DELETE FROM ${schema}.job WHERE group_id = $1`, [workspace.id])).rowCount ?? 0;
    const rows: Record<string, number> = {};
    // Customer accounts go before the workspace; their sessions and ledgers follow them by cascade.
    for (const table of [...plan.order].reverse()) {
      if (table === 'workspaces') rows[USERS] = (await client.query(`DELETE FROM ${USERS} WHERE workspace_id = $1`, [workspace.id])).rowCount ?? 0;
      rows[table] = (await client.query(`DELETE FROM ${table} t WHERE ${plan.condition(table, 't')}`, [workspace.id])).rowCount ?? 0;
    }
    await client.query('COMMIT');
    result = { workspace, rows, jobs, files: 0, missingFiles: [] };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
  // Files after the commit: a failed delete leaves every file in place; a missing file is reported, not fatal.
  for (const key of keys) {
    try { await store.read(key); await store.remove(key); result.files += 1; } catch { result.missingFiles.push(key); }
  }
  return result;
}

/** Moves files stored before M04 under their workspace. Idempotent; resumes after an interruption. */
export async function migrateFileKeys(store: PrivateFileStore = privateStore()): Promise<{ moved: number; relinked: number; missing: string[] }> {
  const { rows } = await pool.query<{ id: string; object_key: string; workspace_id: string }>(
    `SELECT r.id, r.object_key, p.workspace_id FROM resources r JOIN projects p ON p.id = r.project_id WHERE r.object_key LIKE 'projects/%' AND r.state = 'ready' ORDER BY r.id`);
  const result = { moved: 0, relinked: 0, missing: [] as string[] };
  for (const row of rows) {
    const match = legacyKeyPattern.exec(row.object_key);
    if (!match) continue;
    const next = workspaceKey(row.workspace_id, match[1], match[2], match[3] as 'png' | 'src');
    let bytes: Buffer | null = null;
    try { bytes = await store.read(row.object_key); } catch { /* moved before an interruption, or lost */ }
    if (bytes) await store.put(next, bytes);
    else {
      try { await store.read(next); } catch { result.missing.push(row.object_key); continue; }
    }
    await pool.query('UPDATE resources SET object_key = $1 WHERE id = $2 AND object_key = $3', [next, row.id, row.object_key]);
    if (bytes) { await store.remove(row.object_key); result.moved += 1; } else result.relinked += 1;
  }
  return result;
}
