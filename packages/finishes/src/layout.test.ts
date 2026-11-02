import test from 'node:test';
import assert from 'node:assert/strict';
import polygonClipping, { type MultiPolygon } from 'polygon-clipping';
import { layoutSurface, multiArea, onSurface, type LayoutSpec } from './layout';
import { layoutFinish, inspectSurfaceDesign } from './plan';
import { courtyard, angled } from '../../scene-runtime/src/fixtures';
import type { Finish, Tiling } from '../../contracts/src/finishes';
import { sceneSnapshotSchema } from '../../contracts/src/scene';
import { demoStone } from './demo-stones';

const rect = (w: number, h: number): MultiPolygon => [[[[0, 0], [w, 0], [w, h], [0, h]]]];
const spec = (patch: Partial<LayoutSpec> = {}): LayoutSpec => ({ tile: { length: .6, width: .6 }, pattern: 'straight', joint: 0, origin: 'edge', angle: 0, ...patch });
const pieceArea = (layout: ReturnType<typeof layoutSurface>) => layout.pieces.reduce((s, p) => s + p.area, 0);
const inside = (layout: ReturnType<typeof layoutSurface>, surface: MultiPolygon) =>
  layout.pieces.every(piece => piece.polygon.every(ring => ring.every(p => onSurface(p as [number, number], surface))));
const tiling = (finishId: string, patch: Partial<Tiling> = {}): Tiling => ({ finishId, stoneId: 'demo-white-marble', stoneVersion: 1,
  tile: { length: .6, width: .3 }, pattern: 'straight', joint: { width: 0, color: '#cccccc' }, origin: 'edge', angle: 0, ...patch });

test('rectangle, straight from the edge: whole tiles, one cut column and stone exactly covering the surface', () => {
  const surface = rect(6, 5), layout = layoutSurface(surface, spec());
  assert.deepEqual(layout.counts, { whole: 80, cut: 10, narrow: 0, borderWhole: 0, borderCut: 0 });
  assert.ok(Math.abs(pieceArea(layout) - 30) < 1e-6); assert.ok(inside(layout, surface)); assert.deepEqual(layout.issues, []);
  // Centred start: a tile sits on the centre, both edges get 0.3 m cuts.
  assert.deepEqual(layoutSurface(surface, spec({ origin: 'center' })).counts, { whole: 63, cut: 36, narrow: 0, borderWhole: 0, borderCut: 0 });
});

test('narrow strips are hints with a configurable threshold, and joints reduce the laid area', () => {
  const surface = rect(6.03, 1.2), layout = layoutSurface(surface, spec());
  assert.equal(layout.counts.narrow, 2); assert.deepEqual(layout.issues.map(i => [i.code, i.severity]), [['NARROW_CUT', 'hint']]);
  assert.equal(layoutSurface(surface, spec(), { narrowWidth: .02 }).counts.narrow, 0);
  const jointed = layoutSurface(rect(6, 5), spec({ joint: .003 }));
  assert.ok(pieceArea(jointed) < 30 - .1); assert.ok(inside(jointed, rect(6, 5)));
});

test('running bond offsets alternate rows by half a tile', () => {
  const layout = layoutSurface(rect(2.4, 1.2), spec({ pattern: 'running-bond', tile: { length: 1.2, width: .6 } }));
  assert.deepEqual([layout.counts.whole, layout.counts.cut], [3, 2]);
});

test('diagonal turns the grid by 45° and herringbone tiles alternate perpendicular directions without overlap', () => {
  const diagonal = layoutSurface([[[[-1, -1], [1, -1], [1, 1], [-1, 1]]]], spec({ pattern: 'diagonal', tile: { length: .5, width: .5 }, origin: 'center' }));
  assert.equal(diagonal.counts.whole, 5); assert.ok(Math.abs(pieceArea(diagonal) - 4) < 1e-6);
  assert.ok(diagonal.pieces.every(p => Math.abs(Math.abs(Math.sin(p.tile.angle)) - Math.SQRT1_2) < 1e-9));
  const surface = rect(3, 3), herringbone = layoutSurface(surface, spec({ pattern: 'herringbone', tile: { length: .6, width: .2 }, angle: Math.PI / 2 }));
  assert.ok(Math.abs(pieceArea(herringbone) - 9) < 1e-6, 'no overlap and no gap without joints'); assert.ok(inside(herringbone, surface));
  const angles = new Set(herringbone.pieces.map(p => Math.round(((p.tile.angle % Math.PI) + Math.PI) % Math.PI * 1e6)));
  assert.deepEqual([...angles].sort(), [Math.round(Math.PI / 4 * 1e6), Math.round(3 * Math.PI / 4 * 1e6)].sort());
  assert.ok(herringbone.counts.whole > 40 && herringbone.counts.cut > 20);
  assert.deepEqual(layoutSurface(surface, spec({ pattern: 'herringbone', tile: { length: .3, width: .3 } })).issues.map(i => [i.code, i.severity]), [['PATTERN_NEEDS_PLANK', 'conflict']]);
});

