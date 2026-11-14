import { and, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../../persistence/src/client';
import { hestiaAuthUser, modelCalls, models, workspaces } from '../../persistence/src/schema';
import { DomainError } from '../../contracts/src/project';
import { getWorkspace } from '../../workspaces/src/service';
import type { Principal } from '../../workspaces/src/access';
import { monthSql } from './grants';

// Usage per model call (ADR-0018). Amounts are integer fen, each call priced at the price version it reserved with;
// unverified calls (no usage from the provider) count at the reserved amount and are listed separately, never as zero.
// Only settled calls are summed; calls still in flight show up as "reserved" in the quota summary.

export type UsageRow = { key: string; name: string; calls: number; inputTokens: number; outputTokens: number; unverified: number; costFen: number };
export type UsageReport = { month: string; months: string[]; by: string; rows: UsageRow[]; total: Omit<UsageRow, 'key' | 'name'> };
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

async function months(scope: SQL) {
  const { rows: [{ current }] } = await db.execute<{ current: string }>(sql`SELECT ${monthSql} AS current`);
  const rows = await db.selectDistinct({ month: modelCalls.month }).from(modelCalls).where(scope).orderBy(sql`${modelCalls.month} DESC`).limit(24);
  return [...new Set([current, ...rows.map(row => row.month)])].sort().reverse();
}

async function summarize(scope: SQL, month: string | undefined, by: 'workspace' | 'model' | 'member'): Promise<UsageReport> {
  if (month !== undefined && !monthPattern.test(month)) throw new DomainError('INVALID_MONTH', `月份「${month}」无效，应为 YYYY-MM。`, 400);
  const available = await months(scope), chosen = month ?? available[0];
  const [key, name] = by === 'workspace' ? [sql<string>`${workspaces.id}::text`, sql<string>`${workspaces.name}`]
    : by === 'model' ? [sql<string>`${models.id}::text`, sql<string>`${models.name} || ' · ' || ${models.modelId}`]
      : [sql<string>`coalesce(${modelCalls.userId}, '')`, sql<string>`coalesce(max(${hestiaAuthUser.name}), '已删除的账号')`];
  const rows = await db.select({ key, name: by === 'member' ? name : sql<string>`min(${name})`,
    calls: sql<number>`count(*)::int`, inputTokens: sql<number>`coalesce(sum(${modelCalls.inputTokens}), 0)::bigint`,
    outputTokens: sql<number>`coalesce(sum(${modelCalls.outputTokens}), 0)::bigint`, unverified: sql<number>`count(*) FILTER (WHERE ${modelCalls.unverified})::int`,
    costFen: sql<number>`coalesce(sum(${modelCalls.costFen}), 0)::bigint` })
    .from(modelCalls).innerJoin(workspaces, eq(workspaces.id, modelCalls.workspaceId)).innerJoin(models, eq(models.id, modelCalls.modelId))
    .leftJoin(hestiaAuthUser, eq(hestiaAuthUser.id, modelCalls.userId))
    .where(and(scope, eq(modelCalls.month, chosen), eq(modelCalls.status, 'settled'))).groupBy(key).orderBy(sql`sum(${modelCalls.costFen}) DESC`, key);
  const typed = rows.map(row => ({ key: row.key, name: row.name, calls: Number(row.calls), inputTokens: Number(row.inputTokens), outputTokens: Number(row.outputTokens),
    unverified: Number(row.unverified), costFen: Number(row.costFen) }));
  const total = typed.reduce((sum, row) => ({ calls: sum.calls + row.calls, inputTokens: sum.inputTokens + row.inputTokens, outputTokens: sum.outputTokens + row.outputTokens,
    unverified: sum.unverified + row.unverified, costFen: sum.costFen + row.costFen }), { calls: 0, inputTokens: 0, outputTokens: 0, unverified: 0, costFen: 0 });
  return { month: chosen, months: available, by, rows: typed, total };
}

const byOf = <T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T => {
  if (value === null || value === undefined || value === '') return fallback;
  if (!allowed.includes(value as T)) throw new DomainError('INVALID_INPUT', '汇总方式无效。', 400);
  return value as T;
};

/** Platform console: every enterprise, by enterprise or by model. */
export const platformUsage = (month?: string, by?: string | null) => summarize(sql`true`, month, byOf(by, ['workspace', 'model'] as const, 'workspace'));

/** Enterprise admin only: this enterprise, by member or by model. Prices are not shown to the enterprise. */
export async function enterpriseUsage(principal: Principal, workspaceId: string, month?: string, by?: string | null) {
  const workspace = await getWorkspace(principal, workspaceId);
  if (workspace.role !== 'admin') throw new DomainError('FORBIDDEN', '只有企业管理员可以查看用量。', 403);
  return summarize(sql`${modelCalls.workspaceId} = ${workspace.id}`, month, byOf(by, ['member', 'model'] as const, 'member'));
}

const csvCell = (value: string | number) => { const text = String(value); return /[",\n\r]/.test(text) || /^[=+\-@]/.test(text) ? `"${text.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : text; };
/** Same numbers as the page; amounts in 元 with two decimals. Leading formula characters are neutralized for spreadsheets. */
export function usageCsv(report: UsageReport) {
  const head = [report.by === 'workspace' ? '企业' : report.by === 'model' ? '模型' : '成员', '调用次数', '输入 token', '输出 token', '未核对次数', '金额（元）'];
  const line = (name: string, r: Omit<UsageRow, 'key' | 'name'>) => [name, r.calls, r.inputTokens, r.outputTokens, r.unverified, (r.costFen / 100).toFixed(2)].map(csvCell).join(',');
  return '﻿' + [head.join(','), ...report.rows.map(r => line(r.name, r)), line('合计', report.total)].join('\r\n') + '\r\n';
}

/** For pnpm usage:report: billing per enterprise and model in one month. */
export async function billingByWorkspace(month: string, workspaceId: string) {
  const report = await summarize(sql`${modelCalls.workspaceId} = ${workspaceId}`, month, 'model');
  return { ...report.total, byModel: report.rows.map(({ key: _, ...row }) => row) };
}
