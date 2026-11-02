// Generated from the legacy SQL migrations by drizzle-kit pull, then edited by hand. Keep in step with the database.
import { pgTable, index, foreignKey, unique, check, primaryKey, uuid, text, timestamp, integer, jsonb, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { projects, resources } from './projects';

export const projectRenders = pgTable("project_renders", {
	id: uuid().primaryKey().notNull(),
	actorId: text("actor_id").notNull(),
	projectId: uuid("project_id").notNull(),
	requestId: uuid("request_id").notNull(),
	requestHash: text("request_hash").notNull(),
	source: jsonb().notNull(),
	snapshot: jsonb().notNull(),
	snapshotHash: text("snapshot_hash").notNull(),
	assetVersion: text("asset_version").notNull(),
	rendererVersion: text("renderer_version").notNull(),
	scale: text().notNull(),
	synthetic: boolean().notNull(),
	concept: boolean().notNull(),
	label: text().notNull(),
	status: text().notNull(),
	generation: integer().default(0).notNull(),
	attempts: integer().default(0).notNull(),
	leaseUntil: timestamp("lease_until", { withTimezone: true, mode: 'date' }),
	resourceId: uuid("resource_id"),
	width: integer(),
	height: integer(),
	imageHash: text("image_hash"),
	error: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("project_renders_project_recent").on(table.projectId, table.createdAt.desc().nullsFirst()),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "project_renders_project_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.resourceId],
			foreignColumns: [resources.id],
			name: "project_renders_resource_id_fkey"
		}),
	unique("project_renders_actor_id_request_id_key").on(table.actorId, table.requestId),
	check("project_renders_status_check", sql`status = ANY (ARRAY['queued'::text, 'running'::text, 'retry_wait'::text, 'completed'::text, 'failed'::text])`),
]);

export const renderAttempts = pgTable("render_attempts", {
	renderId: uuid("render_id").notNull(),
	generation: integer().notNull(),
	resourceId: uuid("resource_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.renderId],
			foreignColumns: [projectRenders.id],
			name: "render_attempts_render_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.resourceId],
			foreignColumns: [resources.id],
			name: "render_attempts_resource_id_fkey"
		}),
	primaryKey({ columns: [table.renderId, table.generation], name: "render_attempts_pkey"}),
	unique("render_attempts_resource_id_key").on(table.resourceId),
]);
