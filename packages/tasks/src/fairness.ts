import type { PoolClient } from 'pg';
import type { GroupConcurrencyConfig, SendOptions, WorkOptions } from 'pg-boss';
import { validatedQueueSchema } from './queue';

// Fair queues across enterprises on the shared deployment (ADR-0017, M03). Every job carries its workspace as the
// pg-boss group. Two mechanisms:
// - Priority: a workspace's n-th waiting job is sent at priority -n, so another workspace's first job runs before
//   this one's second. This is what keeps one busy enterprise from starving others with a single Worker slot.
// - Group concurrency: with several slots, one workspace holds at most `perGroup` of them at a time.

export type JobWorkspace = { id: string; slug: string | null };
const PRIORITY_FLOOR = -1000;

/** Workspace owning a project, read on the caller's transaction (the job row and its source commit together). */
export async function projectWorkspace(client: PoolClient, projectId: string): Promise<JobWorkspace> {
  const { rows: [row] } = await client.query<JobWorkspace>(
    'SELECT w.id, w.slug FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE p.id = $1', [projectId]);
  if (!row) throw new Error('Job project has no workspace');
  return row;
}

/** Group and priority for a new job: behind every job this workspace already has waiting or running in the queue. */
export async function fairJobOptions(client: PoolClient, schema: string, queue: string, workspace: JobWorkspace): Promise<Pick<SendOptions, 'group' | 'priority'>> {
  const { rows: [{ waiting }] } = await client.query<{ waiting: number }>(
    `SELECT count(*)::int AS waiting FROM ${validatedQueueSchema(schema)}.job WHERE name = $1 AND group_id = $2 AND state IN ('created', 'retry', 'active')`,
    [queue, workspace.id]);
  return { group: { id: workspace.id, ...(workspace.slug ? { tier: workspace.slug } : {}) }, priority: Math.max(PRIORITY_FLOOR, -waiting) };
}

const positive = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
};
function overrides(name: string): Record<string, number> {
  const raw = process.env[name];
  if (!raw) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`${name} must be a JSON object of workspace slug to limit`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some(v => !Number.isInteger(v) || (v as number) < 1))
    throw new Error(`${name} must be a JSON object of workspace slug to positive integer`);
  return parsed as Record<string, number>;
}

/**
 * Worker options for a queue. HESTIA_<KIND>_WORKER_SLOTS jobs run at once (default 1). Each workspace holds at most
 * HESTIA_<KIND>_GROUP_LIMIT of them (default: all slots but one, at least 1); HESTIA_<KIND>_GROUP_LIMITS overrides
 * it per workspace slug, e.g. {"enterprise-a":2}. Read at Worker start; invalid values stop the Worker.
 */
export function fairWorkOptions(kind: 'TASK' | 'RENDER' | 'IMPORT'): Pick<WorkOptions, 'localConcurrency' | 'groupConcurrency'> {
  const slots = positive(`HESTIA_${kind}_WORKER_SLOTS`, 1);
  const groupConcurrency: GroupConcurrencyConfig = { default: positive(`HESTIA_${kind}_GROUP_LIMIT`, Math.max(1, slots - 1)), tiers: overrides(`HESTIA_${kind}_GROUP_LIMITS`) };
  return { localConcurrency: slots, groupConcurrency };
}
