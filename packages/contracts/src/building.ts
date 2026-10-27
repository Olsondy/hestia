import { z } from 'zod';

// Multi-storey building facts. All levels share one plan coordinate system (metres, x/z on the floor, y up).
// Heights of level-bound geometry (walls, openings, object.position.y) are measured from the owning level's
// finished floor; world y = level.elevation + local y. A snapshot without `levels` is one implicit base level
// at elevation 0, so single-storey data stays valid without rewriting.

const coordinate = z.number().finite().min(-1000).max(1000);
const length = z.number().finite().positive().max(1000);
const point = z.object({ x: coordinate, z: coordinate }).strict();
const id = z.string().min(1).max(120);

export const levelSchema = z.object({
  id, name: z.string().min(1).max(100).optional(),
  /** Finished floor level of this storey, metres. */
  elevation: z.number().finite().min(-100).max(1000),
  /** Clear storey height, finished floor to ceiling. */
  height: length,
  /** Structural slab directly beneath this storey's finished floor. */
  slabThickness: z.number().finite().nonnegative().max(2),
}).strict();

const stairBase = {
  id, name: z.string().min(1).max(100).optional(),
  fromLevelId: id, toLevelId: id,
  /** Plan centre of the stair footprint. */
  position: point,
  /** Radians about +y. At yaw 0 the stair's back faces -z and its front (start side) faces +z. */
  yaw: z.number().finite(),
  width: length, depth: length,
  /** Total rise from the start floor to the arrival floor. */
  rise: length,
  /** Number of risers, including the final riser up to the arrival floor. */
  steps: z.number().int().min(2).max(80),
};
export const stairSchema = z.discriminatedUnion('kind', [
  /** Single flight climbing from the front edge to the back edge. */
  z.object({ ...stairBase, kind: z.literal('straight') }).strict(),
  /** U-shaped stair: up one side, across the back, back down to the front on the other side. */
  z.object({ ...stairBase, kind: z.literal('u'), start: z.enum(['left', 'right']),
    /** Width of each side flight. `runWidth * 2 === width` is a two-flight dog-leg without a well. */
    runWidth: length,
    /** Depth of the back flight or landing strip. */
    landingDepth: length }).strict(),
]);

export const slabOpeningSchema = z.object({
  id, levelId: id, name: z.string().min(1).max(100).optional(),
  /** stairwell: over a stair; void: double-height space; shaft: lift or service shaft. */
  kind: z.enum(['stairwell', 'void', 'shaft']),
  outline: z.array(point).min(3).max(200),
}).strict();

/** Rendering view: whole building, one storey alone, or a cutaway showing a storey and everything below it. */
export const sceneViewSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('building') }).strict(),
  z.object({ mode: z.literal('level'), levelId: id }).strict(),
  z.object({ mode: z.literal('section'), levelId: id }).strict(),
]);
export type SceneView = z.infer<typeof sceneViewSchema>;
export type Level = z.infer<typeof levelSchema>;
export type Stair = z.infer<typeof stairSchema>;
export type SlabOpening = z.infer<typeof slabOpeningSchema>;
export type PointXZ = { x: number; z: number };

export type BuildingInput = {
  levels?: Level[]; stairs?: Stair[]; slabOpenings?: SlabOpening[];
  rooms: { id: string; outline: PointXZ[]; levelId?: string }[];
  walls: { id: string; levelId?: string }[];
  objects: { id: string; levelId?: string }[];
};
export type BuildingIssue = { code: string; objectId: string; message: string; levelId?: string };

/** Minimum clear headroom above stair treads and landings (metres). */
export const STAIR_HEADROOM = 2;
export const RISER_RANGE = [.1, .21] as const;
const tolerance = .01;

/** Levels as rendered: absent levels mean one implicit base storey. */
export function effectiveLevels(input: { levels?: Level[]; walls?: { height: number }[] }): Level[] {
  if (input.levels?.length) return input.levels;
  const height = Math.max(0, ...(input.walls ?? []).map(wall => wall.height)) || 2.8;
  return [{ id: '', elevation: 0, height, slabThickness: 0 }];
}
/** Owning level ID; items without levelId belong to the base (first) level. */
export function levelOf(item: { levelId?: string }, levels: Level[]) { return item.levelId ?? levels[0]?.id ?? ''; }

/** Local stair coordinates (x right, z towards the front) to plan coordinates. */
export function stairToPlan(stair: Pick<Stair, 'position' | 'yaw'>, local: PointXZ): PointXZ {
  const c = Math.cos(stair.yaw), s = Math.sin(stair.yaw);
  return { x: stair.position.x + local.x * c + local.z * s, z: stair.position.z - local.x * s + local.z * c };
}

