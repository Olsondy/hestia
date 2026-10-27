import { z } from 'zod';
import type { SpatialState } from '../../contracts/src/project';
import type { ConversationBrief } from '../../contracts/src/tasks';

/** A proposal, never permission. The current full user message is checked independently. */
export const planDecisionSchema = z.object({
  kind: z.literal('propose_layout'), roomId: z.string().min(1).max(120),
  sourceInputIds: z.array(z.string().uuid()).min(1).max(8),
  requirementIds: z.array(z.string().uuid()).max(80),
  functions: z.tuple([z.literal('hosting'), z.literal('work')]),
}).strict();
export type PlanDecision = z.infer<typeof planDecisionSchema>;
export const PLANNER_VERSION = 'single-room-layout-2';
export const PLAN_LIMITS = { maxNodes: 6000, maxCandidates: 24, maxMs: 2500, gridM: .35, aisleM: .7 } as const;
export type LayoutPlan = {
  version: typeof PLANNER_VERSION; baseHash: string; requestHash: string;
  status: 'recommended' | 'needs_input' | 'not_found';
  objects: SpatialState['currentLayout']['objects'] | null;
  reason: string; checks: { code: string; status: 'passed' | 'failed' | 'not_checked'; detail: string }[];
  requirements: { id: string; status: 'satisfied' | 'not_checked'; evidence: string }[];
  metrics: { nodes: number; candidatesChecked: number; correctionAttempts: number; elapsedMs: number; questions: number; modelCalls: 0; exhausted: boolean };
  source: { inputIds: string[]; requirementIds: string[]; intentVersion: number; roomId: string;
    reusedFromCandidate?: { id: string; revision: number } };
};
export type PlanInput = { state: SpatialState; brief: ConversationBrief; decision: PlanDecision; operationId: string;
  /** Server-selected previous candidate objects, rechecked against the current facts and intent. */
  seedObjects?: SpatialState['currentLayout']['objects'];
  seedCandidate?: { id: string; revision: number };
  /** Lower bounds for tests/runtime budgets; never permit an increase above platform limits. */
  limits?: { maxNodes?: number; maxCandidates?: number; maxMs?: number } };
export type PlannerContext = { version: typeof PLANNER_VERSION; roomId: string; sofaId: string; deskId: string; chairId: string;
  preservePoseIds: string[]; requirementIds: string[]; inputIds: string[]; intentVersion: number; taskId?: string };
