import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlacement, footprint, TOLERANCE, type GeometryInput } from './placement';
import type { SceneSnapshot } from '../../contracts/src/scene';
import type { OpeningClearance } from '../../contracts/src/project';

const furniture = (id = 'chair', x = 2, z = 2): SceneSnapshot['objects'][number] => ({ id, kind: 'furniture', position: { x, y: 0, z },
  size: { width: 1, height: 1, depth: 1 }, yaw: 0, color: '#aaaaaa' });
const room = (points: number[][] = [[0, 0], [6, 0], [6, 6], [0, 6]], id = 'room') => ({ id, outline: points.map(([x, z]) => ({ x, z })), floorColor: '#aaaaaa' });
function scene(): GeometryInput { return { rooms: [room()], walls: [], objects: [furniture()] }; }
const codes = (s: GeometryInput, x: number, z: number, yaw = 0, clearances: OpeningClearance[] = []) => validatePlacement(s, 'chair', { x, z, yaw }, clearances).issues.map(i => i.code);

test('metre/xz footprint matches Three right-handed yaw, and free placement passes', () => {
  const object = furniture(); object.size.width = 2; object.size.depth = 1; object.yaw = Math.PI / 2;
  const corners = footprint(object)[0]; assert.ok(Math.abs(corners[0][0] - 1.5) < 1e-12); assert.ok(Math.abs(corners[0][1] - 3) < 1e-12);
  assert.equal(validatePlacement(scene(), 'chair', { x: 3, z: 3, yaw: .4 }).valid, true);
});
test('concave boundary rejects edge-crossing even though centre and all four corners are inside', () => {
  const s = scene(); s.rooms = [room([[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]])];
  s.objects[0].size = { width: Math.sqrt(12.5), depth: Math.sqrt(.5), height: 1 };
  assert.ok(codes(s, 1.9, 1.9, Math.PI / 4).includes('OUT_OF_BOUNDS'));
});
test('rooms form a union, and room-union holes remain outside', () => {
  const s = scene(); s.rooms = [room([[0, 0], [3, 0], [3, 6], [0, 6]], 'left'), room([[3, 0], [6, 0], [6, 6], [3, 6]], 'right')];
  assert.equal(validatePlacement(s, 'chair', { x: 3, z: 3, yaw: .4 }).valid, true);
  s.rooms = [room([[0, 0], [6, 0], [6, 1], [0, 1]], 'top'), room([[0, 5], [6, 5], [6, 6], [0, 6]], 'bottom'),
    room([[0, 1], [1, 1], [1, 5], [0, 5]], 'left'), room([[5, 1], [6, 1], [6, 5], [5, 5]], 'right')];
  assert.ok(codes(s, 3, 3).includes('OUT_OF_BOUNDS'));
});
test('rotation and the explicit 1mm local inset govern boundary tolerance', () => {
  const s = scene(); s.objects[0].size.width = 2;
  assert.ok(codes(s, .8, 3).includes('OUT_OF_BOUNDS'));
  assert.deepEqual(codes(s, .8, 3, Math.PI / 2), []);
  s.objects[0].size.width = 1;
  assert.deepEqual(codes(s, .5 - TOLERANCE.insetM / 2, 2), []);
  assert.ok(codes(s, .5 - TOLERANCE.insetM * 2, 2).includes('OUT_OF_BOUNDS'));
});
test('rotated object collisions distinguish furniture, fixed facts, and vertical separation', () => {
  const s = scene(); const fixed = furniture('fixed', 3, 3); fixed.kind = 'fixed'; fixed.yaw = Math.PI / 4; s.objects.push(fixed);
  const report = validatePlacement(s, 'chair', { x: 3, z: 3, yaw: .3 });
  assert.ok(report.issues.some(i => i.code === 'FIXED_COLLISION' && i.relatedObjectId === 'fixed'));
  fixed.kind = 'furniture'; assert.ok(codes(s, 3, 3).includes('FURNITURE_COLLISION'));
  fixed.position.y = 1; assert.deepEqual(codes(s, 3, 3), []);
});
function openingScene(sill = 0): GeometryInput {
  const s = scene(); s.rooms = [room([[-3, -3], [3, -3], [3, 3], [-3, 3]])];
  s.objects[0].size = { width: .2, height: .5, depth: .2 };
  s.walls = [{ id: 'wall', a: { x: 0, z: -2 }, b: { x: 0, z: 2 }, thickness: .2, height: 3,
    openings: [{ id: 'opening', offset: 1, width: 1, sill, head: 2 }] }]; return s;
}
test('solid wall, opening clearance, sill and lintel depend on actual vertical extent', () => {
  const s = openingScene(), none: OpeningClearance[] = [{ openingId: 'opening', kind: 'none' }];
  assert.ok(codes(s, 0, 1, 0, none).includes('WALL_COLLISION'));
  assert.deepEqual(codes(s, 0, -.5, 0, none), []);
  s.objects[0].size.height = 2.2; assert.ok(codes(s, 0, -.5, 0, none).includes('WALL_COLLISION'));
  s.objects[0].size.height = .5; s.walls[0].openings[0].sill = .8;
  assert.ok(codes(s, 0, -.5).includes('WALL_COLLISION')); assert.ok(!codes(s, 0, -.5).includes('DOOR_CLEARANCE_UNKNOWN'));
  s.objects[0].position.y = 1; assert.deepEqual(codes(s, 0, -.5), []);
});
test('diagonal wall entities collide at their actual rotated footprint', () => {
  const s = scene(); s.walls = [{ id: 'diagonal', a: { x: 1, z: 1 }, b: { x: 5, z: 5 }, thickness: .2, height: 3, openings: [] }];
  assert.ok(codes(s, 3, 3).includes('WALL_COLLISION')); assert.deepEqual(codes(s, 1, 4), []);
});
test('known swing checks full sector, selected side, hinge and height', () => {
  const s = openingScene(); const swing: OpeningClearance[] = [{ openingId: 'opening', kind: 'swing', hinge: 'start', side: 1, angle: Math.PI / 2 }];
  assert.ok(codes(s, -.4, -.5, 0, swing).includes('DOOR_SWING_COLLISION'));
  assert.deepEqual(codes(s, .4, -.5, 0, swing), []);
  s.objects[0].position.y = 2.1; assert.deepEqual(codes(s, -.4, -.5, 0, swing), []);
  s.objects[0].position.y = 0;
  swing[0] = { openingId: 'opening', kind: 'swing', hinge: 'end', side: 1, angle: Math.PI / 2 };
  assert.ok(codes(s, -.4, -.5, 0, swing).includes('DOOR_SWING_COLLISION'));
});
test('unknown floor opening is a local information restriction, never a measured collision', () => {
  const s = openingScene();
  assert.ok(codes(s, .4, -.5).includes('DOOR_CLEARANCE_UNKNOWN'));
  assert.ok(!codes(s, .4, -.5).includes('DOOR_SWING_COLLISION'));
  const far = validatePlacement(s, 'chair', { x: 2, z: 2, yaw: 0 }); assert.equal(far.valid, true);
  assert.equal(far.checks.find(c => c.code === 'door-clearances')?.status, 'not-checked');
});
test('invalid numerics, missing/degenerate/self-crossing boundaries and bad clearance references fail closed', () => {
  assert.ok(codes(scene(), Infinity, 2).includes('INVALID_GEOMETRY'));
  assert.ok(codes(scene(), 2, 2, NaN).includes('INVALID_GEOMETRY'));
  const s = scene(); s.rooms = []; assert.ok(codes(s, 2, 2).includes('MISSING_BOUNDARY'));
  s.rooms = [room([[0, 0], [6, 6], [6, 0], [0, 6]])]; assert.ok(codes(s, 2, 2).includes('INVALID_ROOM_OUTLINE'));
  assert.ok(codes(openingScene(), 2, 2, 0, [{ openingId: 'absent', kind: 'none' }]).includes('INVALID_GEOMETRY'));
});
