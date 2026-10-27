import { z } from 'zod';
import { idSchema, type ProjectView } from './project';
import { furniturePoseSchema, type FurniturePose } from './commands';
import type { SceneSnapshot } from './scene';
import { catalogSizeSchema, catalogReferenceSchema } from './catalog';
import { styleCommandSchema, type VisualStyle, type StyleChange, type ChangeKind } from './styles';

const revision = z.number().int().positive();
const operation = { operationId: idSchema };
export const createCandidateSchema = z.object({ ...operation, expectedRevision: revision, name: z.string().trim().min(1).max(120) }).strict();
const objectId = z.string().min(1).max(120);
const newPose = furniturePoseSchema.extend({ yaw: z.number().finite().min(-Math.PI * 2).max(Math.PI * 2) });
export const candidateCommandSchema = z.discriminatedUnion('type', [
  ...styleCommandSchema.options,
  newPose.extend({ type: z.literal('move-furniture'), objectId }).strict(),
  newPose.extend({ type: z.literal('add-furniture'), ...catalogReferenceSchema.shape, size: catalogSizeSchema }).strict(),
  z.object({ type: z.literal('replace-furniture'), objectId, ...catalogReferenceSchema.shape, size: catalogSizeSchema }).strict(),
  z.object({ type: z.literal('remove-furniture'), objectId }).strict(),
]);
export type CandidateCommand = z.infer<typeof candidateCommandSchema>;
export const editCandidateSchema = z.object({ ...operation, expectedCandidateRevision: revision, command: candidateCommandSchema }).strict();
export const checkCandidateSchema = z.object({ ...operation, expectedCandidateRevision: revision }).strict();
export const presentCandidateSchema = z.object({ ...operation, expectedCandidateRevision: revision, expectedRevision: revision, checkId: idSchema }).strict();
export const selectCandidateSchema = z.object({ ...operation, presentationId: idSchema }).strict();
export const adoptCandidateSchema = z.object({ ...operation, expectedRevision: revision, selectionId: idSchema }).strict();
export const undoAdoptionSchema = z.object({ ...operation, expectedRevision: revision }).strict();

export type CandidateCheckItem = { objectId?: string; code: string; status: 'passed' | 'failed' | 'not-applicable' | 'not-checked'; required: boolean };
export type CandidateIssue = { code: string; objectId?: string; relatedObjectId?: string; message: string };
export type CandidateCheck = {
  id: string; candidateId: string; candidateRevision: number; baseRevision: number; contentHash: string;
  checkerVersion: string; adoptable: boolean; checks: CandidateCheckItem[]; issues: CandidateIssue[]; createdAt: string;
};
export type CandidateSummary = {
  id: string; projectId: string; name: string; revision: number; baseRevision: number;
  fixedFactsId: string; fixedFactsRevision: number; status: 'draft' | 'checked' | 'adopted';
  stale: boolean; changedObjectIds: string[]; createdAt: string; updatedAt: string;
  changeKind: ChangeKind;
};
export type CandidateView = CandidateSummary & {
  visualStyle: VisualStyle; styleChanges: StyleChange[];
  scene: SceneSnapshot; lockedObjectIds: string[]; synthetic: boolean; scale: ProjectView['scale'];
  differences: { objectId: string; before: FurniturePose; after: FurniturePose }[];
  objectChanges: { objectId: string; kind: 'added' | 'removed' | 'replaced' | 'moved'; before: SceneSnapshot['objects'][number] | null; after: SceneSnapshot['objects'][number] | null }[];
  check: CandidateCheck | null;
};
export type CandidatePresentation = { id: string; candidateId: string; candidateRevision: number; baseRevision: number; checkId: string; createdAt: string };
export type CandidateSelection = { id: string; presentationId: string; candidateId: string; candidateRevision: number; baseRevision: number; createdAt: string };
export type AdoptionSummary = { operationId: string; candidateId: string; candidateRevision: number; revision: number; undoable: boolean; undoneBy: string | null };
export type CandidateList = { candidates: CandidateSummary[]; undoableAdoption: { operationId: string; revision: number } | null };
export type AdoptionResult = { project: ProjectView; adoption: AdoptionSummary; undoableAdoption: { operationId: string; revision: number } | null };
