import { sql } from 'drizzle-orm';
import { db } from '../../persistence/src/client';
import { DomainError } from '../../contracts/src/project';

// Monthly usage per workspace for settling with enterprises on the shared deployment (ADR-0017, M03). Months are
// calendar months in China Standard Time. Read-only; never part of a request path.

export type WorkspaceUsage = {
  workspace: { id: string; slug: string | null; name: string };
  tasks: { total: number; byStatus: Record<string, number> };
  /** Model calls from task usage events. Calls whose provider reported no token counts are listed, never counted as zero. */
  model: { calls: number; inputTokens: number; outputTokens: number; unverifiedCalls: number };
  renders: { total: number; completed: number; failed: number; attempts: number; completedSeconds: number };
  imports: { total: number; byStatus: Record<string, number> };
};

const monthPattern = /^(\d{4})-(0[1-9]|1[0-2])$/;

export async function usageReport(month: string, slug?: string): Promise<WorkspaceUsage[]> {
  const match = monthPattern.exec(month);
  if (!match) throw new DomainError('INVALID_MONTH', `月份「${month}」无效，应为 YYYY-MM。`, 400);
  const [year, mon] = [Number(match[1]), Number(match[2])];
  const from = sql`make_timestamptz(${year}, ${mon}, 1, 0, 0, 0, 'Asia/Shanghai')`, to = sql`(${from} + interval '1 month')`;
  const scope = slug === undefined ? sql`true` : sql`w.slug = ${slug}`;
  const { rows } = await db.execute<{ workspace: WorkspaceUsage['workspace']; tasks: Record<string, number> | null; model: WorkspaceUsage['model'] | null;
    renders: WorkspaceUsage['renders'] | null; imports: Record<string, number> | null }>(sql`
    WITH ws AS (SELECT w.id, w.slug, w.name FROM workspaces w WHERE ${scope}),
    tasks AS (
      SELECT p.workspace_id, jsonb_object_agg(status, n) AS by_status FROM (
        SELECT p.workspace_id, t.status, count(*)::int AS n FROM design_tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.created_at >= ${from} AND t.created_at < ${to} GROUP BY 1, 2) p GROUP BY 1),
    model AS (
      SELECT p.workspace_id, count(*)::int AS calls,
        coalesce(sum((e.data->>'inputTokens')::bigint), 0)::bigint AS input_tokens,
        coalesce(sum((e.data->>'outputTokens')::bigint), 0)::bigint AS output_tokens,
        count(*) FILTER (WHERE e.data->>'inputTokens' IS NULL OR e.data->>'outputTokens' IS NULL)::int AS unverified
      FROM task_events e JOIN design_tasks t ON t.id = e.task_id JOIN projects p ON p.id = t.project_id
      WHERE e.type = 'usage' AND e.data->>'unit' = 'token' AND e.created_at >= ${from} AND e.created_at < ${to} GROUP BY 1),
    renders AS (
      SELECT p.workspace_id, count(*)::int AS total,
        count(*) FILTER (WHERE r.status = 'completed')::int AS completed, count(*) FILTER (WHERE r.status = 'failed')::int AS failed,
        coalesce(sum(r.attempts), 0)::int AS attempts,
        coalesce(sum(extract(epoch FROM r.updated_at - last.started)) FILTER (WHERE r.status = 'completed'), 0)::float AS completed_seconds
      FROM project_renders r JOIN projects p ON p.id = r.project_id
      LEFT JOIN LATERAL (SELECT max(a.created_at) AS started FROM render_attempts a WHERE a.render_id = r.id) last ON true
      WHERE r.created_at >= ${from} AND r.created_at < ${to} GROUP BY 1),
    imports AS (
      SELECT p.workspace_id, jsonb_object_agg(status, n) AS by_status FROM (
        SELECT p.workspace_id, i.status, count(*)::int AS n FROM floorplan_imports i JOIN projects p ON p.id = i.project_id
        WHERE i.created_at >= ${from} AND i.created_at < ${to} GROUP BY 1, 2) p GROUP BY 1)
    SELECT jsonb_build_object('id', ws.id, 'slug', ws.slug, 'name', ws.name) AS workspace, tasks.by_status AS tasks,
      CASE WHEN model.workspace_id IS NULL THEN NULL ELSE jsonb_build_object('calls', model.calls, 'inputTokens', model.input_tokens,
        'outputTokens', model.output_tokens, 'unverifiedCalls', model.unverified) END AS model,
      CASE WHEN renders.workspace_id IS NULL THEN NULL ELSE jsonb_build_object('total', renders.total, 'completed', renders.completed,
        'failed', renders.failed, 'attempts', renders.attempts, 'completedSeconds', round(renders.completed_seconds::numeric, 1)) END AS renders,
      imports.by_status AS imports
    FROM ws LEFT JOIN tasks ON tasks.workspace_id = ws.id LEFT JOIN model ON model.workspace_id = ws.id
      LEFT JOIN renders ON renders.workspace_id = ws.id LEFT JOIN imports ON imports.workspace_id = ws.id
    WHERE tasks.workspace_id IS NOT NULL OR model.workspace_id IS NOT NULL OR renders.workspace_id IS NOT NULL OR imports.workspace_id IS NOT NULL
      OR ${slug !== undefined}
    ORDER BY ws.slug NULLS LAST, ws.name`);
  if (slug !== undefined && !rows.length) throw new DomainError('NOT_FOUND', `工作空间「${slug}」不存在。`, 404);
  const sum = (counts: Record<string, number> | null) => Object.values(counts ?? {}).reduce((a, b) => a + b, 0);
  return rows.map(row => ({
    workspace: row.workspace,
    tasks: { total: sum(row.tasks), byStatus: row.tasks ?? {} },
    model: row.model ? { ...row.model, inputTokens: Number(row.model.inputTokens), outputTokens: Number(row.model.outputTokens) }
      : { calls: 0, inputTokens: 0, outputTokens: 0, unverifiedCalls: 0 },
    renders: row.renders ? { ...row.renders, completedSeconds: Number(row.renders.completedSeconds) } : { total: 0, completed: 0, failed: 0, attempts: 0, completedSeconds: 0 },
    imports: { total: sum(row.imports), byStatus: row.imports ?? {} },
  }));
}
