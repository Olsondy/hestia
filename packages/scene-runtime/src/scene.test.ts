import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createSceneModel, disposeModel } from './scene';
import { courtyard, angled } from './fixtures';
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
