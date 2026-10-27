import { z } from 'zod';
import { sceneSnapshotSchema, type SceneSnapshot } from './scene';
import { visualStyleSchema } from './styles';

export const idSchema = z.string().uuid();
export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  template: z.enum(['empty', 'courtyard', 'angled']), operationId: idSchema,
}).strict();
export const renameProjectSchema = z.object({
  name: z.string().trim().min(1).max(120), expectedRevision: z.number().int().positive(), operationId: idSchema,
}).strict();
export const openingClearanceSchema = z.discriminatedUnion('kind', [
  z.object({ openingId: z.string().min(1).max(120), kind: z.literal('none') }).strict(),
  z.object({ openingId: z.string().min(1).max(120), kind: z.literal('swing'), hinge: z.enum(['start', 'end']),
    side: z.union([z.literal(1), z.literal(-1)]), angle: z.number().finite().positive().max(Math.PI) }).strict(),
]);
export type OpeningClearance = z.infer<typeof openingClearanceSchema>;
// Geometry uses metres, x/z on the floor and y up; angles are radians about +y.
// Fixed facts and movable furniture have independent revisions and never share ownership.
export const spatialStateSchema = z.object({
  version: z.literal(1), synthetic: z.boolean(),
  visualStyle: visualStyleSchema.optional(),
  scale: z.enum(['missing', 'estimated', 'calibrated', 'synthetic']),
  fixedFacts: z.object({
    id: idSchema, revision: z.number().int().positive(),
    rooms: sceneSnapshotSchema.shape.rooms, walls: sceneSnapshotSchema.shape.walls,
    objects: sceneSnapshotSchema.shape.objects,
    openingClearances: z.array(openingClearanceSchema).max(1000).default([]),
  }).strict(),
  currentLayout: z.object({
    id: idSchema, revision: z.number().int().positive(), fixedFactsId: idSchema,
    fixedFactsRevision: z.number().int().positive(), objects: sceneSnapshotSchema.shape.objects,
    lockedObjectIds: z.array(z.string().min(1).max(120)).max(1000).default([]),
  }).strict(),
}).strict().superRefine((s, ctx) => {
  if (s.scale === 'synthetic' && !s.synthetic) ctx.addIssue({ code: 'custom', message: 'Synthetic scale must remain explicitly labelled synthetic' });
  if (s.fixedFacts.objects.some(o => o.kind !== 'fixed') || s.currentLayout.objects.some(o => o.kind !== 'furniture')) {
    ctx.addIssue({ code: 'custom', message: 'Fixed facts and furniture must be separate' });
  }
  if (s.currentLayout.fixedFactsId !== s.fixedFacts.id || s.currentLayout.fixedFactsRevision !== s.fixedFacts.revision) {
    ctx.addIssue({ code: 'custom', message: 'Layout references a different fixed facts revision' });
  }
  const furnitureIds = new Set(s.currentLayout.objects.map(o => o.id));
  if (new Set(s.currentLayout.lockedObjectIds).size !== s.currentLayout.lockedObjectIds.length || s.currentLayout.lockedObjectIds.some(id => !furnitureIds.has(id)))
    ctx.addIssue({ code: 'custom', message: 'Locks must uniquely reference movable furniture' });
  const openingIds = new Set(s.fixedFacts.walls.flatMap(w => w.openings.filter(o => o.sill <= .001).map(o => o.id)));
  if (new Set(s.fixedFacts.openingClearances.map(o => o.openingId)).size !== s.fixedFacts.openingClearances.length || s.fixedFacts.openingClearances.some(o => !openingIds.has(o.openingId)))
    ctx.addIssue({ code: 'custom', message: 'Clearances must uniquely reference existing floor-level openings' });
});
export type SpatialState = z.infer<typeof spatialStateSchema>;
export const candidateReferenceSchema = z.object({
  id: idSchema, projectId: idSchema, revision: z.number().int().positive(),
  baseRevision: z.number().int().positive(), fixedFactsId: idSchema,
  fixedFactsRevision: z.number().int().positive(), status: z.enum(['draft', 'checked', 'adopted', 'superseded']),
}).strict();
export const resourceReferenceSchema = z.object({
  id: idSchema, projectId: idSchema, mediaType: z.string(), state: z.enum(['pending', 'ready', 'failed']),
}).strict();
export type ResourceReference = z.infer<typeof resourceReferenceSchema>;
export type ProjectSummary = { id: string; name: string; revision: number; synthetic: boolean; updatedAt: string };
export type ProjectView = ProjectSummary & {
  scene: SceneSnapshot; scale: SpatialState['scale'];
  fixedFacts: { id: string; revision: number }; currentLayout: { id: string; revision: number };
  resources: ResourceReference[];
  lockedObjectIds: string[];
};
export class DomainError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) { super(message); }
}
