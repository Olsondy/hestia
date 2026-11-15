import { z } from 'zod';
import { idSchema } from './project';
import { tilePatternSchema, type SurfaceDesign } from './finishes';
import type { FinishSchemeView, SoftStyleSummary } from './finish-requests';

// K03 (ADR-0019): the enterprise Agent proposes a whole scheme (tiling + soft style) for a lead's space. The model names
// catalog entries only by id; the application resolves active versions, embeds them, checks and stores a candidate.

const catalogId = z.string().min(1).max(120);
/** Tile sizes in millimetres, as the catalogue shows them; the application converts to metres. */
const millimetres = z.number().int().min(50).max(4000);
export const schemeTilingProposalSchema = z.object({
  finishIds: z.array(catalogId).min(1).max(60),
  stoneId: catalogId,
  tile: z.object({ lengthMm: millimetres, widthMm: millimetres }).strict(),
  pattern: tilePatternSchema,
  border: z.object({ stoneId: catalogId, widthMm: z.number().int().min(30).max(600) }).strict().optional(),
}).strict();
export const schemeDecisionSchema = z.object({
  kind: z.literal('propose_scheme'),
  name: z.string().trim().min(1).max(20),
  summary: z.string().trim().min(1).max(120),
  tilings: z.array(schemeTilingProposalSchema).min(1).max(12),
  softStyleId: catalogId,
  /** Styles the customer may switch between (the chosen one is always included); at most 3 in all. */
  softChoices: z.array(catalogId).max(3).default([]),
}).strict();
export type SchemeDecision = z.infer<typeof schemeDecisionSchema>;

export type SchemeCandidateIssue = { code: string; objectId?: string; message: string; severity: 'conflict' | 'hint' };
export type SchemeCandidateView = {
  id: string; requestId: string; taskId: string; baseRevision: number; stale: boolean;
  name: string; summary: string; status: 'draft' | 'adopted'; adoptedSchemeId: string | null;
  surfaceDesign: SurfaceDesign; issues: SchemeCandidateIssue[];
  softStyle: SoftStyleSummary | null; softChoices: SoftStyleSummary[];
  render: FinishSchemeView['render']; createdAt: string;
};
export const adoptSchemeCandidateSchema = z.object({ operationId: idSchema }).strict();
export const publishSchemeSchema = z.object({ operationId: idSchema }).strict();
