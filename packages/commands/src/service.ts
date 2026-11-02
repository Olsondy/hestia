import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { and, desc, eq, exists, gt, isNull, ne, sql, getTableColumns } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { advisoryXactLock, orm, transaction, type Database } from '../../persistence/src/client';
import { operations, projectCommands, projectRevisions, projects, resources } from '../../persistence/src/schema';
import { toScene, type Principal } from '../../projects/src/service';
import { canAccessProject } from '../../workspaces/src/access';
import { DomainError, idSchema, spatialStateSchema, type SpatialState, type ProjectView } from '../../contracts/src/project';
import { commandRequestSchema, furniturePoseSchema, type FurniturePose, type OperationSummary } from '../../contracts/src/commands';
import { validatePlacement } from '../../geometry/src/placement';

type Value = FurniturePose | { locked: boolean };
type CommandRow = Omit<typeof projectCommands.$inferSelect, 'type' | 'beforeValue' | 'afterValue'>
  & { type: OperationSummary['type']; beforeValue: Value; afterValue: Value; hasDependency: boolean };
const notFound = () => new DomainError('NOT_FOUND', '项目或操作不存在。', 404);
const poseOf = (object: SpatialState['currentLayout']['objects'][number]): FurniturePose => ({ x: object.position.x, z: object.position.z, yaw: object.yaw });
function movable(state: SpatialState, objectId: string) {
  if (state.fixedFacts.objects.some(o => o.id === objectId)) throw new DomainError('FIXED_FACT', '固定设施不能通过家具修改命令变更。', 400, { issues: [{ code: 'FIXED_FACT', objectId, message: '固定设施不可移动或解锁。' }] });
  const object = state.currentLayout.objects.find(o => o.id === objectId);
  if (!object) throw new DomainError('OBJECT_NOT_FOUND', '家具不存在。', 404);
  return object;
}
function ensurePlacement(state: SpatialState, objectId: string, pose: FurniturePose) {
  if (state.scale !== 'calibrated' && state.scale !== 'synthetic') throw new DomainError('SCALE_UNCONFIRMED', '尺寸未确认，暂不能判断精确摆放是否可行。', 400,
    { issues: [{ code: 'SCALE_UNCONFIRMED', objectId, message: '请先确认可靠尺寸。' }] });
  const report = validatePlacement({ levels: state.fixedFacts.levels, rooms: state.fixedFacts.rooms, walls: state.fixedFacts.walls,
    objects: [...state.fixedFacts.objects, ...state.currentLayout.objects] }, objectId, pose, state.fixedFacts.openingClearances);
  if (!report.valid) throw new DomainError('PLACEMENT_REJECTED', '这次摆放未通过空间校验。', 400, report);
}
function setPose(state: SpatialState, objectId: string, pose: FurniturePose) {
  const object = movable(state, objectId); object.position.x = pose.x; object.position.z = pose.z; object.yaw = pose.yaw;
}
function setLock(state: SpatialState, objectId: string, locked: boolean) {
  movable(state, objectId);
  state.currentLayout.lockedObjectIds = state.currentLayout.lockedObjectIds.filter(id => id !== objectId);
  if (locked) state.currentLayout.lockedObjectIds.push(objectId);
}
function undoRejection(row: CommandRow, state: SpatialState): string | null {
  if (row.type === 'undo' || row.undoneBy) return '此操作不能再次撤销。';
  if (row.hasDependency) return '同一物体已有后续修改，请先处理后续操作。';
  if (row.layoutId !== state.currentLayout.id || row.fixedFactsId !== state.fixedFacts.id || row.fixedFactsRevision !== state.fixedFacts.revision) return '当前方案或固定事实已变化，不能套用旧撤销。';
  const object = state.currentLayout.objects.find(o => o.id === row.objectId);
  if (!object) return '目标家具已不在当前方案中。';
  if (row.type === 'move-furniture') {
    if (state.currentLayout.lockedObjectIds.includes(row.objectId)) return '家具已锁定，不能撤销其摆放。';
    const after = row.afterValue as FurniturePose, current = poseOf(object);
    if (after.x !== current.x || after.z !== current.z || after.yaw !== current.yaw) return '家具状态已变化，不能覆盖新修改。';
  } else if (state.currentLayout.lockedObjectIds.includes(row.objectId) !== (row.afterValue as { locked: boolean }).locked) return '锁定状态已变化，不能覆盖新修改。';
  return null;
}
function summary(row: CommandRow, state: SpatialState): OperationSummary {
  let undoable = !undoRejection(row, state);
  if (undoable && row.type === 'move-furniture') {
    try { ensurePlacement(state, row.objectId, furniturePoseSchema.parse(row.beforeValue)); } catch { undoable = false; }
  }
  return { id: row.operationId, type: row.type, objectId: row.objectId, revision: row.revision, undoable,
    createdAt: row.createdAt.toISOString(), ...(row.undoOf ? { targetOperationId: row.undoOf } : {}) };
}
const c = alias(projectCommands, 'c'), later = alias(projectCommands, 'later');
/** Commands of `c` with whether a later live command on the same object depends on them. */
const commandRows = (tx: Database) => tx.select({ ...getTableColumns(c), hasDependency: sql<boolean>`${exists(tx.select({ one: sql`1` }).from(later)
  .where(and(eq(later.projectId, c.projectId), eq(later.objectId, c.objectId), gt(later.revision, c.revision), ne(later.type, 'undo'), isNull(later.undoneBy))))}` }).from(c);
