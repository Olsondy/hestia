import { z } from 'zod';
import { sceneSnapshotSchema, type SceneSnapshot } from '../../contracts/src/scene';
import type { Level, SlabOpening, Stair } from '../../contracts/src/building';
import { pointInPolygon } from '../../contracts/src/building';
import {
  clockwiseDegreesToYaw, convertFloor, finite, floorFieldsSchema, FloorplanImportError, mmToPointXZ, parseImportOptions,
  point, uniqueIds, type ImportOptions, type ImportWarning,
} from './house-spec';
import { enclosedFaces, insideMm } from './rooms';

const furniture = z.object({
  id: z.string().min(1).optional(), key: z.string().min(1).max(60), at: point, rot: finite.optional(),
  w: finite.positive().optional(), d: finite.positive().optional(), h: finite.positive().optional(), z: finite.optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), opt: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
const voidSchema = z.object({
  rect: z.tuple([finite, finite, finite, finite]), name: z.string().max(100).optional(),
  depth: finite.nonnegative().optional(), shaft: z.boolean().optional(),
}).passthrough();
const floorSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/).optional(), name: z.string().min(1).max(100), ...floorFieldsSchema,
  furniture: z.array(furniture).max(1000).default([]), voids: z.array(voidSchema).max(100).default([]),
}).passthrough();
/** HouseSpec whole-building format: `floors` bottom to top, shared plan coordinates, `slab` and `base` in mm. */
const buildingSchema = z.object({
  name: z.string().max(200).optional(), north: finite.optional(), slab: finite.nonnegative().max(2000),
  base: finite.optional(), floors: z.array(floorSchema).min(1).max(20),
}).passthrough();

const stairKeys = new Set(['stairU', 'stairRun']);
const fixedKeys = new Set(['elevator']);
export const isHouseSpecBuilding = (input: unknown) => typeof input === 'object' && input !== null && Array.isArray((input as { floors?: unknown }).floors);

/**
 * Converts a whole-building HouseSpec into an unconfirmed import candidate. Rooms are faces actually enclosed by
 * wall centrelines; labels only name them. Furniture other than stairs and lifts is kept as ambience props.
 */
