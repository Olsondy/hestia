import type { PoolClient } from 'pg';
import { transaction } from '../../persistence/src/client';
import { DomainError, idSchema } from '../../contracts/src/project';
import { createWorkspaceSchema, setMemberSchema, updateMemberSchema,
  type WorkspaceMember, type WorkspaceRole, type WorkspaceView } from '../../contracts/src/workspaces';
import { actorOf, type Principal } from './access';

const notFound = () => new DomainError('NOT_FOUND', '工作空间不存在。', 404);
const forbidden = () => new DomainError('FORBIDDEN', '只有工作空间管理员可以管理成员。', 403);
type WorkspaceRow = { id: string; kind: string; name: string; slug: string | null; personal_user_id: string | null;
  role: WorkspaceRole; usage_policy: WorkspaceView['usagePolicy']; max_members: number | null };
const view = (row: WorkspaceRow): WorkspaceView => ({ id: row.id, kind: row.kind, name: row.name, slug: row.slug,
  personal: row.personal_user_id !== null, role: row.role, usagePolicy: row.usage_policy, maxMembers: row.max_members });
const selectWorkspace = `SELECT w.id,w.kind,w.name,w.slug,w.personal_user_id,m.role,t.usage_policy,t.max_members
  FROM workspaces w JOIN workspace_types t ON t.kind=w.kind JOIN workspace_members m ON m.workspace_id=w.id`;

/** Idempotent; runs inside the caller's transaction so a new account and its workspace commit together. */
export async function ensurePersonalWorkspace(client: PoolClient, userId: string): Promise<string> {
  await client.query(`INSERT INTO workspaces(kind,name,personal_user_id)
    SELECT kind,'个人工作空间',$1 FROM workspace_types WHERE provisioning='per_user'
    ON CONFLICT (personal_user_id) DO NOTHING`, [userId]);
  const id = (await client.query<{ id: string }>('SELECT id FROM workspaces WHERE personal_user_id=$1', [userId])).rows[0]?.id;
  if (!id) throw new DomainError('WORKSPACE_CONFIGURATION_INVALID', '个人工作空间暂不可用，请稍后再试。', 503);
  await client.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin') ON CONFLICT DO NOTHING", [id, userId]);
  return id;
}

/**
 * Workspace a list/create request acts in. Explicit workspaces require current membership (held FOR SHARE
 * so a concurrent removal waits); otherwise the caller's personal workspace is used, as before D01.
 */
export async function actingWorkspace(client: PoolClient, principal: Principal): Promise<string> {
  const userId = actorOf(principal);
  if (principal.workspaceId === undefined) return ensurePersonalWorkspace(client, userId);
  const id = idSchema.safeParse(principal.workspaceId);
  if (!id.success) throw notFound();
  const member = await client.query('SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 FOR SHARE', [id.data, userId]);
  if (!member.rowCount) throw notFound();
  return id.data;
}

export async function listWorkspaces(principal: Principal): Promise<WorkspaceView[]> {
  const userId = actorOf(principal);
  return transaction(async client => {
    await ensurePersonalWorkspace(client, userId);
    const rows = (await client.query<WorkspaceRow>(`${selectWorkspace} WHERE m.user_id=$1
      ORDER BY (w.personal_user_id IS NULL), w.created_at, w.id`, [userId])).rows;
    return rows.map(view);
  });
}

async function membership(client: PoolClient, principal: Principal, workspaceId: string, lock = false) {
  const userId = actorOf(principal), id = idSchema.safeParse(workspaceId);
  if (!id.success) throw notFound();
  // Lock the workspace row first so concurrent member changes serialize (last-admin and size limits).
  if (lock && !(await client.query('SELECT 1 FROM workspaces WHERE id=$1 FOR UPDATE', [id.data])).rowCount) throw notFound();
  const row = (await client.query<WorkspaceRow>(`${selectWorkspace} WHERE w.id=$1 AND m.user_id=$2`, [id.data, userId])).rows[0];
  if (!row) throw notFound();
  return row;
}

export async function getWorkspace(principal: Principal, workspaceId: string): Promise<WorkspaceView> {
  return view(await transaction(client => membership(client, principal, workspaceId)));
}

export async function listMembers(principal: Principal, workspaceId: string): Promise<WorkspaceMember[]> {
  return transaction(async client => {
    const workspace = await membership(client, principal, workspaceId);
    const rows = (await client.query(`SELECT m.user_id,m.role,m.created_at,u.name,u.email FROM workspace_members m
      LEFT JOIN hestia_auth_user u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY m.created_at,m.user_id`, [workspace.id])).rows;
    return rows.map(row => ({ userId: row.user_id, name: row.name, email: row.email, role: row.role, createdAt: row.created_at.toISOString() }));
  });
}

