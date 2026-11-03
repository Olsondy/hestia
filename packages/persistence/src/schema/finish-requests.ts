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
	/** 线索跟进 (S02): members only; history in lead_follow_events. */
	followStatus: text("follow_status").default('new').notNull(),
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
	check("finish_requests_follow_status_check", sql`follow_status = ANY (ARRAY['new'::text, 'contacted'::text, 'active'::text, 'won'::text, 'parked'::text])`),
	index("finish_requests_workspace_follow").on(table.workspaceId, table.followStatus),
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
	/** Current soft style (K02) and the 2–3 styles the customer may switch between, as `{ styleId, styleVersion }`. */
	softStyle: jsonb("soft_style"),
	softChoices: jsonb("soft_choices").default([]).notNull(),
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
	/** HMAC of the share code (ADR-0012); the code itself is returned once and never stored. */
	tokenHash: text("token_hash").notNull(),
	targetPhone: text("target_phone"),
	/** Set when the request is bound through this share; the code no longer opens. */
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

/** 线索跟进记录 (S02): follow status changes and internal notes, append-only, visible to members only. */
export const leadFollowEvents = pgTable("lead_follow_events", {
	id: uuid().primaryKey().notNull(),
	requestId: uuid("request_id").notNull(),
	actorId: text("actor_id").notNull(),
	kind: text().notNull(),
	status: text(),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("lead_follow_events_request").on(table.requestId, table.createdAt),
	foreignKey({
			columns: [table.requestId],
			foreignColumns: [finishRequests.id],
			name: "lead_follow_events_request_id_fkey"
		}).onDelete("cascade"),
	check("lead_follow_events_kind_check", sql`(kind = 'status' AND status IS NOT NULL AND note IS NULL) OR (kind = 'note' AND status IS NULL AND note IS NOT NULL AND length(note) BETWEEN 1 AND 500)`),
	check("lead_follow_events_status_check", sql`status IS NULL OR status = ANY (ARRAY['new'::text, 'contacted'::text, 'active'::text, 'won'::text, 'parked'::text])`),
]);

/** Wrong share codes per request source (keyed HMAC), for the guessing limit (ADR-0012). */
export const shareCodeFailures = pgTable("share_code_failures", {
	id: uuid().primaryKey().notNull(),
	sourceHash: text("source_hash").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("share_code_failures_source").on(table.sourceHash, table.createdAt.desc().nullsFirst()),
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
	/** Soft style of this revision (K02), `{ styleId, styleVersion }`; null for schemes made before soft styles. */
	softStyle: jsonb("soft_style"),
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
