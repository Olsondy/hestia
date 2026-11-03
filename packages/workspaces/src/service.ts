import type { PoolClient } from 'pg';
import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { advisoryXactLock, orm, transaction, type Database } from '../../persistence/src/client';
import { hestiaAuthUser, workspaceMembers, workspaces, workspaceTypes } from '../../persistence/src/schema';
import { DomainError, idSchema } from '../../contracts/src/project';
import { createWorkspaceSchema, setMemberSchema, updateMemberSchema,
  type WorkspaceMember, type WorkspaceView } from '../../contracts/src/workspaces';
import { actorOf, type Principal } from './access';

const notFound = () => new DomainError('NOT_FOUND', '工作空间不存在。', 404);
const forbidden = () => new DomainError('FORBIDDEN', '只有工作空间管理员可以管理成员。', 403);
const selectWorkspace = (tx: Database) => tx.select({ id: workspaces.id, kind: workspaces.kind, name: workspaces.name, slug: workspaces.slug,
  personalUserId: workspaces.personalUserId, role: workspaceMembers.role, usagePolicy: workspaceTypes.usagePolicy, maxMembers: workspaceTypes.maxMembers })
  .from(workspaces).innerJoin(workspaceTypes, eq(workspaceTypes.kind, workspaces.kind)).innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id));
type WorkspaceRow = Awaited<ReturnType<typeof selectWorkspace>>[number];
const view = ({ personalUserId, ...row }: WorkspaceRow): WorkspaceView => ({ ...row, personal: personalUserId !== null });
const member = (workspaceId: string, userId: string) => and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId));

/** Idempotent; runs inside the caller's transaction so a new account and its workspace commit together. */
export async function ensurePersonalWorkspace(client: PoolClient, userId: string): Promise<string> {
  const tx = orm(client);
  const [type] = await tx.select({ kind: workspaceTypes.kind }).from(workspaceTypes).where(eq(workspaceTypes.provisioning, 'per_user'));
  if (type) await tx.insert(workspaces).values({ kind: type.kind, name: '个人工作空间', personalUserId: userId })
    .onConflictDoNothing({ target: workspaces.personalUserId });
  const [row] = await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.personalUserId, userId));
  if (!row) throw new DomainError('WORKSPACE_CONFIGURATION_INVALID', '个人工作空间暂不可用，请稍后再试。', 503);
  await tx.insert(workspaceMembers).values({ workspaceId: row.id, userId, role: 'admin' }).onConflictDoNothing();
  return row.id;
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
  const [row] = await orm(client).select({ one: sql`1` }).from(workspaceMembers).where(member(id.data, userId)).for('share');
  if (!row) throw notFound();
  return id.data;
}

export async function listWorkspaces(principal: Principal): Promise<WorkspaceView[]> {
  const userId = actorOf(principal);
  return transaction(async (client, tx) => {
    await ensurePersonalWorkspace(client, userId);
    const rows = await selectWorkspace(tx).where(eq(workspaceMembers.userId, userId))
      .orderBy(sql`${workspaces.personalUserId} IS NULL`, asc(workspaces.createdAt), asc(workspaces.id));
    return rows.map(view);
  });
}

async function membership(tx: Database, principal: Principal, workspaceId: string, lock = false) {
  const userId = actorOf(principal), id = idSchema.safeParse(workspaceId);
  if (!id.success) throw notFound();
  // Lock the workspace row first so concurrent member changes serialize (last-admin and size limits).
  if (lock && !(await tx.select({ one: sql`1` }).from(workspaces).where(eq(workspaces.id, id.data)).for('update')).length) throw notFound();
  const [row] = await selectWorkspace(tx).where(and(eq(workspaces.id, id.data), eq(workspaceMembers.userId, userId)));
  if (!row) throw notFound();
  return row;
}

export async function getWorkspace(principal: Principal, workspaceId: string): Promise<WorkspaceView> {
  return view(await transaction((_client, tx) => membership(tx, principal, workspaceId)));
}

export async function listMembers(principal: Principal, workspaceId: string): Promise<WorkspaceMember[]> {
  return transaction(async (_client, tx) => {
    const workspace = await membership(tx, principal, workspaceId);
    const rows = await tx.select({ userId: workspaceMembers.userId, role: workspaceMembers.role, createdAt: workspaceMembers.createdAt,
      name: hestiaAuthUser.name, email: hestiaAuthUser.email }).from(workspaceMembers)
      .leftJoin(hestiaAuthUser, eq(hestiaAuthUser.id, workspaceMembers.userId)).where(eq(workspaceMembers.workspaceId, workspace.id))
      .orderBy(asc(workspaceMembers.createdAt), asc(workspaceMembers.userId));
    return rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }));
  });
}

