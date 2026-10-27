import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../../persistence/src/client';
import { createProject, getProject } from '../../projects/src/service';
import { executeCommand, listCommands } from './service';
import type { Command } from '../../contracts/src/commands';
import { spatialStateSchema } from '../../contracts/src/project';

const owner = { userId: `commands-${randomUUID()}` }, outsider = { userId: `commands-${randomUUID()}` };
const create = () => createProject(owner, { name: '合成家具命令验证', template: 'courtyard', operationId: randomUUID() });
const move = (x: number, z: number, objectId = 'sofa-a', yaw = 0): Command => ({ type: 'move-furniture', objectId, x, z, yaw });
const request = (revision: number, command: Command) => ({ operationId: randomUUID(), expectedRevision: revision, command });
const object = (p: Awaited<ReturnType<typeof getProject>>, id = 'sofa-a') => p.scene.objects.find(o => o.id === id)!;
async function saved(id: string) {
  const project = (await pool.query('SELECT snapshot,revision FROM projects WHERE id=$1', [id])).rows[0];
  return { project, history: (await pool.query('SELECT revision FROM project_revisions WHERE project_id=$1 ORDER BY revision', [id])).rows,
    operations: (await pool.query('SELECT id,result FROM operations WHERE project_id=$1 ORDER BY id', [id])).rows,
    commands: (await pool.query('SELECT operation_id,undone_by FROM project_commands WHERE project_id=$1 ORDER BY operation_id', [id])).rows };
}
after(async () => {
  await pool.query('DELETE FROM operations WHERE owner_id=$1', [owner.userId]);
  await pool.query('DELETE FROM project_revisions WHERE project_id IN (SELECT id FROM projects WHERE owner_id=$1)', [owner.userId]);
  await pool.query('DELETE FROM projects WHERE owner_id=$1', [owner.userId]);
  await pool.end();
});

