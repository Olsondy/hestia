import { z } from 'zod';
import polygonClipping, { type Polygon } from 'polygon-clipping';
import { effectiveLevels, levelOf, type Level, type PointXZ, type Stair } from './building';

// 饰面 (finish surfaces) are fixed facts: building surfaces that can carry stone. They never move with furniture.
// 铺贴方案 (surface design) is a design choice per finish: stone catalog reference + size, pattern, joint, origin,
// direction and optional border. Geometry is metres; floors use plan x/z, walls use (along wall, height).

const coordinate = z.number().finite().min(-1000).max(1000);
const point = z.object({ x: coordinate, z: coordinate }).strict();
const id = z.string().min(1).max(120);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const name = z.string().min(1).max(100).optional();
const metres = z.number().finite().nonnegative().max(1000);

export const floorFinishSchema = z.object({
  id, kind: z.literal('floor'), name,
  /** Owning level; derived from the room when `roomId` is used. */
  levelId: id.optional(),
  /** Whole room floor. Mutually exclusive with `outline` (a separately drawn area inside the level's rooms). */
  roomId: id.optional(), outline: z.array(point).min(3).max(200).optional(),
}).strict().refine(value => !!value.roomId !== !!value.outline, { message: 'Floor finish needs exactly one of roomId or outline' });
export const wallFinishSchema = z.object({
  id, kind: z.literal('wall'), name, wallId: id,
  /** 1 faces the left-hand normal of a→b, (-dz, dx); -1 the other face. */
  side: z.union([z.literal(1), z.literal(-1)]),
  /** Range along the wall centreline from `a`, and height above the level floor. Defaults to the whole face. */
  start: metres.optional(), end: metres.optional(), bottom: metres.optional(), top: metres.optional(),
}).strict();
export const stairFinishSchema = z.object({
  id, kind: z.literal('stair'), name, stairId: id,
  /** Treads and landings are always included; risers are clad with the same stone unless disabled. */
  risers: z.boolean().default(true),
}).strict();
export const finishSchema = z.discriminatedUnion('kind', [floorFinishSchema, wallFinishSchema, stairFinishSchema]);
export type Finish = z.infer<typeof finishSchema>;
export type FloorFinish = z.infer<typeof floorFinishSchema>;
export type WallFinish = z.infer<typeof wallFinishSchema>;
export type StairFinish = z.infer<typeof stairFinishSchema>;

/** Procedural illustrative texture recipe. Real enterprise imagery is never stored in the repository. */
export const proceduralStoneTextureSchema = z.object({
  kind: z.literal('procedural'), generator: z.literal('stone-v1'),
  /** veined: marble veins; grain: linear wood-grain stone; net: crossing veins; cloud: limestone/travertine-like mottling. */
  style: z.enum(['veined', 'grain', 'net', 'cloud']),
  seed: z.number().int().min(0).max(2 ** 31 - 1),
  base: color, cloud: color, vein: color,
  /** Real-world size of one texture slab, metres; vein scale is relative to it. */
  slabSize: z.number().finite().min(.5).max(4),
  features: z.number().finite().min(.5).max(12), veins: z.number().finite().min(.2).max(20),
  warp: z.number().finite().min(0).max(6), sharpness: z.number().finite().min(1).max(60),
  veinAmount: z.number().finite().min(0).max(1), cloudAmount: z.number().finite().min(0).max(1),
  /** Fine speckle / pores 0..1. */
  speckle: z.number().finite().min(0).max(1).default(0),
}).strict();
const sizeRange = z.object({ min: z.number().finite().positive().max(4), max: z.number().finite().positive().max(4) }).strict()
  .refine(value => value.min <= value.max, { message: 'Size range min must not exceed max' });
