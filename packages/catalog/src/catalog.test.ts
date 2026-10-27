import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { getCatalog, resolveCatalog } from './catalog';
import { catalogInstance } from './instances';
import { createSceneModel, disposeModel } from '../../scene-runtime/src/scene';
import { courtyard } from '../../scene-runtime/src/fixtures';
import { inspectLayout, objectChanges } from '../../candidates/src/checks';
import { spatialStateSchema } from '../../contracts/src/project';
import { randomUUID } from 'node:crypto';

test('catalog resolves only versioned real local source entries and validates each dimension range/step', () => {
  const catalog = getCatalog(); assert.equal(catalog.assets.length, 4); assert.equal(catalog.materials.length, 3);
  for (const asset of catalog.assets) {
    assert.equal(asset.source.kind, 'builtin-prototype'); assert.equal(asset.source.dimensionBasis, 'synthetic-template');
    const ref = { assetId: asset.id, assetVersion: asset.version, materialId: asset.defaultMaterialId, materialVersion: 1 };
    assert.equal(resolveCatalog(ref, asset.defaultSize).asset.id, asset.id);
    for (const size of [Object.fromEntries(Object.entries(asset.sizeRange).map(([key, value]) => [key, value.min])), Object.fromEntries(Object.entries(asset.sizeRange).map(([key, value]) => [key, value.max]))])
      assert.doesNotThrow(() => resolveCatalog(ref, size as typeof asset.defaultSize));
    assert.throws(() => resolveCatalog({ ...ref, assetVersion: 99 }, asset.defaultSize), { code: 'CATALOG_ASSET_UNKNOWN' });
    assert.throws(() => resolveCatalog({ ...ref, materialVersion: 99 }, asset.defaultSize), { code: 'CATALOG_MATERIAL_UNKNOWN' });
    assert.throws(() => resolveCatalog(ref, { ...asset.defaultSize, width: asset.sizeRange.width.min - .01 }), { code: 'CATALOG_SIZE_REJECTED' });
    assert.throws(() => resolveCatalog(ref, { ...asset.defaultSize, depth: asset.sizeRange.depth.min + .001 }), { code: 'CATALOG_SIZE_REJECTED' });
  }
});
test('ported prototype geometry uses real parts and exactly matches the persisted geometry envelope at all allowed size extremes', () => {
  for (const asset of getCatalog().assets) for (const boundary of ['min', 'max'] as const) {
    const size = { width: asset.sizeRange.width[boundary], height: asset.sizeRange.height[boundary], depth: asset.sizeRange.depth[boundary] };
    const object = catalogInstance('new-furniture', { assetId: asset.id, assetVersion: 1, materialId: 'prototype-wood', materialVersion: 1 }, size, { x: -3, z: 2, yaw: 0 });
    const model = createSceneModel({ ...courtyard, objects: [object] }), group = model.objects.get(object.id)!;
    const box = new T.Box3().setFromObject(group), actual = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
    assert.ok(Math.abs(actual.x - size.width) < 1e-5); assert.ok(Math.abs(actual.y - size.height) < 1e-5); assert.ok(Math.abs(actual.z - size.depth) < 1e-5);
    assert.ok(Math.abs(box.min.y) < 1e-6); assert.ok(Math.abs(center.x + 3) < 1e-6); assert.ok(Math.abs(center.z - 2) < 1e-6);
    let meshes = 0; group.traverse(child => { if (child instanceof T.Mesh) meshes++; }); assert.ok(meshes >= 8, `${asset.id} is an actual multipart model`);
    disposeModel(model.root);
  }
});
test('materials are isolated per instance and do not recolor fixed objects', () => {
  const asset = getCatalog().assets[0], common = { assetId: asset.id, assetVersion: 1, materialVersion: 1 };
  const a = catalogInstance('a', { ...common, materialId: 'prototype-wood' }, asset.defaultSize, { x: 0, z: 0, yaw: .2 });
  const b = catalogInstance('b', { ...common, materialId: 'prototype-chinese' }, asset.defaultSize, { x: 3, z: 0, yaw: .2 });
  const model = createSceneModel({ ...courtyard, objects: [a, b, courtyard.objects[2]] });
  const first = (group: T.Object3D) => { let result: T.MeshStandardMaterial | undefined; group.traverse(node => { if (!result && node instanceof T.Mesh) result = node.material as T.MeshStandardMaterial; }); return result!; };
  const ma = first(model.objects.get('a')!), mb = first(model.objects.get('b')!), fixed = first(model.objects.get('fixed-a')!);
  assert.notEqual(ma, mb); const before = fixed.color.getHex(); ma.color.set('#ff0000'); assert.notEqual(ma.color.getHex(), mb.color.getHex()); assert.equal(fixed.color.getHex(), before);
  disposeModel(model.root);
});
test('final-state validation protects measured identities against raw shrink, source relabel and delete/re-add', () => {
  const factsId = randomUUID(), base = spatialStateSchema.parse({ version: 1, synthetic: true, scale: 'synthetic', fixedFacts: { id: factsId, revision: 1, rooms: courtyard.rooms, walls: courtyard.walls, objects: [courtyard.objects[2]], openingClearances: [{ openingId: 'door-a', kind: 'none' }] }, currentLayout: { id: randomUUID(), revision: 1, fixedFactsId: factsId, fixedFactsRevision: 1, objects: [{ ...courtyard.objects[0], dimensionSource: 'measured' }, courtyard.objects[1]] } });
  for (const attack of [
    [{ ...base.currentLayout.objects[0], size: { width: .2, height: .2, depth: .2 } }, base.currentLayout.objects[1]],
    [{ ...base.currentLayout.objects[0], dimensionSource: 'unknown' as const }, base.currentLayout.objects[1]],
    [{ ...base.currentLayout.objects[0], id: 're-added' }, base.currentLayout.objects[1]],
    [base.currentLayout.objects[1]],
  ]) assert.ok(inspectLayout(base, attack).issues.some(issue => issue.code === 'MEASURED_FURNITURE_PROTECTED'));
  const moved = structuredClone(base.currentLayout.objects); moved[0].position.x = 3.2;
  assert.equal(inspectLayout(base, moved).adoptable, true); assert.equal(objectChanges(base, moved)[0].kind, 'moved');
});