async function assertAdminRemains(client: PoolClient, workspaceId: string) {
  const admins = (await client.query("SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id=$1 AND role='admin'", [workspaceId])).rows[0].n;
  if (admins < 1) throw new DomainError('LAST_ADMIN', '工作空间至少需要一名管理员。', 409);
}

/** Admin adds an existing account, or changes its role. Retrying the same request is a no-op. */
export async function setMember(principal: Principal, workspaceId: string, input: unknown): Promise<WorkspaceMember[]> {
  const request = setMemberSchema.parse(input);
  await transaction(async client => {
    const workspace = await membership(client, principal, workspaceId, true);
    if (workspace.role !== 'admin') throw forbidden();
    const user = (await client.query('SELECT id FROM hestia_auth_user WHERE email=$1', [request.email])).rows[0];
    if (!user) throw new DomainError('ACCOUNT_NOT_FOUND', '没有找到该邮箱对应的账号，请先让对方注册。', 404);
    const others = (await client.query('SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id=$1 AND user_id<>$2', [workspace.id, user.id])).rows[0].n;
    if (workspace.max_members !== null && others + 1 > workspace.max_members)
      throw new DomainError('WORKSPACE_MEMBER_LIMIT', '此类工作空间不能再添加成员。', 409);
    await client.query(`INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)
      ON CONFLICT (workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role,updated_at=now()`, [workspace.id, user.id, request.role]);
    await assertAdminRemains(client, workspace.id);
  });
  return listMembers(principal, workspaceId);
}

export async function updateMember(principal: Principal, workspaceId: string, userId: string, input: unknown): Promise<WorkspaceMember[]> {
  const request = updateMemberSchema.parse(input);
  await transaction(async client => {
    const workspace = await membership(client, principal, workspaceId, true);
    if (workspace.role !== 'admin') throw forbidden();
    const changed = await client.query('UPDATE workspace_members SET role=$3,updated_at=now() WHERE workspace_id=$1 AND user_id=$2', [workspace.id, userId, request.role]);
    if (!changed.rowCount) throw new DomainError('NOT_FOUND', '成员不存在。', 404);
    await assertAdminRemains(client, workspace.id);
  });
  return listMembers(principal, workspaceId);
}

/** Removal takes effect immediately for every project in the workspace, including direct resource requests. */
export async function removeMember(principal: Principal, workspaceId: string, userId: string): Promise<WorkspaceMember[]> {
  let self = false;
  await transaction(async client => {
    const workspace = await membership(client, principal, workspaceId, true);
    if (workspace.role !== 'admin') throw forbidden();
    const removed = await client.query('DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2', [workspace.id, userId]);
    if (!removed.rowCount) throw new DomainError('NOT_FOUND', '成员不存在。', 404);
    await assertAdminRemains(client, workspace.id);
    self = userId === principal.userId;
  });
  return self ? [] : listMembers(principal, workspaceId);
}

/**
 * Trusted server-side creation (scripts, seeds, future back-office). Not exposed over public HTTP.
 * Idempotent by slug: re-running returns the same workspace and makes sure the named admin is an admin.
 */
export async function createWorkspace(input: unknown): Promise<{ workspace: Omit<WorkspaceView, 'role'>; created: boolean }> {
  const request = createWorkspaceSchema.parse(input);
  return transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`hestia:workspace:${request.slug}`]);
    const type = (await client.query("SELECT kind FROM workspace_types WHERE kind=$1 AND provisioning='explicit'", [request.kind])).rows[0];
    if (!type) throw new DomainError('WORKSPACE_KIND_INVALID', '此工作空间类型不能手动创建。', 400);
    const admin = (await client.query('SELECT id FROM hestia_auth_user WHERE email=$1', [request.adminEmail])).rows[0];
    if (!admin) throw new DomainError('ACCOUNT_NOT_FOUND', '管理员账号不存在，请先注册。', 404);
    let row = (await client.query('SELECT id,kind FROM workspaces WHERE slug=$1 FOR UPDATE', [request.slug])).rows[0];
    const created = !row;
    if (row && row.kind !== request.kind) throw new DomainError('IDEMPOTENCY_CONFLICT', '此标识已用于另一类型的工作空间。', 409);
    if (!row) row = (await client.query('INSERT INTO workspaces(kind,name,slug) VALUES($1,$2,$3) RETURNING id,kind', [request.kind, request.name, request.slug])).rows[0];
    await client.query(`INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin')
      ON CONFLICT (workspace_id,user_id) DO UPDATE SET role='admin',updated_at=now()`, [row.id, admin.id]);
    const workspace = (await client.query<WorkspaceRow>(`${selectWorkspace} WHERE w.id=$1 AND m.user_id=$2`, [row.id, admin.id])).rows[0];
    const { role: _role, ...result } = view(workspace);
    return { workspace: result, created };
  });
}

