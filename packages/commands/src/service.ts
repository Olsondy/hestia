import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { transaction } from '../../persistence/src/client';
import { toScene, type Principal } from '../../projects/src/service';
import { projectAccess } from '../../workspaces/src/access';
import { DomainError, idSchema, spatialStateSchema, type SpatialState, type ProjectView } from '../../contracts/src/project';
import { commandRequestSchema, furniturePoseSchema, type FurniturePose, type OperationSummary } from '../../contracts/src/commands';
import { validatePlacement } from '../../geometry/src/placement';

type Value = FurniturePose | { locked: boolean };
type CommandRow = { owner_id: string; operation_id: string; project_id: string; type: OperationSummary['type']; object_id: string;
  revision: number; layout_id: string; fixed_facts_id: string; fixed_facts_revision: number; before_value: Value; after_value: Value;
  undo_of: string | null; undone_by: string | null; created_at: Date; has_dependency?: boolean };
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
  const report = validatePlacement({ rooms: state.fixedFacts.rooms, walls: state.fixedFacts.walls,
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
  if (row.type === 'undo' || row.undone_by) return '此操作不能再次撤销。';
  if (row.has_dependency) return '同一物体已有后续修改，请先处理后续操作。';
  if (row.layout_id !== state.currentLayout.id || row.fixed_facts_id !== state.fixedFacts.id || row.fixed_facts_revision !== state.fixedFacts.revision) return '当前方案或固定事实已变化，不能套用旧撤销。';
  const object = state.currentLayout.objects.find(o => o.id === row.object_id);
  if (!object) return '目标家具已不在当前方案中。';
  if (row.type === 'move-furniture') {
    if (state.currentLayout.lockedObjectIds.includes(row.object_id)) return '家具已锁定，不能撤销其摆放。';
    const after = row.after_value as FurniturePose, current = poseOf(object);
    if (after.x !== current.x || after.z !== current.z || after.yaw !== current.yaw) return '家具状态已变化，不能覆盖新修改。';
  } else if (state.currentLayout.lockedObjectIds.includes(row.object_id) !== (row.after_value as { locked: boolean }).locked) return '锁定状态已变化，不能覆盖新修改。';
  return null;
}
function summary(row: CommandRow, state: SpatialState): OperationSummary {
  let undoable = !undoRejection(row, state);
  if (undoable && row.type === 'move-furniture') {
    try { ensurePlacement(state, row.object_id, furniturePoseSchema.parse(row.before_value)); } catch { undoable = false; }
  }
  return { id: row.operation_id, type: row.type, objectId: row.object_id, revision: row.revision, undoable,
    createdAt: row.created_at.toISOString(), ...(row.undo_of ? { targetOperationId: row.undo_of } : {}) };
}
const dependencySQL = `EXISTS(SELECT 1 FROM project_commands later WHERE later.project_id=c.project_id AND later.object_id=c.object_id
  AND later.revision>c.revision AND later.type<>'undo' AND later.undone_by IS NULL) AS has_dependency`;
/** Project must already be authorized. `actorId` narrows to the caller's own operation (idempotent replay). */
async function readCommand(client: PoolClient, projectId: string, operationId: string, actorId?: string) {
  return (await client.query<CommandRow>(`SELECT c.*,${dependencySQL} FROM project_commands c WHERE c.project_id=$1 AND c.operation_id=$2
    AND ($3::text IS NULL OR c.owner_id=$3) ORDER BY c.revision DESC LIMIT 1`, [projectId, operationId, actorId ?? null])).rows[0];
}
async function readView(client: PoolClient, userId: string, projectId: string) {
  const row = (await client.query(`SELECT * FROM projects p WHERE p.id=$1 AND ${projectAccess('p.id', '$2')}`, [projectId, userId])).rows[0];
  if (!row) throw notFound();
  const state = spatialStateSchema.parse(row.snapshot);
  const resources = (await client.query('SELECT id,project_id,media_type,state FROM resources WHERE project_id=$1', [projectId])).rows;
  const project: ProjectView = { id: projectId, name: row.name, revision: row.revision, updatedAt: row.updated_at.toISOString(),
    synthetic: state.synthetic, scale: state.scale, scene: toScene(state, row.name),
    fixedFacts: { id: state.fixedFacts.id, revision: state.fixedFacts.revision }, currentLayout: { id: state.currentLayout.id, revision: state.currentLayout.revision },
    lockedObjectIds: state.currentLayout.lockedObjectIds,
    resources: resources.map(r => ({ id: r.id, projectId: r.project_id, mediaType: r.media_type, state: r.state })) };
  return { project, state };
}

/** Shared domain entry point for manual UI and future Worker calls. All writes occur in one transaction. */
export async function executeCommandInTransaction(client: PoolClient, principal: Principal, projectId: string, input: unknown) {
  const request = commandRequestSchema.parse(input), id = idSchema.parse(projectId), ownerId = principal.userId;
  if (!ownerId) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  const hash = createHash('sha256').update(JSON.stringify({ kind: 'command', projectId: id, ...request })).digest('hex');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${ownerId}:${request.operationId}`]);
    const project = (await client.query(`SELECT snapshot,revision FROM projects p WHERE p.id=$1 AND ${projectAccess('p.id', '$2')} FOR UPDATE`, [id, ownerId])).rows[0];
    if (!project) throw notFound();
    const previous = (await client.query('SELECT request_hash FROM operations WHERE owner_id=$1 AND id=$2', [ownerId, request.operationId])).rows[0];
    if (previous) {
      if (previous.request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409);
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
      const target = await readCommand(client, id, command.targetOperationId);
      if (!target) throw notFound();
      const reason = undoRejection(target, state);
      if (reason) throw new DomainError('UNDO_DEPENDENCY', reason, 409);
      objectId = target.object_id; before = target.after_value; after = target.before_value; undoOf = target.operation_id; undoActor = target.owner_id;
      if (target.type === 'move-furniture') {
        const pose = furniturePoseSchema.parse(after); ensurePlacement(state, objectId, pose); setPose(state, objectId, pose);
      } else setLock(state, objectId, (after as { locked: boolean }).locked);
    }
    state.currentLayout.revision++;
    const revision = project.revision + 1;
    await client.query('UPDATE projects SET snapshot=$1,revision=$2,updated_at=now() WHERE id=$3', [spatialStateSchema.parse(state), revision, id]);
    await client.query('INSERT INTO project_revisions(project_id,revision,snapshot,operation_id) VALUES($1,$2,$3,$4)', [id, revision, state, request.operationId]);
    await client.query('INSERT INTO operations(owner_id,id,project_id,request_hash,result) VALUES($1,$2,$3,$4,$5)',
      [ownerId, request.operationId, id, hash, { kind: 'command', projectId: id, revision, operationId: request.operationId }]);
    await client.query(`INSERT INTO project_commands(owner_id,operation_id,project_id,type,object_id,revision,layout_id,fixed_facts_id,fixed_facts_revision,before_value,after_value,undo_of)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [ownerId, request.operationId, id, command.type, objectId, revision,
      state.currentLayout.id, state.fixedFacts.id, state.fixedFacts.revision, before, after, undoOf]);
    if (undoOf) await client.query('UPDATE project_commands SET undone_by=$1 WHERE owner_id=$2 AND operation_id=$3', [request.operationId, undoActor, undoOf]);
}

export async function executeCommand(principal: Principal, projectId: string, input: unknown) {
  const request = commandRequestSchema.parse(input), id = idSchema.parse(projectId), ownerId = principal.userId;
  await transaction(client => executeCommandInTransaction(client, principal, id, request));
  // Return current authoritative state, even when replaying an earlier operation after later commits.
  return transaction(async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { project, state } = await readView(client, ownerId, id);
    const row = await readCommand(client, id, request.operationId, ownerId);
    if (!row) throw notFound();
    return { project, operation: summary(row, state) };
  });
}

export async function listCommands(principal: Principal, projectId: string) {
  const id = idSchema.parse(projectId);
  if (!principal.userId) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  return transaction(async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { state } = await readView(client, principal.userId, id);
    const rows = await client.query<CommandRow>(`SELECT c.*,${dependencySQL} FROM project_commands c WHERE c.project_id=$1 ORDER BY c.revision DESC LIMIT 20`, [id]);
    return rows.rows.map(row => summary(row, state));
  });
}
