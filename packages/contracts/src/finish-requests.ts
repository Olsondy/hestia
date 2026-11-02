import { z } from 'zod';
import { idSchema } from './project';
import type { Finish, SurfaceDesign, StoneSpec } from './finishes';
import type { RenderView } from './renders';

const stoneRef = z.object({ stoneId: z.string().min(1).max(120), stoneVersion: z.number().int().positive() }).strict();
/** Customer taste recorded with the request for the enterprise to follow up; rule generation does not read it. */
export const requestPreferencesSchema = z.object({
  tone: z.enum(['light', 'warm', 'dark', 'unsure']).optional(),
  patterns: z.array(z.enum(['straight', 'running-bond', 'herringbone', 'diagonal'])).max(4).optional(),
  border: z.enum(['yes', 'no', 'auto']).optional(),
}).strict();
export type RequestPreferences = z.infer<typeof requestPreferencesSchema>;
/** 方案需求. Demo villa: pick finishes and stones now. Drawing: upload next; finishes are derived after conversion. */
export const createFinishRequestSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('demo-villa'), operationId: idSchema, finishIds: z.array(z.string().min(1).max(120)).min(1).max(50),
    stones: z.array(stoneRef).min(1).max(3), note: z.string().trim().max(500).optional(), preferences: requestPreferencesSchema.optional() }).strict(),
  z.object({ source: z.literal('drawing'), operationId: idSchema, stones: z.array(stoneRef).min(1).max(3),
    note: z.string().trim().max(500).optional(), preferences: requestPreferencesSchema.optional() }).strict(),
]);
export const publishFinishRequestSchema = z.object({ operationId: idSchema }).strict();
export type FinishRequestStatus = 'awaiting_drawing' | 'converting' | 'assisted_conversion' | 'pending_review' | 'published';
export type FinishSchemeView = {
  id: string; ordinal: number; name: string; summary: string; revision: number; adoptable: boolean;
  issues: { code: string; objectId: string; message: string }[];
  surfaceDesign: SurfaceDesign;
  render: Pick<RenderView, 'id' | 'status' | 'width' | 'height' | 'error'> & { imageHref: string | null } | null;
};
/** Display data of one finish in a request: name, kind and owning level (for floor tabs). */
export type RequestFinishView = { id: string; name: string; kind: 'floor' | 'wall' | 'stair'; levelId: string | null; levelName: string | null };
export type FinishRequestView = {
  id: string; workspaceId: string; projectId: string; source: 'demo-villa' | 'drawing'; status: FinishRequestStatus;
  /** Project name; for drawings the uploaded file name once known. */
  title: string; origin: 'customer' | 'member'; drawingName: string | null;
  finishes: RequestFinishView[]; preferences: RequestPreferences | null;
  /** Customer-facing explanation of the state; never claims recognition for assisted drawings. */
  statusLabel: string;
  finishIds: string[]; stones: { stoneId: string; stoneVersion: number }[]; note: string | null;
  floorplanImportId: string | null;
  /** Published schemes only for customers; members also see schemes waiting for review. */
  schemes: FinishSchemeView[];
  /** Latest confirmation; `current` turns false once the confirmed scheme is adjusted again (needs re-confirming). */
  confirmation: { schemeId: string; revision: number; current: boolean; confirmedAt: string } | null;
  createdAt: string; updatedAt: string; publishedAt: string | null;
};
/** Plan outline of the demo villa for the finish picker (metres, plan x/z). */
export type DemoVillaPlanView = { levels: { id: string; name: string }[]; rooms: { id: string; name: string | null; levelId: string; outline: { x: number; z: number }[] }[];
  walls: { id: string; levelId: string; a: { x: number; z: number }; b: { x: number; z: number } }[];
  stairs: { id: string; levelId: string; outline: { x: number; z: number }[] }[] };
export type ClientCatalogView = { workspace: { slug: string; name: string }; stones: StoneSpec[]; demoVilla: { finishes: Finish[]; plan: DemoVillaPlanView } };
export type RequestEventView = { id: string; kind: 'confirmation' | 'message'; schemeId: string | null; schemeRevision: number | null;
  message: string | null; contactRequested: boolean; preferredTime: string | null; createdAt: string };
