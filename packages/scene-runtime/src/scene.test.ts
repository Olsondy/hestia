import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createSceneModel, disposeModel } from './scene';
import { createHash } from 'node:crypto';
import { courtyard, angled, twoStorey, syntheticScenes } from './fixtures';
import { sceneSnapshotSchema } from './snapshot';

test('negative coordinates and diagonal walls keep the input coordinate system', () => {
  const model = createSceneModel(angled);
  assert.equal(model.objects.get('desk-b')!.position.x, -2.1);
  const diagonal = model.objects.get('diagonal-b')!;
  const endpoint = new T.Vector3(Math.sqrt(8), 0, 0).applyMatrix4(diagonal.matrixWorld);
  assert.ok(endpoint.distanceTo(new T.Vector3(4, 0, 0)) < 1e-9);
  assert.ok(model.objects.has('door-b')); disposeModel(model.root);
});

test('window and door apertures are physical gaps, not painted wall rectangles', () => {
  const model = createSceneModel(courtyard);
  const ray = new T.Raycaster(new T.Vector3(2, 1.5, 2), new T.Vector3(0, 0, -1));
  assert.equal(ray.intersectObject(model.objects.get('north-a')!, true).length, 0);
  ray.set(new T.Vector3(.5, 1.5, 2), new T.Vector3(0, 0, -1));
  assert.ok(ray.intersectObject(model.objects.get('north-a')!, true).length > 0);
  ray.set(new T.Vector3(2, .4, 2), new T.Vector3(0, 0, -1));
  assert.ok(ray.intersectObject(model.objects.get('north-a')!, true).length > 0);
  disposeModel(model.root);
});

test('concave floor does not fill the cut-out in the L-shaped footprint', () => {
  const model = createSceneModel(angled);
  const ray = new T.Raycaster(new T.Vector3(2, 10, 4), new T.Vector3(0, -1, 0));
  assert.equal(ray.intersectObject(model.objects.get('room-b')!).length, 0);
  ray.set(new T.Vector3(-2, 10, 4), new T.Vector3(0, -1, 0));
  assert.ok(ray.intersectObject(model.objects.get('room-b')!).length > 0);
  disposeModel(model.root);
});

test('duplicate IDs, overlapping openings and non-finite coordinates are rejected', () => {
  const duplicate = structuredClone(courtyard); duplicate.objects[0].id = duplicate.rooms[0].id;
  assert.equal(sceneSnapshotSchema.safeParse(duplicate).success, false);
  const overlap = structuredClone(courtyard); overlap.walls[0].openings.push({ id: 'overlap', offset: 2, width: 1, sill: 0, head: 2 });
  assert.equal(sceneSnapshotSchema.safeParse(overlap).success, false);
  const invalid = structuredClone(courtyard); invalid.objects[0].position.x = Infinity;
  assert.equal(sceneSnapshotSchema.safeParse(invalid).success, false);
});

/** World-space mesh bounds and colours: changes whenever the rendered single-storey geometry changes. */
function geometryDigest(root: T.Object3D) {
  const parts: string[] = [];
  root.traverse(o => { if (o instanceof T.Mesh) { const b = new T.Box3().setFromObject(o);
    parts.push([b.min.toArray(), b.max.toArray()].flat().map(v => v.toFixed(5)).join(',') + ':' + (o.material as T.MeshStandardMaterial).color?.getHexString()); } });
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

test('single-storey scenes render exactly as before multi-storey support', () => {
  // Digests recorded from the pre-D03 renderer; headless PNGs were also byte-identical (docs/validation/D03-multistorey.md).
  const expected = ['5f39edfffc26e6bd08512d87773f67e54eb141edbab68d061de695e9febedc2a', '38582d404fe5e99ccaace4ed5b9b2d8e346ad8f2388fa80d94427c89cdfa8f90'];
  syntheticScenes.forEach((scene, i) => { const model = createSceneModel(scene); assert.equal(geometryDigest(model.root), expected[i]); disposeModel(model.root); });
  assert.throws(() => createSceneModel(courtyard, { mode: 'level', levelId: 'l1' }), /Unknown level/);
});

test('storeys stack at their elevations and the stairwell is a real hole', () => {
  const model = createSceneModel(twoStorey());
  const down = (x: number, z: number) => new T.Raycaster(new T.Vector3(x, 20, z), new T.Vector3(0, -1, 0))
    .intersectObjects([model.objects.get('r1')!, model.objects.get('r2')!])[0];
  const solid = down(4, 2), well = down(1.5, 2);
  assert.equal(solid.object.userData.id, 'r2'); assert.ok(Math.abs(solid.point.y - 3) < 1e-6);
  assert.equal(well.object.userData.id, 'r1'); assert.ok(Math.abs(well.point.y) < 1e-6);
  const stair = new T.Box3().setFromObject(model.objects.get('s1')!);
  assert.ok(Math.abs(stair.max.y - 3) < 1e-6 && Math.abs(stair.min.y) < 1e-6, 'stair reaches the upper floor');
  assert.ok(Math.abs(model.objects.get('bed')!.position.y - 3) < 1e-6, 'object y is relative to its storey floor');
  assert.ok(Math.abs(new T.Box3().setFromObject(model.objects.get('w2')!).max.y - 5.8) < 1e-6);
  disposeModel(model.root);
});

test('single storey and cutaway views show only the chosen storeys', () => {
  const upper = createSceneModel(twoStorey(), { mode: 'level', levelId: 'l2' });
  assert.deepEqual([...upper.objects.keys()].sort(), ['bed', 'r2', 'w2', 'well']);
  assert.ok(Math.abs(new T.Box3().setFromObject(upper.objects.get('r2')!).max.y - 3) < 1e-6, 'storey keeps its elevation');
  const lower = createSceneModel(twoStorey(), { mode: 'section', levelId: 'l1' });
  assert.deepEqual([...lower.objects.keys()].sort(), ['r1', 's1', 'w1']);
  const whole = createSceneModel(twoStorey(), { mode: 'section', levelId: 'l2' });
  assert.equal(whole.objects.size, createSceneModel(twoStorey()).objects.size);
  for (const model of [upper, lower, whole]) disposeModel(model.root);
});
