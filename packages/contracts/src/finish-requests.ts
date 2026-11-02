import { z } from 'zod';
import { idSchema } from './project';
import type { Finish, SurfaceDesign, StoneSpec } from './finishes';
import type { RenderView } from './renders';

const stoneRef = z.object({ stoneId: z.string().min(1).max(120), stoneVersion: z.number().int().positive() }).strict();
/** 方案需求. Demo villa: pick finishes and stones now. Drawing: upload next; finishes are derived after conversion. */
export const createFinishRequestSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('demo-villa'), operationId: idSchema, finishIds: z.array(z.string().min(1).max(120)).min(1).max(50),
    stones: z.array(stoneRef).min(1).max(3), note: z.string().trim().max(500).optional() }).strict(),
  z.object({ source: z.literal('drawing'), operationId: idSchema, stones: z.array(stoneRef).min(1).max(3),
    note: z.string().trim().max(500).optional() }).strict(),
]);
export const publishFinishRequestSchema = z.object({ operationId: idSchema }).strict();
export type FinishRequestStatus = 'awaiting_drawing' | 'converting' | 'assisted_conversion' | 'pending_review' | 'published';
export type FinishSchemeView = {
  id: string; ordinal: number; name: string; summary: string; revision: number; adoptable: boolean;
  issues: { code: string; objectId: string; message: string }[];
  surfaceDesign: SurfaceDesign;
  render: Pick<RenderView, 'id' | 'status' | 'width' | 'height' | 'error'> & { imageHref: string | null } | null;
};
export type FinishRequestView = {
  id: string; workspaceId: string; projectId: string; source: 'demo-villa' | 'drawing'; status: FinishRequestStatus;
  /** Customer-facing explanation of the state; never claims recognition for assisted drawings. */
  statusLabel: string;
  finishIds: string[]; stones: { stoneId: string; stoneVersion: number }[]; note: string | null;
  floorplanImportId: string | null;
  /** Published schemes only for customers; members also see schemes waiting for review. */
  schemes: FinishSchemeView[];
  createdAt: string; updatedAt: string; publishedAt: string | null;
};
export type ClientCatalogView = { workspace: { slug: string; name: string }; stones: StoneSpec[]; demoVilla: { finishes: Finish[] } };
export type LeadView = FinishRequestView & { customer: { userId: string; phone: string | null; name: string | null }; reviewReason: string | null };
