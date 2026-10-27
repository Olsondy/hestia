import test from 'node:test';
import assert from 'node:assert/strict';
import { convertHouseSpec, mmToPointXZ, pointXZToMm, clockwiseDegreesToYaw, FloorplanImportError } from './house-spec.ts';

const options = { sourceId: 'synthetic', sourceFormat: 'housespec-mm-v1', scaleEvidence: { status: 'estimated' } } as const;
const make = () => ({ height: 2800, walls: [{ a: [1000, 2000], b: [7000, 2000], t: 240,
  openings: [{ type: 'door', from: 2000, to: 2900, sill: 0, head: 2100 }] }] });
const errorCode = (code: string) => (e: unknown) => e instanceof FloorplanImportError && e.code === code;

test('finite inputs whose coordinate arithmetic overflows are rejected', () => {
  assert.throws(() => mmToPointXZ([1e308, 0], [-1e308, 0]));
  assert.throws(() => pointXZToMm({ x: 1e308, z: 0 }));
  const s = make(); s.walls[0].a = [-1e308, 0]; s.walls[0].b = [1e308, 0];
  assert.throws(() => convertHouseSpec(s, options), errorCode('DEGENERATE_WALL'));
});
test('type-specific opening height defaults remain marked as assumptions', () => {
  for (const [type, sill, head] of [['floorWindow', 0, 2.5], ['highWindow', 1.5, 2.1], ['glassWall', 0, 2.6], ['sliding', 0, 2.4]] as const) {
    const s = make();
    const c = convertHouseSpec({ ...s, walls: [{ ...s.walls[0], openings: [{ type, from: 2000, to: 2900 }] }] }, options);
    assert.equal(c.walls[0].openings[0].sill, sill); assert.equal(c.walls[0].openings[0].head, head);
    assert.equal(c.walls[0].openings[0].confirmed, false);
    assert.ok(c.warnings.some(w => w.code === 'ASSUMED_OPENING_HEIGHT'));
  }
});

test('millimetre coordinates preserve half-millimetre precision and explicit origin', () => {
  const p = [1234.5, -567.5] as const, origin = [120, -240] as const;
  const restored = pointXZToMm(mmToPointXZ(p, origin), origin);
  assert.ok(Math.abs(restored[0] - p[0]) < 1e-9 && Math.abs(restored[1] - p[1]) < 1e-9);
});
test('horizontal opening absolute x becomes offset along a to b', () => {
  const c = convertHouseSpec(make(), options);
  assert.deepEqual(c.walls[0].a, { x: 1, z: 2 });
  assert.equal(c.walls[0].openings[0].offset, 1);
  assert.equal(c.walls[0].openings[0].width, .9);
});
test('reversed horizontal wall preserves position and hinge identity', () => {
  const s = make(); s.walls[0].a = [7000, 2000]; s.walls[0].b = [1000, 2000];
  const c = convertHouseSpec({ ...s, walls: [{ ...s.walls[0], openings: [{ ...s.walls[0].openings[0], hinge: 'from' }] }] }, options);
  assert.equal(c.walls[0].openings[0].offset, 4.1); assert.equal(c.walls[0].openings[0].hinge, 'end');
});
test('vertical opening uses absolute y and supports reversed direction', () => {
  const s = make(); s.walls[0].a = [1000, 7000]; s.walls[0].b = [1000, 1000];
  const o = convertHouseSpec(s, options).walls[0].openings[0]; assert.equal(o.offset, 4.1); assert.equal(o.width, .9);
});
test('diagonal opening uses distance from a rather than either absolute axis', () => {
  const s = make(); s.walls[0].a = [1000, 1000]; s.walls[0].b = [4000, 5000];
  assert.equal(convertHouseSpec(s, options).walls[0].openings[0].offset, 2);
});
test('source north does not rotate coordinates or imply geographical east', () => {
  const c = convertHouseSpec({ ...make(), north: 90 }, options);
  assert.equal(c.northClockwiseRadians, Math.PI / 2); assert.deepEqual(c.walls[0].a, { x: 1, z: 2 });
  assert.equal(clockwiseDegreesToYaw(90), -Math.PI / 2);
});
test('bearing and fixed object guesses remain unconfirmed even with calibrated scale', () => {
  const c = convertHouseSpec({ ...make(), structs: [{ kind: 'column', at: [1000, 2000] }],
    confirmed: true, scale: { status: 'calibrated' } }, { ...options, scaleEvidence: { status: 'calibrated', evidenceId: 'user-length-1', verifiedBy: 'user' } });
  assert.equal(c.confirmed, false); assert.equal(c.walls[0].confirmed, false); assert.equal(c.fixedObjectCandidates[0].confirmed, false);
  assert.equal(c.fixedObjectCandidates[0].width, null); assert.equal(c.conceptOnly, false);
  assert.ok(c.warnings.some(w => w.code === 'UNMAPPED_SOURCE_FIELDS'));
});
test('model-supplied scale fields cannot promote missing scale', () => {
  const c = convertHouseSpec({ ...make(), scale: { status: 'calibrated' } }, { ...options, scaleEvidence: { status: 'missing' } });
  assert.equal(c.scale.status, 'missing'); assert.equal(c.conceptOnly, true);
});
test('trusted calibrated scale requires traceable evidence', () => {
  assert.throws(() => convertHouseSpec(make(), { ...options, scaleEvidence: { status: 'calibrated' } } as never));
});
test('rejects nonfinite geometry, zero-length walls and unknown format', () => {
  const s = make(); s.walls[0].a[0] = Infinity; assert.throws(() => convertHouseSpec(s, options));
  const z = make(); z.walls[0].b = [...z.walls[0].a]; assert.throws(() => convertHouseSpec(z, options), errorCode('DEGENERATE_WALL'));
  assert.throws(() => convertHouseSpec(make(), { ...options, sourceFormat: 'unknown' } as never));
});
test('rejects out-of-wall and overlapping openings without changing input', () => {
  const s = make(); s.walls[0].openings[0].from = 500; const before = JSON.stringify(s);
  assert.throws(() => convertHouseSpec(s, options), errorCode('OPENING_OUT_OF_BOUNDS')); assert.equal(JSON.stringify(s), before);
  const p = make(); p.walls[0].openings.push({ ...p.walls[0].openings[0], from: 2800, to: 3500 });
  assert.throws(() => convertHouseSpec(p, options), errorCode('OVERLAPPING_OPENINGS'));
});
test('rejects impossible heights, duplicate IDs and unsupported flush semantics', () => {
  const s = make(); s.walls[0].openings[0].head = 3000; assert.throws(() => convertHouseSpec(s, options), errorCode('INVALID_OPENING_HEIGHT'));
  assert.throws(() => convertHouseSpec({ ...make(), walls: [{ ...make().walls[0], id: 'same' }, { ...make().walls[0], id: 'same' }] }, options), errorCode('DUPLICATE_ID'));
  assert.throws(() => convertHouseSpec({ ...make(), walls: [{ ...make().walls[0], flush: 'W' }] }, options), errorCode('UNSUPPORTED_FLUSH'));
});
test('labels are not fabricated enclosed rooms and generated IDs are stable', () => {
  const s = { ...make(), rooms: [{ name: '工作区', at: [2000, 3000] }] };
  const a = convertHouseSpec(s, options), b = convertHouseSpec(s, options);
  assert.deepEqual(a, b); assert.equal(a.roomLabels[0].name, '工作区'); assert.equal('rooms' in a, false);
  assert.ok(a.warnings.some(w => w.code === 'TOPOLOGY_NOT_CHECKED'));
});
