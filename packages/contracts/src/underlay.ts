import { z } from 'zod';
import { idSchema } from './project';

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 16_000_000;
export const underlayDisplaySchema = z.object({
  offsetX: z.number().finite().min(-100000).max(100000), offsetY: z.number().finite().min(-100000).max(100000),
  scale: z.number().finite().min(.05).max(20), opacity: z.number().finite().min(.1).max(1),
}).strict();
export const underlaySourceSchema = z.object({
  name: z.string().min(1).max(255), kind: z.enum(['image', 'pdf']), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  page: z.number().int().min(1).max(200), pageCount: z.number().int().min(1).max(200),
  width: z.number().int().min(1).max(10000), height: z.number().int().min(1).max(10000),
  coordinateSystem: z.literal('rendered-page-pixels'),
  pdfViewportTransform: z.tuple([z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite()]).nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.page > value.pageCount || (value.kind === 'image' && (value.page !== 1 || value.pageCount !== 1 || value.pdfViewportTransform !== null)) || (value.kind === 'pdf' && value.pdfViewportTransform === null)) ctx.addIssue({ code: 'custom', message: 'Invalid source page provenance' });
});
export const cropSchema = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive() }).strict();
export const saveUnderlaySchema = z.object({
  operationId: idSchema, expectedVersion: z.number().int().nonnegative(), source: underlaySourceSchema,
  crop: cropSchema, rotation: z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)]), display: underlayDisplaySchema,
}).strict().superRefine((v, ctx) => {
  if (v.crop.x + v.crop.width > v.source.width || v.crop.y + v.crop.height > v.source.height || v.crop.width * v.crop.height > MAX_IMAGE_PIXELS) ctx.addIssue({ code: 'custom', message: 'Crop is outside the source page or exceeds the pixel limit' });
});
export const updateUnderlaySchema = z.object({ operationId: idSchema, expectedVersion: z.number().int().positive(), resourceId: idSchema, display: underlayDisplaySchema }).strict();
export type UnderlaySource = z.infer<typeof underlaySourceSchema>;
export type Crop = z.infer<typeof cropSchema>;
export type UnderlayDisplay = z.infer<typeof underlayDisplaySchema>;
export type SaveUnderlay = z.infer<typeof saveUnderlaySchema>;
export type UnderlayView = { projectId: string; resourceId: string; version: number; width: number; height: number; source: UnderlaySource; crop: Crop; rotation: 0|90|180|270; sourceToImage: number[]; display: UnderlayDisplay; calibration: 'uncalibrated'; registration: 'unregistered'; updatedAt: string };
/** Crop coordinates precede clockwise rotation, in the chosen page's rendered pixels. */
export function sourceToImage(c: Crop, rotation: SaveUnderlay['rotation']): number[] {
  if (rotation === 90) return [0,1,-1,0,c.height+c.y,0-c.x];
  if (rotation === 180) return [-1,0,0,-1,c.width+c.x,c.height+c.y];
  if (rotation === 270) return [0,-1,1,0,0-c.y,c.width+c.x];
  return [1,0,0,1,0-c.x,0-c.y];
}
