import type { MultiPolygon, Polygon } from 'polygon-clipping';
import polygonClipping from 'polygon-clipping';
import { effectiveLevels, levelOf, stairBlocks, stairToPlan, type Level, type PointXZ, type SlabOpening, type Stair } from '../../contracts/src/building';
import type { Finish } from '../../contracts/src/finishes';

/** Right-handed world frame of a surface: world = origin + s·u + t·v; `normal` points out of the visible face. */
export type SurfaceFrame = { origin: [number, number, number]; u: [number, number, number]; v: [number, number, number]; normal: [number, number, number] };
export type FinishSurface = {
  /** Stable within the finish, e.g. `floor`, `wall`, `tread-3`, `riser-3`. */
  key: string; part: 'floor' | 'wall' | 'tread' | 'landing' | 'riser';
  levelId: string; polygon: MultiPolygon; frame: SurfaceFrame;
};
export type FinishFacts = {
  levels?: Level[]; finishes?: Finish[]; stairs?: Stair[]; slabOpenings?: SlabOpening[];
  rooms: { id: string; outline: PointXZ[]; levelId?: string }[];
  walls: { id: string; levelId?: string; a: PointXZ; b: PointXZ; thickness: number; height: number;
    openings: { id: string; offset: number; width: number; sill: number; head: number }[] }[];
};

/** Stone tread thickness above the structural step, also used as riser cladding thickness. */
export const STAIR_STONE = .02;
/** Finished stone face above the structural floor and in front of the wall face. Frames sit on the visible face. */
export const FLOOR_RAISE = .012, WALL_STONE = .02;
const ring = (points: PointXZ[]) => points.map(p => [p.x, p.z] as [number, number]);
const rect = (s0: number, s1: number, t0: number, t1: number): Polygon => [[[s0, t0], [s1, t0], [s1, t1], [s0, t1]]];

function stairFootprint(stair: Stair): Polygon {
  const W = stair.width / 2, D = stair.depth / 2;
  return [([[-W, -D], [W, -D], [W, D], [-W, D]] as const).map(([x, z]) => { const p = stairToPlan(stair, { x, z }); return [p.x, p.z] as [number, number]; })];
}

