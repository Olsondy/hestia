// Generated from the legacy SQL migrations by drizzle-kit pull, then edited by hand. Keep in step with the database.
import { pgTable, index, foreignKey, unique, check, primaryKey, uuid, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { workspaces } from './workspaces';

export const resources = pgTable("resources", {
	id: uuid().primaryKey().notNull(),
	projectId: uuid("project_id").notNull(),
	objectKey: text("object_key").notNull(),
	mediaType: text("media_type").notNull(),
	state: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("resources_project").on(table.projectId),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "resources_project_id_fkey"
		}),
	unique("resources_object_key_key").on(table.objectKey),
	check("resources_state_check", sql`state = ANY (ARRAY['pending'::text, 'ready'::text, 'failed'::text])`),
]);

export const projects = pgTable("projects", {
	id: uuid().primaryKey().notNull(),
	name: text().notNull(),
	revision: integer().notNull(),
	snapshot: jsonb().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	createdBy: text("created_by").notNull(),
}, (table) => [
	index("projects_workspace").on(table.workspaceId, table.updatedAt.desc().nullsFirst()),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "projects_workspace_id_fkey"
		}),
	check("projects_name_check", sql`(length(name) >= 1) AND (length(name) <= 120)`),
	check("projects_revision_check", sql`revision > 0`),
]);

export const projectUnderlays = pgTable("project_underlays", {
	projectId: uuid("project_id").primaryKey().notNull(),
	resourceId: uuid("resource_id").notNull(),
	version: integer().notNull(),
	view: jsonb().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "project_underlays_project_id_fkey"
		}),
	foreignKey({
			columns: [table.resourceId],
			foreignColumns: [resources.id],
			name: "project_underlays_resource_id_fkey"
		}),
	check("project_underlays_version_check", sql`version > 0`),
]);

export const projectStyleCommands = pgTable("project_style_commands", {
	operationId: uuid("operation_id").primaryKey().notNull(),
	actorId: text("actor_id").notNull(),
	projectId: uuid("project_id").notNull(),
	revision: integer().notNull(),
	command: jsonb().notNull(),
	beforeStyle: jsonb("before_style"),
	afterStyle: jsonb("after_style").notNull(),
	layoutHash: text("layout_hash").notNull(),
	fixedFactsHash: text("fixed_facts_hash").notNull(),
	undoneBy: uuid("undone_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("project_style_commands_recent").on(table.projectId, table.revision.desc().nullsFirst()),
	// The database constraint is DEFERRABLE INITIALLY DEFERRED (legacy SQL); drizzle-kit cannot express that.
	foreignKey({
			columns: [table.actorId, table.operationId],
			foreignColumns: [operations.actorId, operations.id],
			name: "project_style_commands_actor_id_operation_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "project_style_commands_project_id_fkey"
		}).onDelete("cascade"),
	unique("project_style_commands_project_id_revision_key").on(table.projectId, table.revision),
	check("project_style_commands_revision_check", sql`revision > 0`),
]);

export const projectRevisions = pgTable("project_revisions", {
	projectId: uuid("project_id").notNull(),
	revision: integer().notNull(),
	snapshot: jsonb().notNull(),
	operationId: uuid("operation_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "project_revisions_project_id_fkey"
		}),
	primaryKey({ columns: [table.projectId, table.revision], name: "project_revisions_pkey"}),
]);

export const operations = pgTable("operations", {
	actorId: text("actor_id").notNull(),
	id: uuid().notNull(),
	projectId: uuid("project_id").notNull(),
	requestHash: text("request_hash").notNull(),
	result: jsonb().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "operations_project_id_fkey"
		}),
	primaryKey({ columns: [table.actorId, table.id], name: "operations_pkey"}),
]);

export const underlayOperations = pgTable("underlay_operations", {
	actorId: text("actor_id").notNull(),
	id: uuid().notNull(),
	projectId: uuid("project_id").notNull(),
	resourceId: uuid("resource_id").notNull(),
	requestHash: text("request_hash").notNull(),
	result: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("underlay_operations_project").on(table.projectId),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "underlay_operations_project_id_fkey"
		}),
	foreignKey({
			columns: [table.resourceId],
			foreignColumns: [resources.id],
			name: "underlay_operations_resource_id_fkey"
		}),
	primaryKey({ columns: [table.actorId, table.id], name: "underlay_operations_pkey"}),
]);

export const projectCommands = pgTable("project_commands", {
	actorId: text("actor_id").notNull(),
	operationId: uuid("operation_id").notNull(),
	projectId: uuid("project_id").notNull(),
	type: text().notNull(),
	objectId: text("object_id").notNull(),
	revision: integer().notNull(),
	layoutId: uuid("layout_id").notNull(),
	fixedFactsId: uuid("fixed_facts_id").notNull(),
	fixedFactsRevision: integer("fixed_facts_revision").notNull(),
	beforeValue: jsonb("before_value").notNull(),
	afterValue: jsonb("after_value").notNull(),
	undoOf: uuid("undo_of"),
	undoneBy: uuid("undone_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("project_commands_dependencies").on(table.projectId, table.objectId, table.revision.desc().nullsFirst()),
	index("project_commands_recent").on(table.projectId, table.revision.desc().nullsFirst()),
	foreignKey({
			columns: [table.actorId, table.operationId],
			foreignColumns: [operations.actorId, operations.id],
			name: "project_commands_actor_id_operation_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "project_commands_project_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.actorId, table.operationId], name: "project_commands_pkey"}),
	unique("project_commands_project_id_revision_key").on(table.projectId, table.revision),
	check("project_commands_revision_check", sql`revision > 0`),
	check("project_commands_type_check", sql`type = ANY (ARRAY['move-furniture'::text, 'set-lock'::text, 'undo'::text])`),
]);