test('concave floor from a room outline: stone fills the L shape and the notch produces cut pieces', () => {
  const finish: Finish = { id: 'floor-b', kind: 'floor', roomId: 'room-b' };
  const layout = layoutFinish(finish, angled, tiling('floor-b', { tile: { length: .6, width: .6 } }));
  const surface = layout.surfaces[0].surface.polygon, region = layout.surfaces[0].layout;
  assert.ok(Math.abs(region.stoneArea - multiArea(surface)) < 1e-6); assert.ok(inside(region, surface));
  assert.deepEqual(layout.counts, { whole: 102, cut: 25, narrow: 0, borderWhole: 0, borderCut: 0, total: 127 });
});

test('border runs round the floor with mitred corners; an over-wide border exceeds the finish', () => {
  const layout = layoutSurface(rect(3, 2), spec({ border: { width: .2, pieceLength: .6 } }));
  assert.deepEqual([layout.counts.borderWhole, layout.counts.borderCut], [10, 8]);
  assert.ok(Math.abs(layout.pieces.filter(p => p.role === 'border').reduce((s, p) => s + p.area, 0) - (6 - 2.6 * 1.6)) < 1e-6);
  assert.ok(layout.pieces.filter(p => p.role === 'field').every(p => p.tile.center[0] > .2 - .3 && p.tile.center[1] > .2 - .3));
  const wide = layoutSurface(rect(1, 1), spec({ border: { width: .6, pieceLength: .6 } }));
  assert.deepEqual(wide.issues.map(i => [i.code, i.severity]), [['BORDER_EXCEEDS_FINISH', 'conflict']]);
});

test('wall finish subtracts its door opening and keeps whole rows above the head', () => {
  const finish: Finish = { id: 'wall-west', kind: 'wall', wallId: 'west-a', side: 1 };
  const layout = layoutFinish(finish, courtyard, tiling('wall-west'));
  assert.deepEqual([layout.counts.whole, layout.counts.cut, layout.counts.narrow], [58, 16, 0]);
  const door = [[[.6, 0], [1.5, 0], [1.5, 2.1], [.6, 2.1]]] as [number, number][][];
  assert.equal(multiArea(polygonClipping.intersection(layout.surfaces[0].layout.pieces.map(p => p.polygon) as MultiPolygon, door)), 0);
  // The frame sits on the room-side face, proud of the wall by the stone thickness.
  assert.deepEqual(layout.surfaces[0].surface.frame.normal.map(v => Math.round(v * 1e9) / 1e9), [1, 0, 0]);
});

const stairFacts = sceneSnapshotSchema.parse({ version: 1, unit: 'm', plane: 'xz', label: '合成楼梯', synthetic: true,
  levels: [{ id: 'l1', elevation: 0, height: 2.6, slabThickness: 0 }, { id: 'l2', elevation: 2.8, height: 2.6, slabThickness: .2 }],
  rooms: [{ id: 'r1', levelId: 'l1', outline: [{ x: -2, z: -3 }, { x: 2, z: -3 }, { x: 2, z: 3 }, { x: -2, z: 3 }], floorColor: '#dddddd' },
    { id: 'r2', levelId: 'l2', outline: [{ x: -2, z: -3 }, { x: 2, z: -3 }, { x: 2, z: 3 }, { x: -2, z: 3 }], floorColor: '#dddddd' }],
  slabOpenings: [{ id: 'well', levelId: 'l2', kind: 'stairwell', outline: [{ x: -.55, z: -1.4 }, { x: .55, z: -1.4 }, { x: .55, z: 1 }, { x: -.55, z: 1 }] }],
  stairs: [{ id: 's1', kind: 'straight', fromLevelId: 'l1', toLevelId: 'l2', position: { x: 0, z: 0 }, yaw: 0, width: 1, depth: 2.8, rise: 2.8, steps: 14 }],
  walls: [], objects: [] });