async function assertAdminRemains(tx: Database, workspaceId: string) {
  const [{ n }] = await tx.select({ n: count() }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'admin')));
  if (n < 1) throw new DomainError('LAST_ADMIN', '工作空间至少需要一名管理员。', 409);
}

/** Admin adds an existing account, or changes its role. Retrying the same request is a no-op. */
export async function setMember(principal: Principal, workspaceId: string, input: unknown): Promise<WorkspaceMember[]> {
  const request = setMemberSchema.parse(input);
  await transaction(async (_client, tx) => {
    const workspace = await membership(tx, principal, workspaceId, true);
    if (workspace.role !== 'admin') throw forbidden();
    const [user] = await tx.select({ id: hestiaAuthUser.id }).from(hestiaAuthUser).where(eq(hestiaAuthUser.email, request.email));
    if (!user) throw new DomainError('ACCOUNT_NOT_FOUND', '没有找到该邮箱对应的账号，请先让对方注册。', 404);
    const [{ others }] = await tx.select({ others: count() }).from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspace.id), ne(workspaceMembers.userId, user.id)));
    if (workspace.maxMembers !== null && others + 1 > workspace.maxMembers)
      throw new DomainError('WORKSPACE_MEMBER_LIMIT', '此类工作空间不能再添加成员。', 409);
    await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: request.role })
      .onConflictDoUpdate({ target: [workspaceMembers.workspaceId, workspaceMembers.userId], set: { role: sql`excluded.role`, updatedAt: sql`now()` } });
    await assertAdminRemains(tx, workspace.id);
  });
  return listMembers(principal, workspaceId);
}

export async function updateMember(principal: Principal, workspaceId: string, userId: string, input: unknown): Promise<WorkspaceMember[]> {
  const request = updateMemberSchema.parse(input);
  await transaction(async (_client, tx) => {
    const workspace = await membership(tx, principal, workspaceId, true);
    if (workspace.role !== 'admin') throw forbidden();
    const changed = await tx.update(workspaceMembers).set({ role: request.role, updatedAt: sql`now()` }).where(member(workspace.id, userId));
    if (!changed.rowCount) throw new DomainError('NOT_FOUND', '成员不存在。', 404);
    await assertAdminRemains(tx, workspace.id);
  });
  return listMembers(principal, workspaceId);
}

/** Removal takes effect immediately for every project in the workspace, including direct resource requests. */
export async function removeMember(principal: Principal, workspaceId: string, userId: string): Promise<WorkspaceMember[]> {
  let self = false;
  await transaction(async (_client, tx) => {
    const workspace = await membership(tx, principal, workspaceId, true);
    if (workspace.role !== 'admin') throw forbidden();
    const removed = await tx.delete(workspaceMembers).where(member(workspace.id, userId));
    if (!removed.rowCount) throw new DomainError('NOT_FOUND', '成员不存在。', 404);
    await assertAdminRemains(tx, workspace.id);
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
  return transaction(async (_client, tx) => {
    await advisoryXactLock(tx, `hestia:workspace:${request.slug}`);
    const [type] = await tx.select({ kind: workspaceTypes.kind }).from(workspaceTypes)
      .where(and(eq(workspaceTypes.kind, request.kind), eq(workspaceTypes.provisioning, 'explicit')));
    if (!type) throw new DomainError('WORKSPACE_KIND_INVALID', '此工作空间类型不能手动创建。', 400);
    const [admin] = await tx.select({ id: hestiaAuthUser.id }).from(hestiaAuthUser).where(eq(hestiaAuthUser.email, request.adminEmail));
    if (!admin) throw new DomainError('ACCOUNT_NOT_FOUND', '管理员账号不存在，请先注册。', 404);
    let [row] = await tx.select({ id: workspaces.id, kind: workspaces.kind }).from(workspaces).where(eq(workspaces.slug, request.slug)).for('update');
    const created = !row;
    if (row && row.kind !== request.kind) throw new DomainError('IDEMPOTENCY_CONFLICT', '此标识已用于另一类型的工作空间。', 409);
    if (!row) [row] = await tx.insert(workspaces).values({ kind: request.kind, name: request.name, slug: request.slug }).returning({ id: workspaces.id, kind: workspaces.kind });
    await tx.insert(workspaceMembers).values({ workspaceId: row.id, userId: admin.id, role: 'admin' })
      .onConflictDoUpdate({ target: [workspaceMembers.workspaceId, workspaceMembers.userId], set: { role: 'admin', updatedAt: sql`now()` } });
    const [workspace] = await selectWorkspace(tx).where(and(eq(workspaces.id, row.id), eq(workspaceMembers.userId, admin.id)));
    const { role: _role, ...result } = view(workspace);
    return { workspace: result, created };
  });
}
