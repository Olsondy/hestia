import { z } from 'zod';
import { idSchema } from './project';

const objectId = z.string().min(1).max(120);
const coordinate = z.number().finite().min(-1000).max(1000);
// Stored scene poses may contain multiple turns; inverse commands must restore them exactly.
export const furniturePoseSchema = z.object({ x: coordinate, z: coordinate, yaw: z.number().finite() }).strict();
export const commandSchema = z.discriminatedUnion('type', [
  furniturePoseSchema.extend({ type: z.literal('move-furniture'), objectId, yaw: z.number().finite().min(-Math.PI * 2).max(Math.PI * 2) }).strict(),
  z.object({ type: z.literal('set-lock'), objectId, locked: z.boolean() }).strict(),
  z.object({ type: z.literal('undo'), targetOperationId: idSchema }).strict(),
]);
export const commandRequestSchema = z.object({ operationId: idSchema, expectedRevision: z.number().int().positive(), command: commandSchema }).strict();
export type FurniturePose = z.infer<typeof furniturePoseSchema>;
export type CommandRequest = z.infer<typeof commandRequestSchema>;
export type Command = z.infer<typeof commandSchema>;
export type OperationSummary = { id: string; type: Command['type']; objectId: string; revision: number; undoable: boolean; createdAt: string; targetOperationId?: string };