test('stair treads get one stone per tread, risers are clad unless disabled, and treads follow the climb', () => {
  const finish: Finish = { id: 'stair', kind: 'stair', stairId: 's1', risers: true };
  const layout = layoutFinish(finish, stairFacts, tiling('stair', { tile: { length: 1.2, width: .4 } }));
  assert.equal(layout.surfaces.filter(s => s.surface.part === 'tread').length, 14);
  assert.deepEqual([layout.counts.whole, layout.counts.cut, layout.counts.narrow], [0, 28, 0]);
  const tread = layout.surfaces.find(s => s.surface.part === 'tread')!.surface;
  assert.deepEqual(tread.frame.v.map(v => Math.round(v * 1e9) / 1e9), [0, 0, -1], 'straight stairs climb towards -z');
  assert.equal(layoutFinish({ ...finish, risers: false }, stairFacts, tiling('stair', { tile: { length: 1.2, width: .4 } })).counts.cut, 14);
  // Two pieces across each 1 m tread with 0.5 m stones.
  assert.equal(layoutFinish({ ...finish, risers: false }, stairFacts, tiling('stair', { tile: { length: .5, width: .25 } })).counts.cut, 28);
  // A floor finish on the start level skips the stair footprint; the upper floor skips the stairwell.
  const lower = layoutFinish({ id: 'f1', kind: 'floor', roomId: 'r1' }, stairFacts, tiling('f1')), upper = layoutFinish({ id: 'f2', kind: 'floor', roomId: 'r2' }, stairFacts, tiling('f2'));
  assert.ok(Math.abs(lower.surfaces[0].layout.area - (24 - 2.8)) < 1e-6); assert.ok(Math.abs(upper.surfaces[0].layout.area - (24 - 2.64)) < 1e-6);
});

test('catalog inspection: missing or retired versions are conflicts when changed and hints when inherited; size range is enforced', () => {
  const facts = { ...courtyard, finishes: [{ id: 'floor-a', kind: 'floor', roomId: 'room-a' } as Finish] };
  const stone = demoStone('demo-white-marble'), design = { version: 1 as const, stones: [stone], tilings: [tiling('floor-a')] };
  assert.equal(inspectSurfaceDesign(facts, design, () => ({ status: 'active', spec: stone })).adoptable, true);
  const retired = inspectSurfaceDesign(facts, design, () => ({ status: 'retired', spec: stone }));
  assert.deepEqual(retired.issues.map(i => [i.code, i.severity, i.objectId]), [['STONE_VERSION_RETIRED', 'conflict', 'floor-a']]);
  assert.equal(inspectSurfaceDesign(facts, design, () => undefined, { changedFinishIds: [] }).adoptable, true);
  assert.equal(inspectSurfaceDesign(facts, design, () => undefined, { changedFinishIds: [] }).issues[0].code, 'STONE_NOT_FOUND');
  const tampered = inspectSurfaceDesign(facts, { ...design, stones: [{ ...stone, surface: 'honed' }] }, () => ({ status: 'active', spec: stone }));
  assert.equal(tampered.issues[0].code, 'STONE_SPEC_MISMATCH');
  const oversize = inspectSurfaceDesign(facts, { ...design, tilings: [tiling('floor-a', { tile: { length: 3, width: 1.5 } })] }, () => ({ status: 'active', spec: stone }));
  assert.ok(oversize.issues.some(i => i.code === 'TILE_SIZE_OUT_OF_RANGE' && i.severity === 'conflict'));
});

test('finish facts are validated structurally and a design cannot target an undeclared finish', () => {
  const base = { ...courtyard, finishes: [{ id: 'floor-a', kind: 'floor', roomId: 'room-a' }] };
  assert.ok(sceneSnapshotSchema.safeParse(base).success);
  const codes = (value: unknown) => { const r = sceneSnapshotSchema.safeParse(value); return r.success ? [] : r.error.issues.map(i => (i as { params?: { code?: string } }).params?.code ?? i.message); };
  assert.deepEqual(codes({ ...courtyard, finishes: [{ id: 'f', kind: 'floor', roomId: 'nope' }] }), ['FINISH_UNKNOWN_ROOM']);
  assert.deepEqual(codes({ ...courtyard, finishes: [{ id: 'f', kind: 'wall', wallId: 'west-a', side: 1, end: 9 }] }), ['FINISH_OUT_OF_BOUNDS']);
  assert.deepEqual(codes({ ...courtyard, finishes: [{ id: 'f', kind: 'floor', outline: [{ x: 5, z: 4 }, { x: 7, z: 4 }, { x: 7, z: 6 }] }] }), ['FINISH_OUT_OF_BOUNDS']);
  const stone = demoStone('demo-white-marble');
  assert.deepEqual(codes({ ...base, surfaceDesign: { version: 1, stones: [stone], tilings: [tiling('floor-x')] } }), ['TILING_UNKNOWN_FINISH']);
  assert.ok(sceneSnapshotSchema.safeParse({ ...base, surfaceDesign: { version: 1, stones: [stone], tilings: [tiling('floor-a')] } }).success);
});
