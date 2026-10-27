import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { convertHouseSpecBuilding, buildingCandidateToScene, isHouseSpecBuilding } from './building.ts';
import { FloorplanImportError } from './house-spec.ts';
import { checkBuilding, stairEnds, pointInPolygon } from '../../contracts/src/building.ts';

const options = { sourceId: 'demo-villa', sourceFormat: 'housespec-mm-v1', scaleEvidence: { status: 'estimated' } } as const;
const villa = () => JSON.parse(readFileSync(new URL('../fixtures/demo-villa.housespec.json', import.meta.url), 'utf8'));
const errorCode = (code: string) => (e: unknown) => e instanceof FloorplanImportError && e.code === code;
const box = (x0: number, y0: number, x1: number, y1: number) => [
  { a: [x0, y0], b: [x1, y0], t: 200 }, { a: [x1, y0], b: [x1, y1], t: 200 },
  { a: [x1, y1], b: [x0, y1], t: 200 }, { a: [x0, y1], b: [x0, y0], t: 200 }];
const twoFloors = (stair: object, voids: object[] = [{ rect: [1000, 500, 2000, 4500] }]) => ({ slab: 200, floors: [
  { name: '一层', height: 2800, walls: box(0, 0, 6000, 5000), rooms: [{ at: [3000, 2500], name: '客厅' }], furniture: [stair] },
  { name: '二层', height: 2800, walls: box(0, 0, 6000, 5000), rooms: [{ at: [3000, 2500], name: '卧室' }], voids },
] });
const straight = { key: 'stairRun', at: [1500, 2500], rot: 0, w: 1000, d: 4000, h: 3000, opt: { steps: 18 } };

test('demo villa imports three storeys with closed rooms and connected stairs', () => {
  const source = villa();
  assert.equal(source.demo.synthetic, true); assert.match(source.demo.license, /MIT/);
  assert.ok(isHouseSpecBuilding(source));
  const c = convertHouseSpecBuilding(source, options);
  assert.deepEqual(c.levels.map(l => [l.name, l.elevation, l.height, l.slabThickness]), [['一层', 0, 3.3, .15], ['二层', 3.45, 3, .15], ['三层', 6.6, 3, .15]]);
  assert.equal(c.warnings.filter(w => w.code === 'ROOM_NOT_CLOSED').length, 0, 'every room label sits in a wall-enclosed area');
  const labels = c.floors.map(f => f.rooms.flatMap(r => r.labels.map(l => l.name)).sort());
  assert.deepEqual(labels.map(l => l.length), [12, 11, 8]);
  assert.ok(labels[1].includes('挑空') && labels[2].includes('台球室'));
  assert.deepEqual(c.stairs.map(s => [s.kind, s.fromLevelId, s.toLevelId]),
    [['u', 'demo-villa-level-1', 'demo-villa-level-2'], ['u', 'demo-villa-level-2', 'demo-villa-level-3']]);
  assert.deepEqual(c.floors.map(f => f.slabOpenings.map(o => o.kind).sort()), [[], ['shaft', 'stairwell', 'void'], ['shaft', 'stairwell']]);
  const scene = buildingCandidateToScene(c, '演示别墅 · 三层（演示数据）', true);
  assert.equal(scene.synthetic, true);
  assert.deepEqual(checkBuilding(scene), []);
  // Each stair arrival lies on a room of the upper storey, outside its stairwell.
  for (const stair of scene.stairs!) {
    const arrival = stairEnds(stair).arrival;
    assert.ok(scene.rooms.some(r => r.levelId === stair.toLevelId && pointInPolygon(arrival, r.outline)));
  }
  assert.ok(scene.objects.some(o => o.name === 'grandPiano' && o.kind === 'furniture'), 'furniture kept as ambience props');
  assert.equal(scene.objects.filter(o => o.name === 'elevator' && o.kind === 'fixed').length, 3);
  assert.deepEqual(convertHouseSpecBuilding(source, options), c, 'deterministic IDs');
});

test('straight stair connects floors and the void above it becomes the stairwell', () => {
  const c = convertHouseSpecBuilding(twoFloors(straight), { ...options, sourceId: 'mini' });
  assert.equal(c.stairs[0].kind, 'straight'); assert.equal(c.stairs[0].steps, 18);
  assert.equal(c.floors[1].slabOpenings[0].kind, 'stairwell');
  assert.deepEqual(checkBuilding(buildingCandidateToScene(c, 'mini', true)), []);
  // Without a slab opening the preview scene is rejected by the contract, naming the stair.
  const closed = convertHouseSpecBuilding(twoFloors(straight, []), { ...options, sourceId: 'mini' });
  assert.throws(() => buildingCandidateToScene(closed, 'mini', true), /STAIR_HEADROOM_NOT_OPEN mini-f1-stair-1/);
});

test('unclosed rooms are reported instead of fabricated', () => {
  const source = twoFloors(straight);
  source.floors[0].walls = box(0, 0, 6000, 5000).slice(0, 3);
  const c = convertHouseSpecBuilding(source, { ...options, sourceId: 'gap' });
  assert.equal(c.floors[0].rooms.length, 0);
  assert.ok(c.warnings.some(w => w.code === 'ROOM_NOT_CLOSED' && w.objectId === 'gap-f1-label-1'));
});

test('unsupported stairs, missing arrival storeys and sunken voids fail with codes', () => {
  assert.throws(() => convertHouseSpecBuilding(twoFloors({ ...straight, h: 2000 }), options), errorCode('STAIR_ARRIVAL_LEVEL_MISSING'));
  assert.throws(() => convertHouseSpecBuilding(twoFloors({ ...straight, z: 1500 }), options), errorCode('UNSUPPORTED_STAIR'));
  assert.throws(() => convertHouseSpecBuilding(twoFloors({ key: 'stairU', at: [3000, 2500], w: 3000, d: 2400, h: 3000 }), options), errorCode('INCOMPLETE_STAIR'));
  assert.throws(() => convertHouseSpecBuilding(twoFloors(straight, [{ rect: [1000, 500, 2000, 4500], depth: 300 }]), options), errorCode('UNSUPPORTED_SUNKEN_VOID'));
});
