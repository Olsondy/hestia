import test from 'node:test';
import assert from 'node:assert/strict';
import { demoVillaScene } from '../../finishes/src/demo-villa-scene';
import { sceneSnapshotSchema } from '../../contracts/src/scene';
import { demoSoftStyles } from './demo-styles';
import { furnish, furnishingIssues, unfurnish } from './furnish';

const villa = demoVillaScene();

for (const style of demoSoftStyles) test(`${style.name}: extras fit the demo villa rooms without blocking doors or stairs`, () => {
  const { objects, skipped } = furnish(villa, style);
  const scene = sceneSnapshotSchema.parse({ ...villa, objects });
  assert.deepEqual(furnishingIssues(scene), []);
  const extras = objects.filter(o => o.id.startsWith('soft-'));
  assert.ok(extras.length >= 6, `${style.name}: ${extras.length} extras, skipped ${JSON.stringify(skipped)}`);
  // Every floor of the villa with a living room or bedroom gets styled furniture.
  for (const level of villa.levels!) assert.ok(objects.some(o => o.softStyle && (o.levelId ?? villa.levels![0].id) === level.id), `${style.name} on ${level.name}`);
  // Swapped furniture keeps its footprint, position and orientation.
  for (const swapped of objects.filter(o => o.softStyle?.base)) {
    const before = villa.objects.find(o => o.id === swapped.id)!;
    assert.deepEqual([swapped.position, swapped.size, swapped.yaw], [before.position, before.size, before.yaw]);
  }
  assert.ok(objects.filter(o => o.softStyle).every(o => o.tones?.fabric === style.tones.fabric));
});

test('restyling starts from the original furniture; unfurnish restores it', () => {
  const [modern, luxury] = demoSoftStyles;
  const once = furnish(villa, luxury).objects, twice = furnish({ ...villa, objects: furnish(villa, modern).objects }, luxury).objects;
  assert.deepEqual(twice.map(o => [o.id, o.name, o.position]), once.map(o => [o.id, o.name, o.position]));
  assert.deepEqual(unfurnish(once).map(o => [o.id, o.name]), villa.objects.map(o => [o.id, o.name]));
  assert.ok(once.some(o => o.name === 'curvedSofa'));
});