/** Project must already be authorized. `actorId` narrows to the caller's own operation (idempotent replay). */
async function readCommand(tx: Database, projectId: string, operationId: string, actorId?: string) {
  const [row] = await commandRows(tx).where(and(eq(c.projectId, projectId), eq(c.operationId, operationId), actorId == null ? undefined : eq(c.actorId, actorId)))
    .orderBy(desc(c.revision)).limit(1);
  return row as CommandRow | undefined;
}
async function readView(tx: Database, userId: string, projectId: string) {
  const [row] = await tx.select({ name: projects.name, revision: projects.revision, snapshot: projects.snapshot, updatedAt: projects.updatedAt })
    .from(projects).where(and(eq(projects.id, projectId), canAccessProject(projects.id, userId)));
  if (!row) throw notFound();
  const state = spatialStateSchema.parse(row.snapshot);
  const files = await tx.select({ id: resources.id, projectId: resources.projectId, mediaType: resources.mediaType, state: resources.state })
    .from(resources).where(eq(resources.projectId, projectId));
  const project: ProjectView = { id: projectId, name: row.name, revision: row.revision, updatedAt: row.updatedAt.toISOString(),
    synthetic: state.synthetic, scale: state.scale, scene: toScene(state, row.name),
    fixedFacts: { id: state.fixedFacts.id, revision: state.fixedFacts.revision }, currentLayout: { id: state.currentLayout.id, revision: state.currentLayout.revision },
    lockedObjectIds: state.currentLayout.lockedObjectIds,
    resources: files as ProjectView['resources'] };
  return { project, state };
}