export const stoneSpecSchema = z.object({
  id, version: z.number().int().positive(), name: z.string().min(1).max(120),
  surface: z.enum(['polished', 'honed']),
  texture: proceduralStoneTextureSchema,
  /** Allowed piece sizes (length is the longer side along the laying direction). */
  sizes: z.object({ length: sizeRange, width: sizeRange }).strict(),
  thickness: z.number().finite().min(.008).max(.06),
  source: z.object({ kind: z.literal('procedural-illustration'), license: z.string().min(1).max(60), note: z.string().min(1).max(300) }).strict(),
  /** Illustrative (示意) material: never a supplier photograph. */
  illustrative: z.literal(true),
}).strict();
export type StoneSpec = z.infer<typeof stoneSpecSchema>;
export type ProceduralStoneTexture = z.infer<typeof proceduralStoneTextureSchema>;

export const stoneReferenceSchema = z.object({ stoneId: id, stoneVersion: z.number().int().positive() }).strict();
export type StoneReference = z.infer<typeof stoneReferenceSchema>;
export const tilePatternSchema = z.enum(['straight', 'running-bond', 'herringbone', 'diagonal']);
export type TilePattern = z.infer<typeof tilePatternSchema>;
export const tileSizeSchema = z.object({ length: z.number().finite().min(.05).max(4), width: z.number().finite().min(.05).max(4) }).strict()
  .refine(value => value.length >= value.width, { message: 'Tile length is the longer side' });
export const jointSchema = z.object({ width: z.number().finite().min(0).max(.02), color }).strict();
export const borderSchema = z.object({
  ...stoneReferenceSchema.shape, width: z.number().finite().min(.03).max(.6),
  /** Border pieces are cut to this length along each edge. */
  pieceLength: z.number().finite().min(.1).max(4).default(.6),
}).strict();
export const tilingSchema = z.object({
  finishId: id, ...stoneReferenceSchema.shape,
  tile: tileSizeSchema, pattern: tilePatternSchema, joint: jointSchema,
  /** 起铺点: center puts a tile on the surface centre; edge starts whole tiles from the surface's minimum corner. */
  origin: z.enum(['center', 'edge']),
  /** Direction of the tile length in surface coordinates (radians). Floors: from +x towards +z; walls: from `a` towards up. */
  angle: z.number().finite().min(-Math.PI * 2).max(Math.PI * 2),
  border: borderSchema.optional(),
}).strict();
export type Tiling = z.infer<typeof tilingSchema>;
export type TilingBorder = z.infer<typeof borderSchema>;
export const surfaceDesignSchema = z.object({
  version: z.literal(1),
  /** Immutable copies of the referenced catalog versions so rendering is deterministic and offline. */
  stones: z.array(stoneSpecSchema).max(100),
  tilings: z.array(tilingSchema).max(500),
}).strict().superRefine((value, ctx) => {
  const key = (ref: StoneReference) => `${ref.stoneId}@${ref.stoneVersion}`;
  const stones = new Set<string>();
  for (const stone of value.stones) {
    const k = key({ stoneId: stone.id, stoneVersion: stone.version });
    if (stones.has(k)) ctx.addIssue({ code: 'custom', message: `Duplicate stone: ${k}` });
    stones.add(k);
  }
  const finishes = new Set<string>(), used = new Set<string>();
  for (const tiling of value.tilings) {
    if (finishes.has(tiling.finishId)) ctx.addIssue({ code: 'custom', message: `Duplicate tiling for finish: ${tiling.finishId}` });
    finishes.add(tiling.finishId);
    for (const ref of [tiling, ...tiling.border ? [tiling.border] : []]) {
      used.add(key(ref));
      if (!stones.has(key(ref))) ctx.addIssue({ code: 'custom', message: `Tiling references a stone that is not embedded: ${key(ref)}` });
    }
  }
  for (const stone of stones) if (!used.has(stone)) ctx.addIssue({ code: 'custom', message: `Unreferenced stone: ${stone}` });
});
export type SurfaceDesign = z.infer<typeof surfaceDesignSchema>;
export const emptySurfaceDesign = (): SurfaceDesign => ({ version: 1, stones: [], tilings: [] });

