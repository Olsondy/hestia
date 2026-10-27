import { z } from 'zod';
import { idSchema, type ProjectView } from './project';

const revision = z.number().int().positive();
export const renderSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('current'), revision }).strict(),
  z.object({ kind: z.literal('candidate'), candidateId: idSchema, revision }).strict(),
]);
export const createRenderSchema = z.object({ operationId: idSchema, source: renderSourceSchema }).strict();
export type CreateRender = z.infer<typeof createRenderSchema>;
export type RenderSource = z.infer<typeof renderSourceSchema> & { projectRevision: number; fixedFactsId: string; fixedFactsRevision: number };
export type RenderView = {
  id: string; projectId: string; status: 'queued' | 'running' | 'retry_wait' | 'completed' | 'failed';
  source: RenderSource; snapshotHash: string; assetVersion: string; rendererVersion: string;
  synthetic: boolean; scale: ProjectView['scale']; concept: boolean; label: string; stale: boolean;
  currentProjectRevision: number; currentCandidateRevision: number | null;
  resourceId: string | null; contentHref: string | null; downloadHref: string | null;
  width: number | null; height: number | null; imageHash: string | null;
  error: { code: string; message: string } | null; createdAt: string; updatedAt: string;
};
