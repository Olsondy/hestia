// Generated from the legacy SQL migrations by drizzle-kit pull, then edited by hand. Keep in step with the database.
import { pgTable, index, foreignKey, unique, check, primaryKey, uuid, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { projects, resources } from './projects';

export const floorplanCandidates = pgTable("floorplan_candidates", {
	id: uuid().primaryKey().notNull(),
	importId: uuid("import_id").notNull(),
	projectId: uuid("project_id").notNull(),
	importRevision: integer("import_revision").notNull(),
	source: text().notNull(),
	generation: integer(),
	createdBy: text("created_by"),
	reviewStatus: text("review_status").notNull(),
	houseSpec: jsonb("house_spec").notNull(),
	candidate: jsonb(),
	scene: jsonb(),
	issues: jsonb().notNull(),
	conversion: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("floorplan_candidates_project").on(table.projectId, table.createdAt.desc().nullsFirst()),
	foreignKey({
			columns: [table.importId],
			foreignColumns: [floorplanImports.id],
			name: "floorplan_candidates_import_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "floorplan_candidates_project_id_fkey"
		}).onDelete("cascade"),
	unique("floorplan_candidates_import_id_import_revision_key").on(table.importId, table.importRevision),
	check("floorplan_candidates_review_status_check", sql`review_status = 'pending_review'::text`),
	check("floorplan_candidates_source_check", sql`source = ANY (ARRAY['dxf-automatic'::text, 'member-housespec'::text])`),
]);

export const floorplanImports = pgTable("floorplan_imports", {
	id: uuid().primaryKey().notNull(),
	projectId: uuid("project_id").notNull(),
	actorId: text("actor_id").notNull(),
	requestId: uuid("request_id").notNull(),
	requestHash: text("request_hash").notNull(),
	resourceId: uuid("resource_id").notNull(),
	fileName: text("file_name").notNull(),
	fileFormat: text("file_format").notNull(),
	byteSize: integer("byte_size").notNull(),
	sha256: text().notNull(),
	mode: text().notNull(),
	status: text().notNull(),
	generation: integer().default(0).notNull(),
	attempts: integer().default(0).notNull(),
	leaseUntil: timestamp("lease_until", { withTimezone: true, mode: 'date' }),
	revision: integer().default(1).notNull(),
	error: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("floorplan_imports_project_recent").on(table.projectId, table.createdAt.desc().nullsFirst()),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "floorplan_imports_project_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.resourceId],
			foreignColumns: [resources.id],
			name: "floorplan_imports_resource_id_fkey"
		}),
	unique("floorplan_imports_actor_id_request_id_key").on(table.actorId, table.requestId),
	unique("floorplan_imports_resource_id_key").on(table.resourceId),
	check("floorplan_imports_byte_size_check", sql`byte_size > 0`),
	check("floorplan_imports_file_name_check", sql`(length(file_name) >= 1) AND (length(file_name) <= 200)`),
	check("floorplan_imports_mode_check", sql`mode = ANY (ARRAY['automatic'::text, 'assisted'::text])`),
	check("floorplan_imports_revision_check", sql`revision > 0`),
	check("floorplan_imports_status_check", sql`status = ANY (ARRAY['queued'::text, 'converting'::text, 'retry_wait'::text, 'assisted_conversion'::text, 'pending_review'::text, 'failed'::text])`),
]);

export const floorplanImportOperations = pgTable("floorplan_import_operations", {
	actorId: text("actor_id").notNull(),
	id: uuid().notNull(),
	importId: uuid("import_id").notNull(),
	requestHash: text("request_hash").notNull(),
	result: jsonb().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.importId],
			foreignColumns: [floorplanImports.id],
			name: "floorplan_import_operations_import_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.actorId, table.id], name: "floorplan_import_operations_pkey"}),
]);
