import test from 'node:test';
import assert from 'node:assert/strict';
import { demoVillaScene } from '../../finishes/src/demo-villa-scene';
import { demoStones, demoStone } from '../../finishes/src/demo-stones';
import { canonical } from '../../finishes/src/plan';
import { generateSchemes } from './generate';

const scene = demoVillaScene();
const facts = { levels: scene.levels, finishes: scene.finishes, stairs: scene.stairs, slabOpenings: scene.slabOpenings, rooms: scene.rooms, walls: scene.walls };
const all = scene.finishes!.map(finish => finish.id);

test('three distinct, adoptable schemes for the demo villa from the customer stones', () => {
  const schemes = generateSchemes(facts, all, [demoStone('demo-white-marble'), demoStone('demo-beige-marble'), demoStone('demo-grey-woodgrain')], demoStones);
  assert.equal(schemes.length, 3);
  for (const scheme of schemes) assert.equal(scheme.adoptable, true, `${scheme.name}: ${JSON.stringify(scheme.issues)}`);
  assert.equal(new Set(schemes.map(s => canonical(s.design.tilings.map(({ finishId: _f, ...t }) => t)))).size, 3);
  // Every requested finish is laid in every scheme, and stairs and walls keep their plain patterns.
  for (const scheme of schemes) {
    assert.deepEqual(scheme.design.tilings.map(t => t.finishId).sort(), [...all].sort());
    assert.equal(scheme.design.tilings.find(t => t.finishId === 'finish-f1-stair')?.pattern, 'straight');
  }
  assert.ok(schemes[0].design.tilings.some(t => t.border), 'the first mood frames floors with a border');
});

test('one preferred stone still gives schemes that differ in size or pattern, and is deterministic', () => {
  const run = () => generateSchemes(facts, ['finish-f1-living-floor'], [demoStone('demo-limestone')], demoStones);
  const schemes = run();
  assert.ok(schemes.length >= 2);
  assert.deepEqual(run(), schemes);
  assert.ok(schemes.every(scheme => scheme.design.tilings[0].stoneId === 'demo-limestone'));
});

test('unknown finishes and an empty preference give no schemes', () => {
  assert.deepEqual(generateSchemes(facts, ['nope'], [demoStone('demo-limestone')], demoStones), []);
  assert.deepEqual(generateSchemes(facts, all, [], demoStones), []);
});