export function convertHouseSpecBuilding(input: unknown, options: ImportOptions) {
  const config = parseImportOptions(options), source = buildingSchema.parse(input);
  const origin = config.originMm ?? [0, 0] as const, uniqueId = uniqueIds(), warnings: ImportWarning[] = [];
  const base = source.base ?? 0, slab = source.slab;
  let elevation = base;
  const levels: Level[] = source.floors.map((floor, index) => {
    if (index) elevation += source.floors[index - 1].height + slab;
    return { id: uniqueId(floor.id ?? `${config.sourceId}-level-${index + 1}`), name: floor.name,
      elevation: elevation / 1000, height: floor.height / 1000, slabThickness: slab / 1000 };
  });
  const stairs: Stair[] = [];
  const floors = source.floors.map((floor, index) => {
    const level = levels[index], prefix = `${config.sourceId}-f${index + 1}`;
    const converted = convertFloor(floor, origin, prefix, uniqueId, warnings);
    const faces = enclosedFaces(floor.walls);
    const assigned = faces.map(() => [] as number[]);
    floor.rooms.forEach((label, li) => {
      const face = faces.findIndex(f => insideMm(label.at, f.outline));
      if (face < 0) warnings.push({ code: 'ROOM_NOT_CLOSED', objectId: converted.roomLabels[li].id, detail: `Label "${label.name}" is not inside a wall-enclosed area.` });
      else assigned[face].push(li);
    });
    const rooms = faces.map((face, fi) => {
      const labels = assigned[fi].map(li => ({ ...converted.roomLabels[li], material: typeof floor.rooms[li].mat === 'string' ? floor.rooms[li].mat as string : null }));
      if (labels.length > 1) warnings.push({ code: 'SHARED_ROOM_FACE', objectId: labels[0].id, detail: `Labels share one enclosed area: ${labels.map(l => l.name).join(', ')}` });
      return { id: uniqueId(`${prefix}-room-${fi + 1}`), levelId: level.id, outline: face.outline.map(p => mmToPointXZ(p, origin)),
        areaM2: Math.round(face.area / 1e4) / 100, labels, confirmed: false as const };
    });
    const slabOpenings: SlabOpening[] = floor.voids.map((v, vi) => {
      const voidId = uniqueId(`${prefix}-void-${vi + 1}`);
      if (v.depth) throw new FloorplanImportError('UNSUPPORTED_SUNKEN_VOID', voidId, 'Sunken floor areas are not supported; only full slab openings.');
      const [x0, y0, x1, y1] = v.rect;
      if (!(x1 > x0 && y1 > y0)) throw new FloorplanImportError('INVALID_VOID', voidId, 'Void rectangle must be [x0, y0, x1, y1] with positive size.');
      const outline = ([[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as const).map(p => mmToPointXZ(p, origin));
      return { id: voidId, levelId: level.id, ...(v.name ? { name: v.name } : {}), kind: v.shaft ? 'shaft' : 'void', outline };
    });
    const props: { id: string; key: string; kind: 'furniture' | 'fixed'; position: { x: number; y: number; z: number };
      size: { width: number; height: number; depth: number }; yaw: number; color: string | null }[] = [];
    floor.furniture.forEach((item, fi) => {
      const itemId = uniqueId(item.id ?? `${prefix}-${stairKeys.has(item.key) ? 'stair' : 'prop'}-${fi + 1}`);
      if (stairKeys.has(item.key)) { stairs.push(convertStair(item, itemId, index, levels, slab, origin, warnings)); return; }
      if (!item.w || !item.d || !item.h) warnings.push({ code: 'ASSUMED_PROP_SIZE', objectId: itemId, detail: `Prop ${item.key} lacks explicit w/d/h; 600 mm defaults used.` });
      props.push({ id: itemId, key: item.key, kind: fixedKeys.has(item.key) ? 'fixed' : 'furniture',
        position: { ...mmToPointXZ(item.at, origin), y: (item.z ?? 0) / 1000 }, yaw: clockwiseDegreesToYaw(item.rot ?? 0),
        size: { width: (item.w ?? 600) / 1000, depth: (item.d ?? 600) / 1000, height: (item.h ?? 600) / 1000 }, color: item.color ?? null });
    });
    return { levelId: level.id, name: floor.name, ...converted, rooms, slabOpenings, props };
  });
  // A void above a stair is its stairwell.
  for (const floor of floors) for (const opening of floor.slabOpenings) {
    if (opening.kind === 'void' && stairs.some(stair => stair.toLevelId === opening.levelId && pointInPolygon(stair.position, opening.outline)))
      opening.kind = 'stairwell';
  }
  const known = ['name', 'north', 'slab', 'base', 'floors', 'demo'];
  const unmapped = Object.keys(source).filter(k => !known.includes(k));
  if (unmapped.length) warnings.push({ code: 'UNMAPPED_SOURCE_FIELDS', detail: unmapped.join(', ') });
  return { schemaVersion: 'hestia.building-import-candidate.v1' as const, sourceId: config.sourceId, sourceFormat: config.sourceFormat,
    unit: 'm' as const, plane: 'xz' as const, sourceOriginMm: [...origin], scale: config.scaleEvidence,
    conceptOnly: config.scaleEvidence.status !== 'calibrated', confirmed: false as const, name: source.name ?? null,
    northClockwiseRadians: source.north === undefined ? null : finite.parse(source.north / 180 * Math.PI),
    levels, floors, stairs, warnings };
}
export type ImportedBuildingCandidate = ReturnType<typeof convertHouseSpecBuilding>;

function convertStair(item: z.infer<typeof furniture>, id: string, index: number, levels: Level[], slabMm: number,
  origin: readonly [number, number], warnings: ImportWarning[]): Stair {
  const opt = item.opt ?? {}, from = levels[index];
  if (item.z) throw new FloorplanImportError('UNSUPPORTED_STAIR', id, 'Only stairs starting on the storey floor (z = 0) are supported.');
  if (opt.winders !== undefined || opt.winder !== undefined || opt.flat) throw new FloorplanImportError('UNSUPPORTED_STAIR', id, 'Winders and composed platforms are not supported.');
  if (!item.w || !item.d) throw new FloorplanImportError('INCOMPLETE_STAIR', id, 'Stair needs explicit w and d.');
  let riseMm = item.h;
  if (riseMm === undefined) {
    riseMm = from.height * 1000 + slabMm;
    warnings.push({ code: 'ASSUMED_STAIR_RISE', objectId: id, detail: 'Stair rise defaults to storey height plus slab.' });
  }
  const to = levels.find(level => Math.abs(level.elevation - from.elevation - riseMm! / 1000) <= .01);
  if (!to || to === from) throw new FloorplanImportError('STAIR_ARRIVAL_LEVEL_MISSING', id, 'No storey floor at the top of this stair.');
  let steps = typeof opt.steps === 'number' && Number.isInteger(opt.steps) ? opt.steps : undefined;
  if (steps === undefined) {
    steps = Math.round(riseMm / 170);
    warnings.push({ code: 'ASSUMED_STAIR_STEPS', objectId: id, detail: `Riser count estimated from 170 mm risers: ${steps}.` });
  }
  const common = { id, fromLevelId: from.id, toLevelId: to.id, position: mmToPointXZ(item.at, origin), yaw: clockwiseDegreesToYaw(item.rot ?? 0),
    width: item.w / 1000, depth: item.d / 1000, rise: riseMm / 1000, steps };
  if (item.key === 'stairRun') return { ...common, kind: 'straight' };
  const run = typeof opt.run === 'number' ? opt.run : undefined, land = typeof opt.land === 'number' ? opt.land : undefined;
  if (!run || !land) throw new FloorplanImportError('INCOMPLETE_STAIR', id, 'U stair needs opt.run and opt.land.');
  return { ...common, kind: 'u', start: opt.start === 'left' ? 'left' : 'right', runWidth: run / 1000, landingDepth: land / 1000 };
}

const floorColors: Record<string, string> = {
  marble: '#e4ddd2', tile: '#d8d4cc', bath: '#cfd3d1', oak: '#c8a77f', walnut: '#8f6a4d', epoxy: '#a9adaa',
  cement: '#b5b1aa', paving: '#bdb3a4', deck: '#9c7b5c',
};
const propColors: [RegExp, string][] = [
  [/^(lawn|tree|shrub|bigPlant|plantShelf)$/, '#8d9b7a'], [/^pool$/, '#8fb3bd'], [/^(car|suv)$/, '#6f7378'],
  [/^(bed|sofa|lSofa|armchair|theaterSofa|lounge|sunLounger)/, '#b9aea1'], [/^(rug|curtain)$/, '#c9bba8'],
  [/^(toilet|vanity|shower|bathtub|sauna)$/, '#e8e6e1'], [/^elevator$/, '#9a9590'],
];
/**
 * Read-only preview scene of an import candidate, e.g. for demos and rendering checks. Does not confirm the import;
 * props keep their source key as name and stay demo ambience rather than planned furniture.
 */
export function buildingCandidateToScene(candidate: ImportedBuildingCandidate, label: string, synthetic: boolean): SceneSnapshot {
  return sceneSnapshotSchema.parse({
    version: 1, unit: 'm', plane: 'xz', label, synthetic, levels: candidate.levels,
    rooms: candidate.floors.flatMap(floor => floor.rooms.map(room => ({ id: room.id, levelId: room.levelId, outline: room.outline,
      ...(room.labels.length ? { name: room.labels.map(l => l.name).join(' · ') } : {}),
      floorColor: floorColors[room.labels.find(l => l.material)?.material ?? ''] ?? '#ddd5c8' }))),
    walls: candidate.floors.flatMap(floor => floor.walls.map(wall => ({ id: wall.id, levelId: floor.levelId, a: wall.a, b: wall.b,
      thickness: wall.thickness, height: wall.height,
      openings: wall.openings.map(o => ({ id: o.id, offset: o.offset, width: o.width, sill: o.sill, head: o.head })) }))),
    stairs: candidate.stairs, slabOpenings: candidate.floors.flatMap(floor => floor.slabOpenings),
    objects: candidate.floors.flatMap(floor => floor.props.map(prop => ({ id: prop.id, levelId: floor.levelId, kind: prop.kind, name: prop.key,
      position: prop.position, size: prop.size, yaw: prop.yaw,
      color: prop.color ?? propColors.find(([pattern]) => pattern.test(prop.key))?.[1] ?? '#c4b8a8' }))),
  });
}
