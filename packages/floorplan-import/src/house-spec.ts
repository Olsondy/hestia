import { z } from 'zod';

const finite = z.number().finite();
const point = z.tuple([finite, finite]);
const opening = z.object({
  id: z.string().min(1).optional(), type: z.string().min(1),
  from: finite, to: finite, sill: finite.nonnegative().optional(), head: finite.positive().optional(),
  hinge: z.enum(['from', 'to']).optional(), into: point.optional(),
}).passthrough();
const wall = z.object({
  id: z.string().min(1).optional(), a: point, b: point, t: finite.positive(),
  bearing: z.boolean().optional(), flush: z.enum(['N', 'S', 'E', 'W', 'C']).optional(),
  openings: z.array(opening).max(100).default([]),
}).passthrough();
const sourceSchema = z.object({
  name: z.string().max(200).optional(), height: finite.positive(), north: finite.optional(),
  walls: z.array(wall).min(1).max(1000),
  rooms: z.array(z.object({ id: z.string().optional(), at: point, name: z.string().max(100) }).passthrough()).max(300).default([]),
  structs: z.array(z.object({ id: z.string().optional(), kind: z.string().min(1), at: point,
    w: finite.positive().optional(), d: finite.positive().optional(), rot: finite.optional() }).passthrough()).max(500).default([]),
}).passthrough();

export type PointXZ = { x: number; z: number };
export type ScaleEvidence =
  | { status: 'missing' | 'estimated'; evidenceId?: string }
  | { status: 'calibrated'; evidenceId: string; verifiedBy: 'user' | 'reviewed-drawing' }
  | { status: 'conflicted'; evidenceId: string };
export type ImportOptions = {
  sourceId: string;
  /** External format explicitly states millimetres; do not infer it from numbers. */
  sourceFormat: 'housespec-mm-v1';
  originMm?: readonly [number, number];
  /** Trusted application evidence; NEVER populated from model output fields. */
  scaleEvidence: ScaleEvidence;
};

const evidenceSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('missing'), evidenceId: z.string().min(1).optional() }).strict(),
  z.object({ status: z.literal('estimated'), evidenceId: z.string().min(1).optional() }).strict(),
  z.object({ status: z.literal('calibrated'), evidenceId: z.string().min(1), verifiedBy: z.enum(['user', 'reviewed-drawing']) }).strict(),
  z.object({ status: z.literal('conflicted'), evidenceId: z.string().min(1) }).strict(),
]);
const optionsSchema = z.object({
  sourceId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), sourceFormat: z.literal('housespec-mm-v1'),
  originMm: point.optional(), scaleEvidence: evidenceSchema,
}).strict();

export class FloorplanImportError extends Error {
  constructor(public code: string, public objectId: string, message: string) { super(message); }
}

/** HouseSpec diagram coordinates: x right, y down. Hestia plane: x right, z down. */
export function mmToPointXZ(p: readonly [number, number], origin: readonly [number, number] = [0, 0]): PointXZ {
  point.parse(p); point.parse(origin);
  return { x: finite.parse((p[0] - origin[0]) / 1000), z: finite.parse((p[1] - origin[1]) / 1000) };
}
export function pointXZToMm(p: PointXZ, origin: readonly [number, number] = [0, 0]): [number, number] {
  finite.parse(p.x); finite.parse(p.z); point.parse(origin);
  return [finite.parse(p.x * 1000 + origin[0]), finite.parse(p.z * 1000 + origin[1])];
}
export function clockwiseDegreesToYaw(degrees: number): number { return finite.parse(-finite.parse(degrees) / 180 * Math.PI); }

