import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sceneSnapshotSchema, type SceneSnapshot } from './scene';
import { spatialStateSchema } from './project';
import { checkBuilding, stairBlocks } from './building';
import { courtyard, twoStorey, rect } from '../../scene-runtime/src/fixtures';

const codes = (scene: SceneSnapshot) => checkBuilding(scene).map(issue => `${issue.code}:${issue.objectId}`);

test('valid two-storey stair lands on both floors under a covering stairwell', () => {
  const scene = twoStorey();
  assert.deepEqual(checkBuilding(scene), []);
  assert.ok(sceneSnapshotSchema.safeParse(scene).success);
  const blocks = stairBlocks(scene.stairs![0]);
  assert.equal(blocks.length, 18); assert.equal(blocks.at(-1)!.top, 3);
});

test('stair ends off the start or arrival floor are rejected with codes and IDs', () => {
  const off = twoStorey(); off.stairs![0].position.z = 3; // start beyond the south edge
  assert.ok(codes(off).includes('STAIR_START_OFF_FLOOR:s1'));
  const arrival = twoStorey(); arrival.stairs![0].position.z = 2; arrival.slabOpenings![0].outline = rect(1, 0, 2, 4);
  assert.ok(codes(arrival).includes('STAIR_ARRIVAL_OFF_FLOOR:s1'));
  const intoWell = twoStorey(); intoWell.slabOpenings![0].outline = rect(1, 0, 2, 4.5); // arrival falls into the hole
  assert.ok(codes(intoWell).includes('STAIR_ARRIVAL_OFF_FLOOR:s1'));
});

test('slab within headroom above treads must be opened', () => {
  const none = twoStorey(); none.slabOpenings = [];
  assert.deepEqual(checkBuilding(none).map(i => [i.code, i.objectId, i.levelId]), [['STAIR_HEADROOM_NOT_OPEN', 's1', 'l2']]);
  // Lower treads have headroom (top + 2 m < slab underside 2.8 m): only the upper part needs the opening.
  const partial = twoStorey(); partial.slabOpenings![0].outline = rect(1, .5, 2, 3.65);
  assert.deepEqual(checkBuilding(partial), []);
  const tooShort = twoStorey(); tooShort.slabOpenings![0].outline = rect(1, .5, 2, 2.2);
  assert.ok(codes(tooShort).includes('STAIR_HEADROOM_NOT_OPEN:s1'));
});

test('level order and elevations must match the storey stack', () => {
  const misaligned = twoStorey(); misaligned.levels![1].elevation = 3.4; misaligned.stairs![0].rise = 3.4;
  misaligned.stairs![0].steps = 20;
  assert.deepEqual(codes(misaligned), ['LEVEL_STACK_MISMATCH:l2']);
  const reversed = twoStorey(); reversed.levels!.reverse();
  assert.ok(codes(reversed).includes('LEVEL_ORDER:l1'));
  assert.ok(codes(reversed).includes('STAIR_DIRECTION:s1'));
  const rise = twoStorey(); rise.stairs![0].rise = 2.8;
  assert.ok(codes(rise).includes('STAIR_RISE_MISMATCH:s1'));
  const steep = twoStorey(); steep.stairs![0].steps = 10;
  assert.ok(codes(steep).includes('STAIR_RISER_RANGE:s1'));
});

test('unknown levels, base-level openings and levels-free stairs are rejected', () => {
  const unknown = twoStorey(); unknown.rooms[1].levelId = 'l9';
  assert.ok(codes(unknown).includes('UNKNOWN_LEVEL:r2'));
  const base = twoStorey(); base.slabOpenings!.push({ id: 'pit', levelId: 'l1', kind: 'void', outline: rect(4, 1, 5, 2) });
  assert.ok(codes(base).includes('SLAB_OPENING_ON_BASE_LEVEL:pit'));
  const flat = { ...twoStorey(), levels: undefined };
  assert.ok(codes(flat).includes('LEVELS_REQUIRED:s1'));
  const parsed = sceneSnapshotSchema.safeParse(unknown);
  assert.equal(parsed.success, false);
  assert.ok(parsed.error!.issues.some(issue => issue.code === 'custom' && (issue as { params?: { code?: string; objectId?: string } }).params?.code === 'UNKNOWN_LEVEL'
    && (issue as { params?: { objectId?: string } }).params?.objectId === 'r2'));
});

test('U stair climbs up one side, across the back and returns to the front', () => {
  const scene = twoStorey();
  scene.stairs = [{ id: 'u1', kind: 'u', fromLevelId: 'l1', toLevelId: 'l2', position: { x: 3, z: 2 }, yaw: 0, width: 3, depth: 2.4,
    rise: 3, steps: 18, start: 'right', runWidth: 1.1, landingDepth: 1 }];
  scene.slabOpenings = [{ id: 'well', levelId: 'l2', kind: 'stairwell', outline: rect(1.5, .8, 4.5, 3.2) }];
  assert.deepEqual(checkBuilding(scene), []);
  const blocks = stairBlocks(scene.stairs[0]);
  assert.equal(blocks.length, 18); assert.equal(blocks.filter(b => b.landing).length, 2);
  assert.ok(blocks[0].x0 > 0 && blocks.at(-1)!.x1 < 0, 'starts on the right (+x) and arrives on the left');
  assert.ok(blocks.every((b, i) => i === 0 || b.top > blocks[i - 1].top));
});

test('single-storey scenes and stored states without levels stay valid unchanged', () => {
  assert.deepEqual(checkBuilding(courtyard), []);
  assert.ok(sceneSnapshotSchema.safeParse(courtyard).success);
  const factsId = randomUUID();
  const legacy = { version: 1, synthetic: true, scale: 'synthetic',
    fixedFacts: { id: factsId, revision: 1, rooms: courtyard.rooms, walls: courtyard.walls, objects: courtyard.objects.filter(o => o.kind === 'fixed'), openingClearances: [] },
    currentLayout: { id: randomUUID(), revision: 1, fixedFactsId: factsId, fixedFactsRevision: 1, objects: courtyard.objects.filter(o => o.kind === 'furniture'), lockedObjectIds: [] } };
  const parsed = spatialStateSchema.parse(legacy);
  assert.deepEqual(parsed, legacy, 'no fields are added to stored single-storey data');
  const multi = twoStorey();
  const state = { ...legacy, fixedFacts: { ...legacy.fixedFacts, levels: multi.levels, rooms: multi.rooms, walls: multi.walls, stairs: multi.stairs, slabOpenings: [] } };
  assert.throws(() => spatialStateSchema.parse(state), /STAIR_HEADROOM_NOT_OPEN/);
});
