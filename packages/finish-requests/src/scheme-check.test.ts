import test from 'node:test';
import assert from 'node:assert/strict';
import { demoVillaScene } from '../../finishes/src/demo-villa-scene';
import { demoStones } from '../../finishes/src/demo-stones';
import { demoSoftStyles } from '../../soft-styles/src/demo-styles';
import { schemeDecisionSchema, type SchemeDecision } from '../../contracts/src/agent-schemes';
import { resolveScheme } from './scheme-check';

// K03 (ADR-0019): the application, not the model, decides whether an Agent whole scheme is legal.
const scene = demoVillaScene(), state = { fixedFacts: scene, currentLayout: { objects: [] } } as never;
const requested = ['finish-f1-living-floor', 'finish-f1-tv-wall', 'finish-f1-stair'];
const style = demoSoftStyles[0].id;
const proposal = (patch: Partial<SchemeDecision> = {}): SchemeDecision => schemeDecisionSchema.parse({ kind: 'propose_scheme', name: '暖白大气', summary: '白色大理石大板直铺，深色波打线',
  tilings: [
    { finishIds: ['finish-f1-living-floor'], stoneId: 'demo-white-marble', tile: { lengthMm: 1200, widthMm: 1200 }, pattern: 'straight', border: { stoneId: 'demo-dark-gold', widthMm: 180 } },
    { finishIds: ['finish-f1-tv-wall'], stoneId: 'demo-grey-woodgrain', tile: { lengthMm: 1200, widthMm: 600 }, pattern: 'running-bond' },
    { finishIds: ['finish-f1-stair'], stoneId: 'demo-white-marble', tile: { lengthMm: 1200, widthMm: 400 }, pattern: 'straight' },
  ], softStyleId: style, softChoices: demoSoftStyles.slice(1, 3).map(s => s.id), ...patch });
const codes = (result: ReturnType<typeof resolveScheme>) => result.issues.filter(i => i.severity === 'conflict').map(i => i.code);

test('a proposal within the catalogs resolves to active stone versions and passes the layout checks', () => {
  const result = resolveScheme(state, proposal(), demoStones, demoSoftStyles, requested);
  assert.ok('design' in result);
  assert.deepEqual(codes(result), [], JSON.stringify(result.issues));
  assert.deepEqual(result.design.tilings.map(t => t.finishId).sort(), [...requested].sort());
  assert.deepEqual(result.design.stones.map(s => s.id).sort(), ['demo-dark-gold', 'demo-grey-woodgrain', 'demo-white-marble']);
  assert.equal(result.design.tilings.find(t => t.finishId === 'finish-f1-stair')?.origin, 'edge');
  assert.equal(result.style.id, style);
  assert.deepEqual(result.choices.map(c => c.styleId), [style, ...demoSoftStyles.slice(1, 3).map(s => s.id)]);
});

test('stones, styles and finishes outside the enterprise catalogs or the space are refused with reasons', () => {
  const unknown = resolveScheme(state, proposal({ softStyleId: 'not-ours', tilings: [
    { finishIds: ['finish-f1-living-floor'], stoneId: 'other-enterprise-stone', tile: { lengthMm: 600, widthMm: 600 }, pattern: 'straight' },
    { finishIds: ['finish-somewhere-else'], stoneId: 'demo-white-marble', tile: { lengthMm: 600, widthMm: 600 }, pattern: 'straight' },
  ] }), demoStones, demoSoftStyles, requested);
  assert.deepEqual(codes(unknown).sort(), ['FINISH_NOT_IN_SPACE', 'SOFT_STYLE_NOT_IN_CATALOG', 'STONE_NOT_IN_CATALOG']);
  assert.ok(!('design' in unknown));
  // A retired or missing version is not "in the catalog" either: only the active list is offered.
  const retired = resolveScheme(state, proposal(), demoStones.filter(s => s.id !== 'demo-dark-gold'), demoSoftStyles, requested);
  assert.deepEqual(codes(retired), ['STONE_NOT_IN_CATALOG']);
});

test('illegal combinations are conflicts: borders off the floor, a finish laid twice, sizes the stone does not come in', () => {
  const border = resolveScheme(state, proposal({ tilings: [
    { finishIds: ['finish-f1-tv-wall'], stoneId: 'demo-grey-woodgrain', tile: { lengthMm: 1200, widthMm: 600 }, pattern: 'running-bond', border: { stoneId: 'demo-dark-gold', widthMm: 100 } },
    { finishIds: ['finish-f1-living-floor', 'finish-f1-living-floor'], stoneId: 'demo-white-marble', tile: { lengthMm: 800, widthMm: 800 }, pattern: 'straight' },
  ] }), demoStones, demoSoftStyles, requested);
  assert.deepEqual(codes(border).sort(), ['BORDER_FLOOR_ONLY', 'FINISH_DUPLICATE']);
  const oversize = resolveScheme(state, proposal({ tilings: [
    { finishIds: ['finish-f1-living-floor'], stoneId: 'demo-white-marble', tile: { lengthMm: 4000, widthMm: 4000 }, pattern: 'straight' },
  ] }), demoStones, demoSoftStyles, requested);
  assert.ok(codes(oversize).includes('TILE_SIZE_OUT_OF_RANGE'), JSON.stringify(oversize.issues));
  // Requested finishes left out are hints only: the member decides whether that is acceptable.
  assert.ok(oversize.issues.some(i => i.code === 'FINISH_NOT_COVERED' && i.severity === 'hint'));
});