/** One solid tread or landing block; `top` is measured from the start floor. Local rectangle, axis aligned. */
export type StairBlock = { x0: number; x1: number; z0: number; z1: number; top: number; landing: boolean };
type Run = { x0: number; x1: number; z0: number; z1: number; axis: 'x' | 'z'; sign: 1 | -1 };

/** Deterministic tread geometry shared by validation and both renderers. */
export function stairBlocks(stair: Stair): StairBlock[] {
  const riser = stair.rise / stair.steps, W = stair.width / 2, D = stair.depth / 2, blocks: StairBlock[] = [];
  const flight = (run: Run, count: number, startIndex: number) => {
    const span = run.axis === 'z' ? run.z1 - run.z0 : run.x1 - run.x0, step = span / count;
    for (let k = 0; k < count; k++) {
      // sign -1 climbs towards smaller coordinates (e.g. front to back along -z).
      const a = run.sign < 0 ? (run.axis === 'z' ? run.z1 : run.x1) - (k + 1) * step : (run.axis === 'z' ? run.z0 : run.x0) + k * step;
      const top = (startIndex + k + 1) * riser;
      blocks.push(run.axis === 'z' ? { x0: run.x0, x1: run.x1, z0: a, z1: a + step, top, landing: false }
        : { x0: a, x1: a + step, z0: run.z0, z1: run.z1, top, landing: false });
    }
  };
  if (stair.kind === 'straight') { flight({ x0: -W, x1: W, z0: -D, z1: D, axis: 'z', sign: -1 }, stair.steps, 0); return blocks; }
  const s = stair.start === 'right' ? 1 : -1, inner = W - stair.runWidth, back = -D + stair.landingDepth;
  const band = (side: number) => side > 0 ? [inner, W] as const : [-W, -inner] as const;
  const [ax0, ax1] = band(s), [cx0, cx1] = band(-s);
  const lengthA = D - back, lengthB = Math.max(0, inner * 2), lengthC = lengthA;
  const flights = lengthB > 1e-6 ? 3 : 2, landings = flights - 1, treads = stair.steps - landings;
  const lengths = flights === 3 ? [lengthA, lengthB, lengthC] : [lengthA, lengthC];
  const total = lengths.reduce((a, b) => a + b, 0);
  const counts = lengths.map(value => Math.max(1, Math.floor(treads * value / total)));
  for (let i = 0; counts.reduce((a, b) => a + b, 0) < treads; i = (i + 1) % counts.length) counts[i]++;
  let index = 0;
  flight({ x0: ax0, x1: ax1, z0: back, z1: D, axis: 'z', sign: -1 }, counts[0], index); index += counts[0];
  if (flights === 3) {
    blocks.push({ x0: ax0, x1: ax1, z0: -D, z1: back, top: ++index * riser, landing: true });
    flight({ x0: -inner, x1: inner, z0: -D, z1: back, axis: 'x', sign: s > 0 ? -1 : 1 }, counts[1], index); index += counts[1];
    blocks.push({ x0: cx0, x1: cx1, z0: -D, z1: back, top: ++index * riser, landing: true });
  } else {
    blocks.push({ x0: -W, x1: W, z0: -D, z1: back, top: ++index * riser, landing: true });
  }
  flight({ x0: cx0, x1: cx1, z0: back, z1: D, axis: 'z', sign: 1 }, counts.at(-1)!, index);
  return blocks;
}

/** Plan points just outside the first and last tread, where people step on and off the stair. */
export function stairEnds(stair: Stair) {
  const margin = .15, W = stair.width / 2, D = stair.depth / 2;
  if (stair.kind === 'straight') return { start: stairToPlan(stair, { x: 0, z: D + margin }), arrival: stairToPlan(stair, { x: 0, z: -D - margin }) };
  const s = stair.start === 'right' ? 1 : -1, centre = W - stair.runWidth / 2;
  return { start: stairToPlan(stair, { x: s * centre, z: D + margin }), arrival: stairToPlan(stair, { x: -s * centre, z: D + margin }) };
}

