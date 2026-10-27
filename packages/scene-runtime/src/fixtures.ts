import type { SceneSnapshot } from './snapshot';

export const courtyard: SceneSnapshot = {
  version: 1, unit: 'm', plane: 'xz', label: '合成样本 A · 方形空间', synthetic: true,
  rooms: [{ id: 'room-a', outline: [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 5 }, { x: 0, z: 5 }], floorColor: '#d7c5ae' }],
  walls: [
    { id: 'north-a', a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, thickness: .18, height: 2.7, openings: [{ id: 'window-a', offset: 1.2, width: 2, sill: .85, head: 2.2 }] },
    { id: 'west-a', a: { x: 0, z: 5 }, b: { x: 0, z: 0 }, thickness: .18, height: 2.7, openings: [{ id: 'door-a', offset: .6, width: .9, sill: 0, head: 2.1 }] },
  ],
  objects: [
    { id: 'sofa-a', kind: 'furniture', position: { x: 3, y: 0, z: 1.2 }, size: { width: 2.1, height: .8, depth: .9 }, yaw: 0, color: '#849082' },
    { id: 'table-a', kind: 'furniture', position: { x: 3, y: 0, z: 3 }, size: { width: 1.3, height: .4, depth: .65 }, yaw: .15, color: '#ac8560' },
    { id: 'fixed-a', kind: 'fixed', position: { x: .45, y: 0, z: .7 }, size: { width: .6, height: 1.6, depth: 1 }, yaw: 0, color: '#d9d2c6' },
  ],
};

export const angled: SceneSnapshot = {
  version: 1, unit: 'm', plane: 'xz', label: '合成样本 B · 凹形与斜墙', synthetic: true,
  rooms: [{ id: 'room-b', outline: [{ x: -4, z: -2 }, { x: 2, z: -2 }, { x: 4, z: 0 }, { x: 4, z: 2 }, { x: 0, z: 2 }, { x: 0, z: 5 }, { x: -4, z: 5 }], floorColor: '#c6c8b9' }],
  walls: [
    { id: 'north-b', a: { x: -4, z: -2 }, b: { x: 2, z: -2 }, thickness: .2, height: 2.8, openings: [{ id: 'window-b', offset: .7, width: 1.8, sill: .9, head: 2.3 }] },
    { id: 'diagonal-b', a: { x: 2, z: -2 }, b: { x: 4, z: 0 }, thickness: .2, height: 2.8, openings: [{ id: 'door-b', offset: .8, width: 1, sill: 0, head: 2.2 }] },
    { id: 'west-b', a: { x: -4, z: 5 }, b: { x: -4, z: -2 }, thickness: .2, height: 2.8, openings: [] },
  ],
  objects: [
    { id: 'desk-b', kind: 'furniture', position: { x: -2.1, y: 0, z: -.7 }, size: { width: 1.5, height: .75, depth: .7 }, yaw: -.25, color: '#a78362' },
    { id: 'bed-b', kind: 'furniture', position: { x: -2, y: 0, z: 3 }, size: { width: 1.6, height: .55, depth: 2 }, yaw: 0, color: '#b3aaa0' },
    { id: 'fixed-b', kind: 'fixed', position: { x: 3, y: 0, z: .5 }, size: { width: .6, height: 2, depth: 1 }, yaw: 0, color: '#8b927e' },
  ],
};

export const syntheticScenes = [courtyard, angled];

export const rect = (x0: number, z0: number, x1: number, z1: number) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
/** Two storeys of a 6 × 5 m plan, a straight stair climbing towards -z and a stairwell above it. */
export function twoStorey(): SceneSnapshot {
  return {
    version: 1, unit: 'm', plane: 'xz', label: '合成两层', synthetic: true,
    levels: [{ id: 'l1', elevation: 0, height: 2.8, slabThickness: .2 }, { id: 'l2', elevation: 3, height: 2.8, slabThickness: .2 }],
    rooms: [{ id: 'r1', levelId: 'l1', outline: rect(0, 0, 6, 5), floorColor: '#d7c5ae' }, { id: 'r2', levelId: 'l2', outline: rect(0, 0, 6, 5), floorColor: '#c8a77f' }],
    walls: [{ id: 'w1', levelId: 'l1', a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, thickness: .2, height: 2.8, openings: [] },
      { id: 'w2', levelId: 'l2', a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, thickness: .2, height: 2.8, openings: [] }],
    stairs: [{ id: 's1', kind: 'straight', fromLevelId: 'l1', toLevelId: 'l2', position: { x: 1.5, z: 2.5 }, yaw: 0, width: 1, depth: 4, rise: 3, steps: 18 }],
    slabOpenings: [{ id: 'well', levelId: 'l2', kind: 'stairwell', outline: rect(1, .5, 2, 4.5) }],
    objects: [{ id: 'bed', levelId: 'l2', kind: 'furniture', position: { x: 4, y: 0, z: 3 }, size: { width: 1.5, height: .5, depth: 2 }, yaw: 0, color: '#b3aaa0' }],
  };
}