/** Surfaces of one finish. Floors exclude slab openings and stairs standing on them; walls exclude door and window openings. */
export function finishSurfaces(finish: Finish, facts: FinishFacts): FinishSurface[] {
  const levels = effectiveLevels(facts), level = (levelId: string) => levels.find(item => item.id === levelId) ?? levels[0];
  if (finish.kind === 'floor') {
    const room = finish.roomId ? facts.rooms.find(item => item.id === finish.roomId) : undefined;
    const levelId = room ? levelOf(room, levels) : finish.levelId ?? levels[0]?.id ?? '';
    const outline = room?.outline ?? finish.outline;
    if (!outline) return [];
    const cuts = [...(facts.slabOpenings ?? []).filter(opening => opening.levelId === levelId).map(opening => [ring(opening.outline)] as Polygon),
      ...(facts.stairs ?? []).filter(stair => stair.fromLevelId === levelId).map(stairFootprint)];
    const polygon = cuts.length ? polygonClipping.difference([ring(outline)] as Polygon, ...cuts) : [[ring(outline)]] as MultiPolygon;
    return [{ key: 'floor', part: 'floor', levelId, polygon, frame: { origin: [0, level(levelId).elevation + FLOOR_RAISE, 0], u: [1, 0, 0], v: [0, 0, 1], normal: [0, 1, 0] } }];
  }
  if (finish.kind === 'wall') {
    const wall = facts.walls.find(item => item.id === finish.wallId);
    if (!wall) return [];
    const levelId = levelOf(wall, levels), dx = wall.b.x - wall.a.x, dz = wall.b.z - wall.a.z, span = Math.hypot(dx, dz);
    const u: [number, number, number] = [dx / span, 0, dz / span], n: [number, number, number] = [-dz / span * finish.side, 0, dx / span * finish.side];
    const start = finish.start ?? 0, end = finish.end ?? span, bottom = finish.bottom ?? 0, top = finish.top ?? wall.height;
    const holes = wall.openings.map(o => rect(o.offset, o.offset + o.width, o.sill, o.head));
    const polygon = holes.length ? polygonClipping.difference(rect(start, end, bottom, top), ...holes) : [rect(start, end, bottom, top)];
    const face = wall.thickness / 2 + WALL_STONE;
    return [{ key: 'wall', part: 'wall', levelId, polygon, frame: {
      origin: [wall.a.x + n[0] * face, level(levelId).elevation, wall.a.z + n[2] * face], u, v: [0, 1, 0], normal: n } }];
  }
  const stair = facts.stairs?.find(item => item.id === finish.stairId);
  if (!stair) return [];
  const blocks = stairBlocks(stair), base = level(stair.fromLevelId).elevation, surfaces: FinishSurface[] = [];
  const centre = (b: typeof blocks[number]) => ({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 });
  const plan = (x: number, z: number) => stairToPlan(stair, { x, z });
  const dir = (x: number, z: number): [number, number, number] => { const a = plan(0, 0), b = plan(x, z); return [b.x - a.x, 0, b.z - a.z]; };
  blocks.forEach((block, index) => {
    // Incoming climb direction decides the nosing: the block edge facing where one steps up from.
    const from = centre(blocks[Math.max(0, index - 1)]), to = centre(blocks[index === 0 ? 1 : index]);
    const along = Math.abs(to.x - from.x) > Math.abs(to.z - from.z) ? 'x' : 'z', sign = (along === 'x' ? to.x - from.x : to.z - from.z) > 0 ? 1 : -1;
    // Tread-local: s across the stair from the nosing's left end, t from the nosing towards the back.
    const nose = along === 'z' ? (sign > 0 ? block.z0 : block.z1) : (sign > 0 ? block.x0 : block.x1);
    const across = along === 'z' ? block.x1 - block.x0 : block.z1 - block.z0, going = along === 'z' ? block.z1 - block.z0 : block.x1 - block.x0;
    const climb = along === 'z' ? dir(0, sign) : dir(sign, 0), side = along === 'z' ? dir(sign > 0 ? -1 : 1, 0) : dir(0, sign > 0 ? 1 : -1);
    const startLocal = along === 'z' ? { x: sign > 0 ? block.x1 : block.x0, z: nose } : { x: nose, z: sign > 0 ? block.z0 : block.z1 };
    const start = plan(startLocal.x, startLocal.z), previousTop = index ? blocks[index - 1].top : 0;
    const part = block.landing ? 'landing' : 'tread', levelId = stair.fromLevelId;
    // The tread overhangs the riser cladding by its thickness so the nosing covers the riser's top edge.
    const overhang = finish.risers ? STAIR_STONE : 0;
    surfaces.push({ key: `${part}-${index + 1}`, part, levelId, polygon: [rect(0, across, -overhang, going)],
      frame: { origin: [start.x, base + block.top + STAIR_STONE, start.z], u: side, v: climb, normal: [0, 1, 0] } });
    if (finish.risers) {
      const riserOrigin = plan(startLocal.x - (along === 'x' ? sign * STAIR_STONE : 0), startLocal.z - (along === 'z' ? sign * STAIR_STONE : 0));
      surfaces.push({ key: `riser-${index + 1}`, part: 'riser', levelId, polygon: [rect(0, across, 0, block.top - previousTop + (index ? 0 : STAIR_STONE))],
        frame: { origin: [riserOrigin.x, base + previousTop + (index ? STAIR_STONE : 0), riserOrigin.z], u: side, v: [0, 1, 0], normal: [-climb[0], 0, -climb[2]] } });
    }
  });
  return surfaces;
}
