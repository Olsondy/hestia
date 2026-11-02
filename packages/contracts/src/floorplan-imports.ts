import { z } from 'zod';
import { idSchema } from './project';

/** Uploaded drawing size cap, enforced on the streamed bytes before parsing. */
export const MAX_FLOORPLAN_BYTES = 16 * 1024 * 1024;
/** Member-imported HouseSpec JSON body cap (the demo villa is ~20 KB). */
export const MAX_HOUSESPEC_BYTES = 1024 * 1024;

/**
 * Accepted extensions. Only DXF is converted automatically; everything else is stored and waits for a member to
 * provide a HouseSpec ("辅助转换"). Stored media types come from this table, never from the client.
 */
export const floorplanFormats = {
  dxf: { mediaType: 'image/vnd.dxf', automatic: true },
  dwg: { mediaType: 'image/vnd.dwg', automatic: false },
  pdf: { mediaType: 'application/pdf', automatic: false },
  png: { mediaType: 'image/png', automatic: false },
  jpg: { mediaType: 'image/jpeg', automatic: false },
  jpeg: { mediaType: 'image/jpeg', automatic: false },
  webp: { mediaType: 'image/webp', automatic: false },
} as const;
export type FloorplanFormat = keyof typeof floorplanFormats;

export const createFloorplanImportSchema = z.object({ operationId: idSchema }).strict();
export const importHouseSpecSchema = z.object({
  operationId: idSchema, expectedRevision: z.number().int().positive(),
  /** HouseSpec in millimetres: one storey (`walls`) or a whole building (`floors`). */
  houseSpec: z.record(z.string(), z.unknown()),
  name: z.string().trim().min(1).max(100).optional(),
}).strict();

export type FloorplanImportStatus = 'queued' | 'converting' | 'retry_wait' | 'assisted_conversion' | 'pending_review' | 'failed';
export type FloorplanIssue = { code: string; severity: 'blocking' | 'review'; objectId?: string; detail: string };
export type FloorplanCandidateView = {
  id: string; importRevision: number; source: 'dxf-automatic' | 'member-housespec'; reviewStatus: 'pending_review';
  /** False when floorplan-import or the building contract rejected the HouseSpec; issues name the reason. */
  valid: boolean;
  scale: { status: string; evidenceId?: string };
  summary: { levels: number; walls: number; openings: number; rooms: number; roomNames: string[] } | null;
  /** Contradictory dimension annotations found in the drawing, listed for review. */
  dimensionConflicts: unknown[];
  issues: FloorplanIssue[];
  createdAt: string;
};
export type FloorplanImportView = {
  id: string; projectId: string; status: FloorplanImportStatus; mode: 'automatic' | 'assisted';
  /** User-facing statement of how the drawing is handled; non-DXF is never presented as recognised. */
  label: string;
  file: { name: string; format: string; mediaType: string; bytes: number; sha256: string; resourceId: string };
  revision: number; attempts: number;
  error: { code: string; message: string } | null;
  candidate: FloorplanCandidateView | null;
  createdAt: string; updatedAt: string;
};
