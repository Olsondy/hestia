// Generated from the legacy SQL migrations by drizzle-kit pull, then edited by hand. Keep in step with the database.
import { pgTable, index, uniqueIndex, foreignKey, unique, check, primaryKey, uuid, text, timestamp, integer, jsonb, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { floorplanImports } from './floorplan-imports';
import { projects } from './projects';
import { projectRenders } from './renders';
import { workspaces } from './workspaces';

export const finishRequests = pgTable("finish_requests", {
	id: uuid().primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	customerId: text("customer_id"),
	projectId: uuid("project_id").notNull(),
	requestId: uuid("request_id").notNull(),
	requestHash: text("request_hash").notNull(),
	source: text().notNull(),
	floorplanImportId: uuid("floorplan_import_id"),
	finishIds: jsonb("finish_ids").default([]).notNull(),
	stones: jsonb().default([]).notNull(),
	note: text(),
	status: text().notNull(),
	reviewReason: text("review_reason"),
	publishedAt: timestamp("published_at", { withTimezone: true, mode: 'date' }),
	publishedBy: text("published_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	origin: text().default('customer').notNull(),
	createdBy: text("created_by").notNull(),
	preferences: jsonb(),
}, (table) => [
	index("finish_requests_customer").on(table.customerId, table.createdAt.desc().nullsFirst()),
	uniqueIndex("finish_requests_operation").on(table.createdBy, table.requestId),
	index("finish_requests_workspace").on(table.workspaceId, table.createdAt.desc().nullsFirst()),
	foreignKey({
			columns: [table.floorplanImportId],
			foreignColumns: [floorplanImports.id],
			name: "finish_requests_floorplan_import_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "finish_requests_project_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "finish_requests_workspace_id_fkey"
		}).onDelete("cascade"),
	unique("finish_requests_project_id_key").on(table.projectId),
	check("finish_requests_customer_origin", sql`(origin = 'member'::text) OR (customer_id IS NOT NULL)`),
	check("finish_requests_note_check", sql`(note IS NULL) OR (length(note) <= 500)`),
	check("finish_requests_origin_check", sql`origin = ANY (ARRAY['customer'::text, 'member'::text])`),
	check("finish_requests_source_check", sql`source = ANY (ARRAY['demo-villa'::text, 'drawing'::text])`),
	check("finish_requests_status_check", sql`status = ANY (ARRAY['awaiting_drawing'::text, 'converting'::text, 'pending_review'::text, 'published'::text])`),
]);

export const finishSchemes = pgTable("finish_schemes", {
	id: uuid().primaryKey().notNull(),
	requestId: uuid("request_id").notNull(),
	ordinal: integer().notNull(),
	name: text().notNull(),
	summary: text().notNull(),
	revision: integer().default(1).notNull(),
	surfaceDesign: jsonb("surface_design").notNull(),
	report: jsonb().notNull(),
	renderId: uuid("render_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.renderId],
			foreignColumns: [projectRenders.id],
			name: "finish_schemes_render_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.requestId],
			foreignColumns: [finishRequests.id],
			name: "finish_schemes_request_id_fkey"
		}).onDelete("cascade"),
	unique("finish_schemes_request_id_ordinal_key").on(table.requestId, table.ordinal),
	check("finish_schemes_ordinal_check", sql`(ordinal >= 1) AND (ordinal <= 3)`),
	check("finish_schemes_revision_check", sql`revision > 0`),
]);

export const finishRequestEvents = pgTable("finish_request_events", {
	id: uuid().primaryKey().notNull(),
	requestId: uuid("request_id").notNull(),
	actorId: text("actor_id").notNull(),
	kind: text().notNull(),
	schemeId: uuid("scheme_id"),
	schemeRevision: integer("scheme_revision"),
	surfaceDesign: jsonb("surface_design"),
	message: text(),
	contactRequested: boolean("contact_requested").default(false).notNull(),
	preferredTime: text("preferred_time"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("finish_request_events_request").on(table.requestId, table.createdAt.desc().nullsFirst()),
	foreignKey({
			columns: [table.requestId],
			foreignColumns: [finishRequests.id],
			name: "finish_request_events_request_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.schemeId],
			foreignColumns: [finishSchemes.id],
			name: "finish_request_events_scheme_id_fkey"
		}).onDelete("set null"),
	check("finish_request_events_kind_check", sql`kind = ANY (ARRAY['confirmation'::text, 'message'::text])`),
	check("finish_request_events_message_check", sql`(message IS NULL) OR (length(message) <= 500)`),
	check("finish_request_events_preferred_time_check", sql`(preferred_time IS NULL) OR (length(preferred_time) <= 40)`),
]);

export const bindingApplications = pgTable("binding_applications", {
	id: uuid().primaryKey().notNull(),
	shareId: uuid("share_id").notNull(),
	requestId: uuid("request_id").notNull(),
	applicantId: text("applicant_id").notNull(),
	note: text(),
	status: text().default('pending').notNull(),
	decidedBy: text("decided_by"),
	decidedAt: timestamp("decided_at", { withTimezone: true, mode: 'date' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("binding_applications_pending").on(table.requestId, table.applicantId).where(sql`(status = 'pending'::text)`),
	foreignKey({
			columns: [table.requestId],
			foreignColumns: [finishRequests.id],
			name: "binding_applications_request_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.shareId],
			foreignColumns: [requestShares.id],
			name: "binding_applications_share_id_fkey"
		}).onDelete("cascade"),
	check("binding_applications_note_check", sql`(note IS NULL) OR (length(note) <= 200)`),
	check("binding_applications_status_check", sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'superseded'::text])`),
]);

export const requestShares = pgTable("request_shares", {
	id: uuid().primaryKey().notNull(),
	requestId: uuid("request_id").notNull(),
	tokenHash: text("token_hash").notNull(),
	targetPhone: text("target_phone"),
	codeHash: text("code_hash"),
	codeExpiresAt: timestamp("code_expires_at", { withTimezone: true, mode: 'date' }),
	codeAttempts: integer("code_attempts").default(0).notNull(),
	codeUsedAt: timestamp("code_used_at", { withTimezone: true, mode: 'date' }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'date' }),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'date' }),
	revokedBy: text("revoked_by"),
	createdBy: text("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("request_shares_request").on(table.requestId, table.createdAt.desc().nullsFirst()),
	foreignKey({
			columns: [table.requestId],
			foreignColumns: [finishRequests.id],
			name: "request_shares_request_id_fkey"
		}).onDelete("cascade"),
	unique("request_shares_token_hash_key").on(table.tokenHash),
]);

export const bindingEvents = pgTable("binding_events", {
	id: uuid().primaryKey().notNull(),
	requestId: uuid("request_id").notNull(),
	shareId: uuid("share_id"),
	kind: text().notNull(),
	method: text(),
	actorId: text("actor_id").notNull(),
	subjectId: text("subject_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("binding_events_request").on(table.requestId, table.createdAt),
	foreignKey({
			columns: [table.requestId],
			foreignColumns: [finishRequests.id],
			name: "binding_events_request_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.shareId],
			foreignColumns: [requestShares.id],
			name: "binding_events_share_id_fkey"
		}).onDelete("set null"),
	check("binding_events_kind_check", sql`kind = ANY (ARRAY['share'::text, 'bind'::text, 'unbind'::text, 'revoke'::text, 'apply'::text, 'approve'::text, 'reject'::text])`),
	check("binding_events_method_check", sql`(method IS NULL) OR (method = ANY (ARRAY['phone'::text, 'code'::text, 'approval'::text]))`),
]);

export const finishRequestOperations = pgTable("finish_request_operations", {
	actorId: text("actor_id").notNull(),
	id: uuid().notNull(),
	requestId: uuid("request_id").notNull(),
	requestHash: text("request_hash").notNull(),
	result: jsonb().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.requestId],
			foreignColumns: [finishRequests.id],
			name: "finish_request_operations_request_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.actorId, table.id], name: "finish_request_operations_pkey"}),
]);

export const finishSchemeRevisions = pgTable("finish_scheme_revisions", {
	schemeId: uuid("scheme_id").notNull(),
	revision: integer().notNull(),
	surfaceDesign: jsonb("surface_design").notNull(),
	report: jsonb().notNull(),
	renderId: uuid("render_id"),
	change: jsonb(),
	createdBy: text("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.renderId],
			foreignColumns: [projectRenders.id],
			name: "finish_scheme_revisions_render_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.schemeId],
			foreignColumns: [finishSchemes.id],
			name: "finish_scheme_revisions_scheme_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.schemeId, table.revision], name: "finish_scheme_revisions_pkey"}),
	check("finish_scheme_revisions_revision_check", sql`revision > 0`),
]);
