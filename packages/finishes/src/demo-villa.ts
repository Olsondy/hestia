import type { Finish, StoneSpec, SurfaceDesign, Tiling } from '../../contracts/src/finishes';
import { surfaceDesignSchema } from '../../contracts/src/finishes';
import { demoStone } from './demo-stones';

// Demo finishes for the demo villa (packages/floorplan-import/fixtures/demo-villa.housespec.json, imported with
// sourceId 'demo-villa'). Dimensions are illustrative (示意), as is the whole villa.
export const demoVillaFinishes: Finish[] = [
  { id: 'finish-f1-living-floor', kind: 'floor', name: '一层客厅地面', levelId: 'demo-villa-level-1',
    outline: [{ x: 9.4, z: 4.2 }, { x: 15.2, z: 4.2 }, { x: 15.2, z: 11 }, { x: 9.4, z: 11 }] },
  { id: 'finish-f1-dining-floor', kind: 'floor', name: '一层餐厅地面', levelId: 'demo-villa-level-1',
    outline: [{ x: 11, z: 0 }, { x: 15.2, z: 0 }, { x: 15.2, z: 4.2 }, { x: 11, z: 4.2 }] },
  { id: 'finish-f1-hall-floor', kind: 'floor', name: '一层楼梯过厅地面', roomId: 'demo-villa-f1-room-3' },
  // TV feature wall: living-room face of the partition behind the TV cabinet, clear of the kitchen wall junction.
  { id: 'finish-f1-tv-wall', kind: 'wall', name: '客厅电视背景墙', wallId: 'demo-villa-f1-wall-11', side: 1, start: .06, end: 3 },
  { id: 'finish-f1-stair', kind: 'stair', name: '一层至二层楼梯踏面', stairId: 'demo-villa-f1-stair-32', risers: true },
];

const tiling = (value: Tiling) => value;
export function demoVillaDesign(): SurfaceDesign {
  const tilings: Tiling[] = [
    tiling({ finishId: 'finish-f1-living-floor', stoneId: 'demo-white-marble', stoneVersion: 1, tile: { length: 1.2, width: 1.2 },
      pattern: 'straight', joint: { width: .0015, color: '#d9d2c6' }, origin: 'center', angle: 0,
      border: { stoneId: 'demo-dark-gold', stoneVersion: 1, width: .18, pieceLength: .6 } }),
    tiling({ finishId: 'finish-f1-dining-floor', stoneId: 'demo-beige-marble', stoneVersion: 1, tile: { length: .6, width: .3 },
      pattern: 'herringbone', joint: { width: .002, color: '#cbbb9f' }, origin: 'center', angle: Math.PI / 2 }),
    tiling({ finishId: 'finish-f1-hall-floor', stoneId: 'demo-limestone', stoneVersion: 1, tile: { length: .8, width: .8 },
      pattern: 'diagonal', joint: { width: .002, color: '#bdb3a3' }, origin: 'center', angle: 0 }),
    tiling({ finishId: 'finish-f1-tv-wall', stoneId: 'demo-grey-woodgrain', stoneVersion: 1, tile: { length: 1.2, width: .6 },
      pattern: 'running-bond', joint: { width: .002, color: '#7f7a73' }, origin: 'center', angle: 0 }),
    tiling({ finishId: 'finish-f1-stair', stoneId: 'demo-white-marble', stoneVersion: 1, tile: { length: 1.2, width: .4 },
      pattern: 'straight', joint: { width: .002, color: '#d9d2c6' }, origin: 'edge', angle: 0 }),
  ];
  const refs = new Set(tilings.flatMap(t => [t.stoneId, ...t.border ? [t.border.stoneId] : []]));
  const stones: StoneSpec[] = [...refs].sort().map(demoStone);
  return surfaceDesignSchema.parse({ version: 1, stones, tilings });
}
