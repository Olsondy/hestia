import { z } from 'zod';
import type { CatalogMaterial } from './catalog';
import type { ProjectView } from './project';

const name = z.string().min(1).max(120), revision = z.number().int().positive();
export const materialOverrideSchema = z.object({ objectId: name, materialId: name, materialVersion: revision }).strict();
export const displayLightingSchema = z.object({ presetId: name, presetVersion: revision }).strict();
export const visualStyleSchema = z.object({
  version: z.literal(1), materials: z.array(materialOverrideSchema).max(1000), lighting: displayLightingSchema,
}).strict().superRefine((value, ctx) => {
  if (new Set(value.materials.map(item => item.objectId)).size !== value.materials.length)
    ctx.addIssue({ code: 'custom', message: 'Material overrides must have unique object IDs' });
});
export type VisualStyle = z.infer<typeof visualStyleSchema>;
export type MaterialOverride = z.infer<typeof materialOverrideSchema>;
export const defaultVisualStyle = (): VisualStyle => ({ version: 1, materials: [], lighting: { presetId: 'display-warm', presetVersion: 1 } });
export const styleCommandSchema = z.discriminatedUnion('type', [
  materialOverrideSchema.extend({ type: z.literal('set-material') }).strict(),
  z.object({ type: z.literal('reset-material'), objectId: name }).strict(),
  displayLightingSchema.extend({ type: z.literal('set-display-lighting') }).strict(),
]);
export type StyleCommand = z.infer<typeof styleCommandSchema>;
export const applyStyleSchema = z.object({ operationId: z.string().uuid(), expectedRevision: revision, command: styleCommandSchema }).strict();
export const undoStyleSchema = z.object({ operationId: z.string().uuid(), expectedRevision: revision }).strict();
export type StyleChange =
  | { kind: 'material'; objectId: string; before: MaterialOverride | null; after: MaterialOverride | null }
  | { kind: 'lighting'; before: VisualStyle['lighting']; after: VisualStyle['lighting'] };
export type ChangeKind = 'none' | 'layout' | 'style' | 'mixed';
export type DisplayLightPreset = {
  id: string; version: number; name: string; description: string;
  hemisphere: { sky: string; ground: string; intensity: number };
  directional: { color: string; intensity: number; position: [number, number, number] }; exposure: number;
};
export type StyleCatalog = { version: 1; materials: CatalogMaterial[]; lighting: DisplayLightPreset[] };
export type StyleState = { projectRevision: number; visualStyle: VisualStyle; undoableCommand: { operationId: string; revision: number } | null };
export type StyleResult = StyleState & { project: ProjectView; operationId: string };
