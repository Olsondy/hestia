// Generated from the legacy SQL migrations by drizzle-kit pull, then edited by hand. Keep in step with the database.
import { pgTable, index, uniqueIndex, foreignKey, unique, check, primaryKey, uuid, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { projects } from './projects';

export const designTasks = pgTable("design_tasks", {
	id: uuid().primaryKey().notNull(),
	actorId: text("actor_id").notNull(),
	projectId: uuid("project_id").notNull(),
	requestId: uuid("request_id").notNull(),
	requestHash: text("request_hash").notNull(),
	protocol: text().notNull(),
	status: text().notNull(),
	steps: jsonb().notNull(),
	nextStep: integer("next_step").default(0).notNull(),
	expectedRevision: integer("expected_revision").notNull(),
	generation: integer().default(0).notNull(),
	leaseUntil: timestamp("lease_until", { withTimezone: true, mode: 'date' }),
	attempts: integer().default(0).notNull(),
	usageLimit: integer("usage_limit").default(8).notNull(),
	usageUsed: integer("usage_used").default(0).notNull(),
	usageReserved: integer("usage_reserved").default(0).notNull(),
	eventSeq: integer("event_seq").default(0).notNull(),
	error: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	conversation: jsonb(),
}, (table) => [
	uniqueIndex("design_tasks_one_active").on(table.projectId).where(sql`(status = ANY (ARRAY['queued'::text, 'running'::text, 'retry_wait'::text, 'waiting_input'::text, 'waiting_selection'::text]))`),
	index("design_tasks_project_recent").on(table.projectId, table.createdAt.desc().nullsFirst()),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "design_tasks_project_id_fkey"
		}).onDelete("cascade"),
	unique("design_tasks_actor_id_request_id_key").on(table.actorId, table.requestId),
	check("design_tasks_attempts_check", sql`attempts >= 0`),
	check("design_tasks_check", sql`(usage_used + usage_reserved) <= usage_limit`),
	check("design_tasks_conversation_check", sql`((protocol = 'deterministic-v1'::text) AND (conversation IS NULL)) OR ((protocol = 'conversation-v1'::text) AND (conversation IS NOT NULL))`),
	check("design_tasks_event_seq_check", sql`event_seq >= 0`),
	check("design_tasks_expected_revision_check", sql`expected_revision > 0`),
	check("design_tasks_generation_check", sql`generation >= 0`),
	check("design_tasks_next_step_check", sql`next_step >= 0`),
	check("design_tasks_protocol_check", sql`protocol = ANY (ARRAY['deterministic-v1'::text, 'conversation-v1'::text])`),
	check("design_tasks_status_check", sql`status = ANY (ARRAY['queued'::text, 'running'::text, 'retry_wait'::text, 'waiting_input'::text, 'waiting_selection'::text, 'completed'::text, 'partial'::text, 'failed'::text, 'cancelled'::text])`),
	check("design_tasks_usage_limit_check", sql`usage_limit > 0`),
	check("design_tasks_usage_reserved_check", sql`(usage_reserved >= 0) AND (usage_reserved <= 1)`),
	check("design_tasks_usage_used_check", sql`usage_used >= 0`),
]);

export const taskEvents = pgTable("task_events", {
	taskId: uuid("task_id").notNull(),
	seq: integer().notNull(),
	type: text().notNull(),
	data: jsonb().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [designTasks.id],
			name: "task_events_task_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.taskId, table.seq], name: "task_events_pkey"}),
	check("task_events_type_check", sql`type = ANY (ARRAY['status'::text, 'text'::text, 'operation'::text, 'usage'::text])`),
]);