/** Candidate commands. Stones are resolved from the project's workspace catalog by the service. */
export const tilingCommandSchema = z.discriminatedUnion('type', [
  tilingSchema.extend({ type: z.literal('set-tiling') }).strict(),
  z.object({ type: z.literal('clear-tiling'), finishId: id }).strict(),
]);
export type TilingCommand = z.infer<typeof tilingCommandSchema>;
export type TilingChange = { finishId: string; before: Tiling | null; after: Tiling | null };

export type FinishIssue = { code: string; objectId: string; message: string };
type FinishInput = {
  levels?: Level[]; finishes?: Finish[];
  rooms: { id: string; outline: PointXZ[]; levelId?: string }[];
  walls: { id: string; levelId?: string; a: PointXZ; b: PointXZ; height: number }[];
  stairs?: Stair[];
};
const ring = (points: PointXZ[]) => points.map(p => [p.x, p.z] as [number, number]);
const area = (polygons: [number, number][][][]) => polygons.reduce((sum, [outer, ...holes]) =>
  sum + Math.abs(signedArea(outer)) - holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0), 0);
export function signedArea(points: [number, number][]) {
  let s = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) s += (points[j][0] * points[i][1] - points[i][0] * points[j][1]);
  return s / 2;
}
/** Structural fixed-fact checks with stable codes; [] when there are no finishes. */
export function checkFinishes(input: FinishInput): FinishIssue[] {
  const issues: FinishIssue[] = [], finishes = input.finishes ?? [];
  if (!finishes.length) return issues;
  const levels = effectiveLevels(input), issue = (code: string, objectId: string, message: string) => issues.push({ code, objectId, message });
  for (const finish of finishes) {
    if (finish.kind === 'floor') {
      if (finish.roomId) {
        const room = input.rooms.find(item => item.id === finish.roomId);
        if (!room) { issue('FINISH_UNKNOWN_ROOM', finish.id, `Unknown room: ${finish.roomId}`); continue; }
        if (finish.levelId !== undefined && finish.levelId !== levelOf(room, levels)) issue('FINISH_LEVEL_MISMATCH', finish.id, 'Floor finish level differs from its room.');
        continue;
      }
      const levelId = finish.levelId ?? levels[0]?.id ?? '';
      if (finish.levelId !== undefined && !input.levels?.some(level => level.id === finish.levelId)) { issue('UNKNOWN_LEVEL', finish.id, `Unknown level: ${finish.levelId}`); continue; }
      const rooms = input.rooms.filter(room => levelOf(room, levels) === levelId).map(room => [ring(room.outline)] as Polygon);
      const outline = [ring(finish.outline!)] as Polygon;
      if (Math.abs(signedArea(outline[0])) < 1e-6) { issue('FINISH_DEGENERATE', finish.id, 'Floor finish outline has no area.'); continue; }
      const outside = rooms.length ? area(polygonClipping.difference(outline, ...rooms)) : Math.abs(signedArea(outline[0]));
      if (outside > 1e-4) issue('FINISH_OUT_OF_BOUNDS', finish.id, `Floor finish extends ${outside.toFixed(3)} m² beyond the rooms of its level.`);
    } else if (finish.kind === 'wall') {
      const wall = input.walls.find(item => item.id === finish.wallId);
      if (!wall) { issue('FINISH_UNKNOWN_WALL', finish.id, `Unknown wall: ${finish.wallId}`); continue; }
      const span = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z);
      const start = finish.start ?? 0, end = finish.end ?? span, bottom = finish.bottom ?? 0, top = finish.top ?? wall.height;
      if (end > span + 1e-6 || top > wall.height + 1e-6 || end - start < .01 || top - bottom < .01)
        issue('FINISH_OUT_OF_BOUNDS', finish.id, 'Wall finish range must lie on the wall face with positive size.');
    } else if (!(input.stairs ?? []).some(stair => stair.id === finish.stairId)) {
      issue('FINISH_UNKNOWN_STAIR', finish.id, `Unknown stair: ${finish.stairId}`);
    }
  }
  return issues;
}