export function pointInPolygon(p: PointXZ, polygon: PointXZ[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
function distanceToSegment(p: PointXZ, a: PointXZ, b: PointXZ) {
  const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
/** Inside or on the boundary (within `slack` metres). */
function covered(p: PointXZ, polygon: PointXZ[], slack = .002) {
  return pointInPolygon(p, polygon) || polygon.some((a, i) => distanceToSegment(p, a, polygon[(i + 1) % polygon.length]) <= slack);
}

/** Structural checks with stable codes and object IDs. Returns [] for valid and single-storey input. */
export function checkBuilding(input: BuildingInput): BuildingIssue[] {
  const issues: BuildingIssue[] = [];
  const issue = (code: string, objectId: string, message: string, levelId?: string) => issues.push({ code, objectId, message, ...(levelId ? { levelId } : {}) });
  const stairs = input.stairs ?? [], openings = input.slabOpenings ?? [];
  if (!input.levels?.length) {
    for (const item of [...input.rooms, ...input.walls, ...input.objects]) if (item.levelId) issue('UNKNOWN_LEVEL', item.id, 'Level reference requires declared levels.');
    for (const item of [...stairs, ...openings]) issue('LEVELS_REQUIRED', item.id, 'Stairs and slab openings require declared levels.');
    return issues;
  }
  const levels = input.levels, byId = new Map(levels.map((level, index) => [level.id, { level, index }]));
  for (let i = 1; i < levels.length; i++) {
    const below = levels[i - 1], level = levels[i];
    if (level.elevation <= below.elevation) { issue('LEVEL_ORDER', level.id, 'Levels must be listed bottom to top with increasing elevation.'); continue; }
    const expected = below.elevation + below.height + level.slabThickness;
    if (Math.abs(level.elevation - expected) > tolerance)
      issue('LEVEL_STACK_MISMATCH', level.id, `Elevation ${level.elevation} does not equal lower elevation + storey height + slab (${expected.toFixed(3)}).`);
  }
  for (const item of [...input.rooms, ...input.walls, ...input.objects, ...openings.map(o => ({ id: o.id, levelId: o.levelId }))])
    if (item.levelId !== undefined && !byId.has(item.levelId)) issue('UNKNOWN_LEVEL', item.id, `Unknown level: ${item.levelId}`);
  const roomsOn = (levelId: string) => input.rooms.filter(room => levelOf(room, levels) === levelId);
  const openingsOn = (levelId: string) => openings.filter(opening => opening.levelId === levelId);
  for (const opening of openings) if (byId.get(opening.levelId)?.index === 0)
    issue('SLAB_OPENING_ON_BASE_LEVEL', opening.id, 'The lowest level has no storey below to open onto.', opening.levelId);
  const onFloor = (p: PointXZ, levelId: string) => roomsOn(levelId).some(room => pointInPolygon(p, room.outline))
    && !openingsOn(levelId).some(opening => pointInPolygon(p, opening.outline));
  for (const stair of stairs) {
    const from = byId.get(stair.fromLevelId), to = byId.get(stair.toLevelId);
    if (!from || !to) { issue('UNKNOWN_LEVEL', stair.id, 'Stair references an unknown level.'); continue; }
    if (to.index <= from.index) { issue('STAIR_DIRECTION', stair.id, 'Stair must climb to a higher level.'); continue; }
    const climb = to.level.elevation - from.level.elevation;
    if (Math.abs(stair.rise - climb) > tolerance) issue('STAIR_RISE_MISMATCH', stair.id, `Stair rise ${stair.rise} does not reach the arrival floor (${climb.toFixed(3)}).`, to.level.id);
    const riser = stair.rise / stair.steps;
    if (riser < RISER_RANGE[0] || riser > RISER_RANGE[1]) issue('STAIR_RISER_RANGE', stair.id, `Riser height ${riser.toFixed(3)} is outside ${RISER_RANGE.join('–')} m.`);
    if (stair.kind === 'u' && (stair.runWidth * 2 > stair.width + 1e-9 || stair.landingDepth >= stair.depth)) {
      issue('STAIR_GEOMETRY', stair.id, 'U stair flights must fit inside its width and depth.'); continue;
    }
    const ends = stairEnds(stair);
    if (!onFloor(ends.start, from.level.id)) issue('STAIR_START_OFF_FLOOR', stair.id, 'Stair start does not land on a floor of its start level.', from.level.id);
    if (!onFloor(ends.arrival, to.level.id)) issue('STAIR_ARRIVAL_OFF_FLOOR', stair.id, 'Stair arrival does not land on a floor of its arrival level.', to.level.id);
    // Every slab between the start floor and the stair top that comes within headroom of a tread must be opened above it.
    for (const above of levels.slice(from.index + 1, to.index + 1)) {
      const underside = above.elevation - above.slabThickness - from.level.elevation;
      const holes = openingsOn(above.id);
      const blocked = stairBlocks(stair).filter(block => block.top + STAIR_HEADROOM > underside + 1e-9).some(block =>
        [[block.x0, block.z0], [block.x1, block.z0], [block.x1, block.z1], [block.x0, block.z1]].some(([x, z]) => {
          const corner = stairToPlan(stair, { x, z });
          return !holes.some(hole => covered(corner, hole.outline));
        }));
      if (blocked) issue('STAIR_HEADROOM_NOT_OPEN', stair.id, `Slab of ${above.id} is within ${STAIR_HEADROOM} m above treads that no slab opening covers.`, above.id);
    }
  }
  return issues;
}