export type ShareView = { id: string; targetPhone: string | null; bindingCode: boolean; expiresAt: string | null; revokedAt: string | null; createdAt: string };
export type BindingApplicationView = { id: string; shareId: string; applicant: { userId: string; phone: string | null }; note: string | null; status: 'pending' | 'approved' | 'rejected' | 'superseded'; createdAt: string };
export type BindingEventView = { kind: string; method: string | null; actorId: string; subjectId: string | null; createdAt: string };
export type LeadView = FinishRequestView & { origin: 'customer' | 'member'; customer: { userId: string; phone: string | null; name: string | null } | null;
  reviewReason: string | null; events: RequestEventView[];
  sharing: { shares: ShareView[]; applications: BindingApplicationView[]; history: BindingEventView[] } };
export const createMemberRequestSchema = z.object({ operationId: idSchema, name: z.string().trim().min(1).max(100),
  finishIds: z.array(z.string().min(1).max(120)).min(1).max(50), stones: z.array(stoneRef).min(1).max(3), note: z.string().trim().max(500).optional() }).strict();
/** Targeted share (phone) or, without a phone, a one-time binding code told to the customer separately. */
export const createShareSchema = z.object({ operationId: idSchema, phone: z.string().trim().min(5).max(20).optional(),
  expiresInDays: z.number().int().min(1).max(90).default(30) }).strict();
export const memberOperationSchema = z.object({ operationId: idSchema }).strict();
export const decideApplicationSchema = z.object({ operationId: idSchema, decision: z.enum(['approve', 'reject']) }).strict();
export const bindShareSchema = z.object({ operationId: idSchema, code: z.string().trim().min(4).max(12).optional() }).strict();
export const applyBindingSchema = z.object({ operationId: idSchema, note: z.string().trim().max(200).optional() }).strict();
export type CreatedShareView = { share: ShareView; url: string | null; token: string | null; bindingCode: string | null; note: string };
/** `viewer` is present when the visitor is signed in: whether the request is theirs and whether they applied. */
export type SharePreviewView = { workspace: { slug: string; name: string }; request: FinishRequestView; bound: boolean; binding: 'phone' | 'code';
  viewer: { boundToMe: boolean; application: 'pending' | 'rejected' | null } | null };

const tileSize = z.object({ length: z.number().finite().positive().max(4), width: z.number().finite().positive().max(4) }).strict();
/** One option-based change to one finish of a scheme. Omitted fields keep their current value. */
export const adjustSchemeSchema = z.object({
  operationId: idSchema, expectedRevision: z.number().int().positive(), finishId: z.string().min(1).max(120),
  stone: stoneRef.optional(), tile: tileSize.optional(),
  pattern: z.enum(['straight', 'running-bond', 'herringbone', 'diagonal']).optional(), border: z.boolean().optional(),
}).strict().refine(value => value.stone || value.tile || value.pattern || value.border !== undefined, { message: 'No change requested' });
export const undoSchemeSchema = z.object({ operationId: idSchema, expectedRevision: z.number().int().positive() }).strict();
export const confirmSchemeSchema = z.object({ operationId: idSchema, schemeId: idSchema, revision: z.number().int().positive(),
  message: z.string().trim().max(500).optional(), contactRequested: z.boolean().optional(), preferredTime: z.string().trim().max(40).optional() }).strict();
export const requestMessageSchema = z.object({ operationId: idSchema, message: z.string().trim().max(500).optional(),
  contactRequested: z.boolean(), preferredTime: z.string().trim().max(40).optional() }).strict()
  .refine(value => value.contactRequested || !!value.message, { message: 'Empty message' });
export type SchemeOptionsView = { schemeId: string; revision: number; finishes: { finishId: string; name: string; kind: 'floor' | 'wall' | 'stair';
  current: { stoneId: string; stoneVersion: number; tile: { length: number; width: number }; pattern: string; border: boolean } | null;
  stones: { stoneId: string; stoneVersion: number; name: string; sizes: { length: number; width: number }[] }[];
  patterns: string[]; border: boolean }[] };