/** Shared domain entry point for manual UI and future Worker calls. All writes occur in one transaction. */
export async function executeCommandInTransaction(client: PoolClient, principal: Principal, projectId: string, input: unknown) {
  const request = commandRequestSchema.parse(input), id = idSchema.parse(projectId), ownerId = principal.userId;
  if (!ownerId) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  const hash = createHash('sha256').update(JSON.stringify({ kind: 'command', projectId: id, ...request })).digest('hex');
    const tx = orm(client);
    await advisoryXactLock(tx, `${ownerId}:${request.operationId}`);
    const [project] = await tx.select({ snapshot: projects.snapshot, revision: projects.revision }).from(projects)
      .where(and(eq(projects.id, id), canAccessProject(projects.id, ownerId))).for('update');
    if (!project) throw notFound();
    const [previous] = await tx.select({ requestHash: operations.requestHash }).from(operations)
      .where(and(eq(operations.actorId, ownerId), eq(operations.id, request.operationId)));
    if (previous) {
      if (previous.requestHash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409);
      return;
    }
    if (project.revision !== request.expectedRevision) throw new DomainError('REVISION_CONFLICT', '项目已有新修订，请重新加载后再试。', 409);
    const state = spatialStateSchema.parse(project.snapshot), command = request.command;
    let objectId: string, before: Value, after: Value, undoOf: string | null = null, undoActor: string | null = null;
    if (command.type === 'move-furniture') {
      objectId = command.objectId; const object = movable(state, objectId);
      if (state.currentLayout.lockedObjectIds.includes(objectId)) throw new DomainError('OBJECT_LOCKED', '家具已锁定，请先解锁。', 400,
        { issues: [{ code: 'OBJECT_LOCKED', objectId, message: '锁定家具不能移动或旋转。' }] });
      before = poseOf(object); after = { x: command.x, z: command.z, yaw: command.yaw };
      if (JSON.stringify(before) === JSON.stringify(after)) throw new DomainError('NO_CHANGE', '家具的位置与朝向没有变化。');
      ensurePlacement(state, objectId, after); setPose(state, objectId, after);
    } else if (command.type === 'set-lock') {
      objectId = command.objectId; movable(state, objectId);
      before = { locked: state.currentLayout.lockedObjectIds.includes(objectId) }; after = { locked: command.locked };
      if (before.locked === after.locked) throw new DomainError('NO_CHANGE', '锁定状态没有变化。');
      setLock(state, objectId, command.locked);
    } else {
      // Any member may undo a command in a shared workspace project; the undo row records who undid it.
      const target = await readCommand(tx, id, command.targetOperationId);
      if (!target) throw notFound();
      const reason = undoRejection(target, state);
      if (reason) throw new DomainError('UNDO_DEPENDENCY', reason, 409);
      objectId = target.objectId; before = target.afterValue; after = target.beforeValue; undoOf = target.operationId; undoActor = target.actorId;
      if (target.type === 'move-furniture') {
        const pose = furniturePoseSchema.parse(after); ensurePlacement(state, objectId, pose); setPose(state, objectId, pose);
      } else setLock(state, objectId, (after as { locked: boolean }).locked);
    }
    state.currentLayout.revision++;
    const revision = project.revision + 1;
    await tx.update(projects).set({ snapshot: spatialStateSchema.parse(state), revision, updatedAt: sql`now()` }).where(eq(projects.id, id));
    await tx.insert(projectRevisions).values({ projectId: id, revision, snapshot: state, operationId: request.operationId });
    await tx.insert(operations).values({ actorId: ownerId, id: request.operationId, projectId: id, requestHash: hash,
      result: { kind: 'command', projectId: id, revision, operationId: request.operationId } });
    await tx.insert(projectCommands).values({ actorId: ownerId, operationId: request.operationId, projectId: id, type: command.type, objectId, revision,
      layoutId: state.currentLayout.id, fixedFactsId: state.fixedFacts.id, fixedFactsRevision: state.fixedFacts.revision, beforeValue: before, afterValue: after, undoOf });
    if (undoOf) await tx.update(projectCommands).set({ undoneBy: request.operationId })
      .where(and(eq(projectCommands.actorId, undoActor!), eq(projectCommands.operationId, undoOf)));
}

export async function executeCommand(principal: Principal, projectId: string, input: unknown) {
  const request = commandRequestSchema.parse(input), id = idSchema.parse(projectId), ownerId = principal.userId;
  await transaction(client => executeCommandInTransaction(client, principal, id, request));
  // Return current authoritative state, even when replaying an earlier operation after later commits.
  return transaction(async (_client, tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    const { project, state } = await readView(tx, ownerId, id);
    const row = await readCommand(tx, id, request.operationId, ownerId);
    if (!row) throw notFound();
    return { project, operation: summary(row, state) };
  });
}

export async function listCommands(principal: Principal, projectId: string) {
  const id = idSchema.parse(projectId);
  if (!principal.userId) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  return transaction(async (_client, tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    const { state } = await readView(tx, principal.userId, id);
    const rows = await commandRows(tx).where(eq(c.projectId, id)).orderBy(desc(c.revision)).limit(20);
    return (rows as CommandRow[]).map(row => summary(row, state));
  });
}