export function convertHouseSpec(input: unknown, options: ImportOptions) {
  const config = optionsSchema.parse(options);
  const source = sourceSchema.parse(input);
  const origin = config.originMm ?? [0, 0] as const;
  const ids = new Set<string>();
  const uniqueId = (value: string) => {
    if (ids.has(value)) throw new FloorplanImportError('DUPLICATE_ID', value, 'Object IDs must be unique.');
    ids.add(value); return value;
  };
  const warnings: { code: string; objectId?: string; detail: string }[] = [];
  const walls = source.walls.map((w, wi) => {
    const id = uniqueId(w.id ?? `${config.sourceId}-wall-${wi + 1}`);
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length < 0.5) throw new FloorplanImportError('DEGENERATE_WALL', id, 'Wall centreline must have a finite positive length.');
    if (w.flush && w.flush !== 'C') throw new FloorplanImportError('UNSUPPORTED_FLUSH', id, 'Non-centred flush requires explicit geometry reconciliation.');
    const heights: Record<string, readonly [number, number]> = {
      window: [900, 2400], slideWindow: [900, 2400], floorWindow: [0, 2500], highWindow: [1500, 2100],
      bay: [450, 2400], glassWall: [0, 2600], sliding: [0, 2400], folding: [0, 2400], garage: [0, 2400],
    };
    const validTypes = new Set(['door', 'double', 'unequal', 'sliding', 'folding', 'pocket', 'hole', 'garage', 'window', 'slideWindow', 'floorWindow', 'highWindow', 'bay', 'glassWall']);
    const openings = w.openings.map((o, oi) => {
      const openingId = uniqueId(o.id ?? `${id}-opening-${oi + 1}`);
      if (!validTypes.has(o.type)) throw new FloorplanImportError('UNSUPPORTED_OPENING', openingId, 'Unknown opening type.');
      // Axis-aligned HouseSpec uses absolute coordinates regardless of wall direction.
      // Diagonal openings already use distance measured from endpoint a.
      const offsetFor = (value: number) => dy === 0 ? (value - w.a[0]) * Math.sign(dx)
        : dx === 0 ? (value - w.a[1]) * Math.sign(dy) : value;
      const p = offsetFor(o.from), q = offsetFor(o.to), start = Math.min(p, q), end = Math.max(p, q);
      if (start < 0 || end > length || end <= start) throw new FloorplanImportError('OPENING_OUT_OF_BOUNDS', openingId, 'Opening must fit its owning wall.');
      const defaults = heights[o.type] ?? [0, 2100];
      const sill = o.sill ?? defaults[0];
      const head = o.head ?? defaults[1];
      if (head <= sill || head > source.height) throw new FloorplanImportError('INVALID_OPENING_HEIGHT', openingId, 'Opening vertical interval must fit wall height.');
      if (o.sill === undefined || o.head === undefined) warnings.push({ code: 'ASSUMED_OPENING_HEIGHT', objectId: openingId, detail: 'Opening height defaults are unconfirmed assumptions.' });
      return { id: openingId, wallId: id, sourceType: o.type, offset: start / 1000, width: (end - start) / 1000,
        sill: sill / 1000, head: head / 1000, hinge: o.hinge ? ((o.hinge === 'from' ? p : q) === start ? 'start' : 'end') : null,
        openingSidePoint: o.into ? mmToPointXZ(o.into, origin) : null, confirmed: false as const };
    });
    const sorted = [...openings].sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].offset < sorted[i - 1].offset + sorted[i - 1].width - 1e-9)
        throw new FloorplanImportError('OVERLAPPING_OPENINGS', sorted[i].id, 'Opening intervals overlap.');
    }
    return { id, a: mmToPointXZ(w.a, origin), b: mmToPointXZ(w.b, origin), thickness: w.t / 1000,
      height: source.height / 1000, openings, bearingHypothesis: w.bearing ?? null, confirmed: false as const };
  });
  const roomLabels = source.rooms.map((r, i) => ({ id: uniqueId(r.id ?? `${config.sourceId}-label-${i + 1}`),
    position: mmToPointXZ(r.at, origin), name: r.name, confirmed: false as const }));
  const fixedObjectCandidates = source.structs.map((s, i) => ({ id: uniqueId(s.id ?? `${config.sourceId}-fixed-${i + 1}`),
    kind: s.kind, position: mmToPointXZ(s.at, origin), width: s.w === undefined ? null : s.w / 1000,
    depth: s.d === undefined ? null : s.d / 1000, yaw: clockwiseDegreesToYaw(s.rot ?? 0), confirmed: false as const }));
  const unmappedFields = Object.keys(source).filter(k => !['name', 'height', 'north', 'walls', 'rooms', 'structs'].includes(k));
  if (unmappedFields.length) warnings.push({ code: 'UNMAPPED_SOURCE_FIELDS', detail: unmappedFields.join(', ') });
  warnings.push({ code: 'TOPOLOGY_NOT_CHECKED', detail: 'Room labels are not closed-room polygons; wall intersection and enclosure checks remain required.' });
  return { schemaVersion: 'hestia.import-candidate.v1' as const, sourceId: config.sourceId, sourceFormat: config.sourceFormat,
    unit: 'm' as const, plane: 'xz' as const, sourceOriginMm: [...origin], scale: config.scaleEvidence,
    conceptOnly: config.scaleEvidence.status !== 'calibrated', confirmed: false as const,
    northClockwiseRadians: source.north === undefined ? null : finite.parse(source.north / 180 * Math.PI),
    walls, roomLabels, fixedObjectCandidates, warnings };
}

export type ImportedFloorplanCandidate = ReturnType<typeof convertHouseSpec>;
