import { pgTable, index, uniqueIndex, primaryKey, check, uuid, text, timestamp, integer, boolean, bigint } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { workspaces } from './workspaces';
import { hestiaAuthUser } from './identity';
import { modelPrices, models } from './models';

// Model grants and quota per enterprise (ADR-0018). The platform admin grants admitted, priced models and sets the
// monthly quota (fen; null = no limit) and the Agent concurrency cap; the enterprise admin enables models and picks a default.
export const workspaceModelSettings = pgTable("workspace_model_settings", {
	workspaceId: uuid("workspace_id").primaryKey().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
	monthlyQuota: bigint("monthly_quota", { mode: 'number' }),
	concurrency: integer().default(2).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, () => [
	check("workspace_model_settings_limits", sql`(monthly_quota IS NULL OR monthly_quota >= 0) AND concurrency BETWEEN 1 AND 100`),
]);

export const workspaceModels = pgTable("workspace_models", {
	workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
	modelId: uuid("model_id").notNull().references(() => models.id, { onDelete: 'restrict' }),
	enabled: boolean().default(false).notNull(),
	isDefault: boolean("is_default").default(false).notNull(),
	grantedAt: timestamp("granted_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.workspaceId, table.modelId] }),
	uniqueIndex("workspace_models_one_default").on(table.workspaceId).where(sql`is_default`),
	check("workspace_models_default_enabled", sql`NOT is_default OR enabled`),
]);

// One row per model call: reserved before the call (input estimate + max output at the current price), settled after.
// Unknown usage settles at the reserved amount and is marked unverified, never as zero.
export const modelCalls = pgTable("model_calls", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
	userId: text("user_id").references(() => hestiaAuthUser.id, { onDelete: 'set null' }),
	taskId: uuid("task_id"),
	modelId: uuid("model_id").notNull().references(() => models.id, { onDelete: 'restrict' }),
	priceId: uuid("price_id").notNull().references(() => modelPrices.id, { onDelete: 'restrict' }),
	month: text().notNull(),
	status: text().$type<'reserved' | 'settled'>().default('reserved').notNull(),
	reservedFen: bigint("reserved_fen", { mode: 'number' }).notNull(),
	costFen: bigint("cost_fen", { mode: 'number' }),
	inputTokens: integer("input_tokens"),
	outputTokens: integer("output_tokens"),
	unverified: boolean().default(false).notNull(),
	outcome: text(),
	elapsedMs: integer("elapsed_ms"),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	settledAt: timestamp("settled_at", { withTimezone: true, mode: 'date' }),
}, (table) => [
	index("model_calls_workspace_month").on(table.workspaceId, table.month),
	index("model_calls_in_flight").on(table.modelId).where(sql`status = 'reserved'`),
	check("model_calls_month_format", sql`month ~ '^\\d{4}-\\d{2}$'`),
	check("model_calls_status_check", sql`status = ANY (ARRAY['reserved'::text, 'settled'::text])`),
	check("model_calls_settled", sql`status = 'reserved' OR cost_fen IS NOT NULL`),
]);