test('concurrent identical requests apply once; replay and fixed facts remain stable', async () => {
  const p = await create(), before = await saved(p.id), input = request(1, move(4, 1.2, 'sofa-a', .1));
  const results = await Promise.all([executeCommand(owner, p.id, input), executeCommand(owner, p.id, input)]);
  assert.equal(results[0].project.revision, 2); assert.equal(results[1].project.revision, 2);
  assert.equal(object(results[0].project).position.x, 4); assert.equal(object(results[0].project).yaw, .1);
  const after = await saved(p.id); assert.deepEqual(after.project.snapshot.fixedFacts, before.project.snapshot.fixedFacts);
  assert.equal(after.history.length, 2); assert.equal(after.commands.length, 1); assert.equal(after.operations.length, 2);
  await assert.rejects(executeCommand(owner, p.id, { ...input, command: move(3.5, 1.2) }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(await saved(p.id), after);
});
test('two different operations competing for one revision commit only one', async () => {
  const p = await create();
  const results = await Promise.allSettled([executeCommand(owner, p.id, request(1, move(4, 1.2))), executeCommand(owner, p.id, request(1, move(3.8, 1.2)))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult; assert.equal(rejected.reason.code, 'REVISION_CONFLICT');
  assert.equal((await saved(p.id)).commands.length, 1); assert.equal((await getProject(owner, p.id)).revision, 2);
});
test('wall, fixed collision, bounds, invalid values and fixed-object mutation leave no partial writes', async () => {
  const p = await create(), baseline = await saved(p.id);
  for (const command of [move(3, 0), move(.45, .7), move(20, 1), move(NaN, 1), move(1, 1, 'fixed-a'),
    { type: 'set-lock', objectId: 'fixed-a', locked: false } as Command]) {
    await assert.rejects(executeCommand(owner, p.id, request(1, command)));
    assert.deepEqual(await saved(p.id), baseline);
  }
});
test('locks block exact edits and lock undo restores state as a new revision', async () => {
  const p = await create(), locked = await executeCommand(owner, p.id, request(1, { type: 'set-lock', objectId: 'sofa-a', locked: true }));
  assert.deepEqual(locked.project.lockedObjectIds, ['sofa-a']); const baseline = await saved(p.id);
  await assert.rejects(executeCommand(owner, p.id, request(2, move(4, 1.2))), { code: 'OBJECT_LOCKED' });
  assert.deepEqual(await saved(p.id), baseline);
  const undone = await executeCommand(owner, p.id, request(2, { type: 'undo', targetOperationId: locked.operation.id }));
  assert.deepEqual(undone.project.lockedObjectIds, []); assert.equal(undone.project.revision, 3);
});

test('undo restores an existing finite scene yaw outside the public edit range', async () => {
  const p = await create(), originalYaw = 2 * Math.PI + .15;
  const state = (await saved(p.id)).project.snapshot;
  state.currentLayout.objects.find((entry: { id: string }) => entry.id === 'sofa-a').yaw = originalYaw;
  spatialStateSchema.parse(state);
  await pool.query('UPDATE projects SET snapshot=$1 WHERE id=$2', [state, p.id]);
  const baseline = await saved(p.id);
  await assert.rejects(executeCommand(owner, p.id, request(1, move(4, 1.2, 'sofa-a', originalYaw))));
  assert.deepEqual(await saved(p.id), baseline, 'new edit input remains bounded and makes no partial writes');
  const moved = await executeCommand(owner, p.id, request(1, move(4, 1.2, 'sofa-a', .1)));
  assert.equal(moved.operation.undoable, true, 'a valid stored pose must remain undoable');
  const undone = await executeCommand(owner, p.id, request(2, { type: 'undo', targetOperationId: moved.operation.id }));
  assert.equal(object(undone.project).yaw, originalYaw);
  assert.equal(object(undone.project).position.x, 3);
});
test('undo refuses dependent edits and supports safe reverse order with idempotent undo', async () => {
  const p = await create();
  const a = await executeCommand(owner, p.id, request(1, move(4, 1.2)));
  const b = await executeCommand(owner, p.id, request(2, move(4, 1.5)));
  const baseline = await saved(p.id);
  await assert.rejects(executeCommand(owner, p.id, request(3, { type: 'undo', targetOperationId: a.operation.id })), { code: 'UNDO_DEPENDENCY' });
  assert.deepEqual(await saved(p.id), baseline);
  const undoRequest = request(3, { type: 'undo', targetOperationId: b.operation.id });
  const undoB = await executeCommand(owner, p.id, undoRequest);
  assert.equal(undoB.project.revision, 4); assert.equal(object(undoB.project).position.z, 1.2);
  assert.equal((await executeCommand(owner, p.id, undoRequest)).project.revision, 4);
  await assert.rejects(executeCommand(owner, p.id, request(4, { type: 'undo', targetOperationId: b.operation.id })), { code: 'UNDO_DEPENDENCY' });
  const undoA = await executeCommand(owner, p.id, request(4, { type: 'undo', targetOperationId: a.operation.id }));
  assert.equal(undoA.project.revision, 5); assert.equal(object(undoA.project).position.x, 3);
  const history = await listCommands(owner, p.id); assert.equal(history.length, 4); assert.ok(history.every(o => !o.undoable));
});
test('undo preserves independent object edits, and rejects inverse placement into a new obstacle', async () => {
  for (const blocking of [false, true]) {
    const p = await create(); const first = await executeCommand(owner, p.id, request(1, move(4, 4)));
    const second = await executeCommand(owner, p.id, request(2, move(3, blocking ? 1.2 : 2.2, 'table-a', .15)));
    if (blocking) {
      const baseline = await saved(p.id);
      await assert.rejects(executeCommand(owner, p.id, request(3, { type: 'undo', targetOperationId: first.operation.id })), { code: 'PLACEMENT_REJECTED' });
      assert.deepEqual(await saved(p.id), baseline);
    } else {
      const undone = await executeCommand(owner, p.id, request(3, { type: 'undo', targetOperationId: first.operation.id }));
      assert.equal(object(undone.project).position.x, 3); assert.equal(object(undone.project, 'table-a').position.z, object(second.project, 'table-a').position.z);
    }
  }
});
test('database failure after UPDATE rolls the project and history back together', async () => {
  const p = await create(); const snapshot = (await saved(p.id)).project.snapshot;
  // An isolated fixture row occupies the next revision to force an INSERT failure after the UPDATE.
  await pool.query('INSERT INTO project_revisions(project_id,revision,snapshot,operation_id) VALUES($1,2,$2,$3)', [p.id, snapshot, randomUUID()]);
  const baseline = await saved(p.id);
  await assert.rejects(executeCommand(owner, p.id, request(1, move(4, 1.2))), { code: '23505' });
  assert.deepEqual(await saved(p.id), baseline);
  await pool.query('DELETE FROM project_revisions WHERE project_id=$1 AND revision=2', [p.id]);
  assert.equal((await executeCommand(owner, p.id, request(1, move(4, 1.2)))).project.revision, 2);
});
test('ownership, unknown scale, and changed fixed-fact version are enforced in the domain service', async () => {
  const p = await create();
  await assert.rejects(executeCommand(outsider, p.id, request(1, move(4, 1.2))), { code: 'NOT_FOUND' });
  await assert.rejects(listCommands(outsider, p.id), { code: 'NOT_FOUND' });
  await pool.query("UPDATE projects SET snapshot=jsonb_set(snapshot,'{scale}','\"missing\"') WHERE id=$1", [p.id]);
  const baseline = await saved(p.id);
  await assert.rejects(executeCommand(owner, p.id, request(1, move(4, 1.2))), { code: 'SCALE_UNCONFIRMED' }); assert.deepEqual(await saved(p.id), baseline);
  const q = await create(), moved = await executeCommand(owner, q.id, request(1, move(4, 1.2)));
  await pool.query("UPDATE projects SET snapshot=jsonb_set(jsonb_set(snapshot,'{fixedFacts,revision}','2'),'{currentLayout,fixedFactsRevision}','2') WHERE id=$1", [q.id]);
  await assert.rejects(executeCommand(owner, q.id, request(2, { type: 'undo', targetOperationId: moved.operation.id })), { code: 'UNDO_DEPENDENCY' });
});
test('fact and lock metadata are strict, and operation history is bounded to the latest twenty summaries', async () => {
  const p = await create(), state = (await saved(p.id)).project.snapshot;
  assert.throws(() => spatialStateSchema.parse({ ...state, synthetic: false }));
  assert.throws(() => spatialStateSchema.parse({ ...state, currentLayout: { ...state.currentLayout, lockedObjectIds: ['fixed-a'] } }));
  for (const clearance of [{ openingId: 'window-a', kind: 'none' }, { openingId: 'door-a', kind: 'swing' }, { openingId: 'missing', kind: 'none' }])
    assert.throws(() => spatialStateSchema.parse({ ...state, fixedFacts: { ...state.fixedFacts, openingClearances: [clearance] } }));
  for (let i = 0; i < 22; i++) await executeCommand(owner, p.id, request(i + 1, { type: 'set-lock', objectId: 'sofa-a', locked: i % 2 === 0 }));
  const history = await listCommands(owner, p.id);
  assert.equal(history.length, 20); assert.equal(history[0].revision, 23); assert.equal(history[19].revision, 4);
  assert.equal(history[0].undoable, true); assert.ok(history.slice(1).every(o => !o.undoable));
  assert.ok(history.every(o => !('before_value' in o) && !('owner_id' in o)));
});
