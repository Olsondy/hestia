import { z } from 'zod';
import { catalogReferenceSchema } from './catalog';
import { visualStyleSchema } from './styles';
import { checkBuilding, levelSchema, slabOpeningSchema, stairSchema, type BuildingIssue } from './building';

const coordinate = z.number().finite().min(-1000).max(1000);
const length = z.number().finite().positive().max(1000);
const point = z.object({ x: coordinate, z: coordinate }).strict();
const id = z.string().min(1).max(120);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const opening = z.object({ id, offset: z.number().nonnegative(), width: length,
  sill: z.number().nonnegative(), head: length }).strict();
/** Absent levelId means the base (first) level; single-storey data never needs it. */
const levelId = id.optional();
const wall = z.object({ id, levelId, a: point, b: point, thickness: length, height: length,
  openings: z.array(opening).max(100).default([]) }).strict();
export const roomSchema = z.object({ id, levelId, name: z.string().min(1).max(100).optional(),
  outline: z.array(point).min(3).max(200), floorColor: color }).strict();
export const sceneSnapshotSchema = z.object({
  version: z.literal(1), unit: z.literal('m'), plane: z.literal('xz'),
  label: z.string().min(1).max(200), synthetic: z.boolean(),
  visualStyle: visualStyleSchema.optional(),
  /** Optional storeys, bottom to top. Omitted for single-storey scenes. */
  levels: z.array(levelSchema).min(1).max(20).optional(),
  rooms: z.array(roomSchema).max(100),
  walls: z.array(wall).max(1000),
  stairs: z.array(stairSchema).max(50).optional(),
  slabOpenings: z.array(slabOpeningSchema).max(200).optional(),
  objects: z.array(z.object({ id, levelId, kind: z.enum(['furniture', 'fixed']),
    position: z.object({ x: coordinate, y: coordinate, z: coordinate }).strict(),
    size: z.object({ width: length, height: length, depth: length }).strict(),
    yaw: z.number().finite(), color,
    name: z.string().min(1).max(120).optional(), catalog: catalogReferenceSchema.optional(),
    dimensionSource: z.enum(['unknown', 'measured', 'catalog']).optional(),
  }).strict()).max(1000),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  const all = [...value.levels ?? [], ...value.rooms, ...value.walls, ...value.objects, ...value.walls.flatMap(w => w.openings),
    ...value.stairs ?? [], ...value.slabOpenings ?? []];
  for (const entry of all) {
    if (ids.has(entry.id)) ctx.addIssue({ code: 'custom', message: `Duplicate scene ID: ${entry.id}` });
    ids.add(entry.id);
  }
  for (const override of value.visualStyle?.materials ?? []) {
    if (!value.objects.some(object => object.id === override.objectId && object.kind === 'furniture'))
      ctx.addIssue({ code: 'custom', message: `Style target must be movable furniture: ${override.objectId}` });
  }
  for (const w of value.walls) {
    const span = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
    if (span < .001) ctx.addIssue({ code: 'custom', message: `Degenerate wall: ${w.id}` });
    let end = 0;
    for (const o of [...w.openings].sort((a, b) => a.offset - b.offset)) {
      if (o.offset < end || o.offset + o.width > span + 1e-7 || o.sill >= o.head || o.head > w.height) {
        ctx.addIssue({ code: 'custom', message: `Invalid opening: ${o.id}` });
      }
      end = o.offset + o.width;
    }
  }
  addBuildingIssues(ctx, checkBuilding(value));
});

/** Structured building issues surface as custom Zod issues carrying `params.code` and `params.objectId`. */
export function addBuildingIssues(ctx: z.RefinementCtx, issues: BuildingIssue[]) {
  for (const issue of issues) ctx.addIssue({ code: 'custom', message: `${issue.code} ${issue.objectId}: ${issue.message}`,
    params: { code: issue.code, objectId: issue.objectId, ...(issue.levelId ? { levelId: issue.levelId } : {}) } });
}

/** Rendering input only: approval, scale evidence and ownership remain in the domain. */
export type SceneSnapshot = z.infer<typeof sceneSnapshotSchema>;
