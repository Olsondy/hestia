// Generated from the legacy SQL migrations by drizzle-kit pull, then edited by hand. Keep in step with the database.
import { pgTable, index, foreignKey, unique, check, primaryKey, uuid, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { operations, projects } from './projects';

export const candidates = pgTable("candidates", {
	id: uuid().primaryKey().notNull(),
	projectId: uuid("project_id").notNull(),
	actorId: text("actor_id").notNull(),
	name: text().notNull(),
	revision: integer().notNull(),
	baseRevision: integer("base_revision").notNull(),
	baseState: jsonb("base_state").notNull(),
	objects: jsonb().notNull(),
	status: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	visualStyle: jsonb("visual_style"),
	plannerContext: jsonb("planner_context"),
	surfaceDesign: jsonb("surface_design"),
}, (table) => [
	index("candidates_project").on(table.projectId, table.updatedAt.desc().nullsFirst()),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "candidates_project_id_fkey"
		}).onDelete("cascade"),
	check("candidates_base_revision_check", sql`base_revision > 0`),
	check("candidates_name_check", sql`(length(name) >= 1) AND (length(name) <= 120)`),
	check("candidates_revision_check", sql`revision > 0`),
	check("candidates_status_check", sql`status = ANY (ARRAY['draft'::text, 'checked'::text, 'adopted'::text])`),
]);

export const candidateChecks = pgTable("candidate_checks", {
	id: uuid().primaryKey().notNull(),
	candidateId: uuid("candidate_id").notNull(),
	candidateRevision: integer("candidate_revision").notNull(),
	baseRevision: integer("base_revision").notNull(),
	contentHash: text("content_hash").notNull(),
	checkerVersion: text("checker_version").notNull(),
	report: jsonb().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.candidateId, table.candidateRevision],
			foreignColumns: [candidateRevisions.candidateId, candidateRevisions.revision],
			name: "candidate_checks_candidate_id_candidate_revision_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.candidateId],
			foreignColumns: [candidates.id],
			name: "candidate_checks_candidate_id_fkey"
		}).onDelete("cascade"),
]);

export const candidatePresentations = pgTable("candidate_presentations", {
	id: uuid().primaryKey().notNull(),
	candidateId: uuid("candidate_id").notNull(),
	candidateRevision: integer("candidate_revision").notNull(),
	baseRevision: integer("base_revision").notNull(),
	checkId: uuid("check_id").notNull(),
	actorId: text("actor_id").notNull(),
	sessionHash: text("session_hash").notNull(),
	contentHash: text("content_hash").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.candidateId],
			foreignColumns: [candidates.id],
			name: "candidate_presentations_candidate_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.checkId],
			foreignColumns: [candidateChecks.id],
			name: "candidate_presentations_check_id_fkey"
		}).onDelete("cascade"),
]);

export const candidateSelections = pgTable("candidate_selections", {
	id: uuid().primaryKey().notNull(),
	presentationId: uuid("presentation_id").notNull(),
	actorId: text("actor_id").notNull(),
	sessionHash: text("session_hash").notNull(),
	adoptedOperationId: uuid("adopted_operation_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.presentationId],
			foreignColumns: [candidatePresentations.id],
			name: "candidate_selections_presentation_id_fkey"
		}).onDelete("cascade"),
]);

export const candidateAdoptions = pgTable("candidate_adoptions", {
	operationId: uuid("operation_id").primaryKey().notNull(),
	actorId: text("actor_id").notNull(),
	projectId: uuid("project_id").notNull(),
	candidateId: uuid("candidate_id").notNull(),
	candidateRevision: integer("candidate_revision").notNull(),
	selectionId: uuid("selection_id").notNull(),
	revision: integer().notNull(),
	beforeLayout: jsonb("before_layout").notNull(),
	afterLayout: jsonb("after_layout").notNull(),
	fixedFactsHash: text("fixed_facts_hash").notNull(),
	undoneBy: uuid("undone_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	beforeStyle: jsonb("before_style"),
	afterStyle: jsonb("after_style"),
	changeKind: text("change_kind").default('layout').notNull(),
	beforeSurface: jsonb("before_surface"),
	afterSurface: jsonb("after_surface"),
}, (table) => [
	index("candidate_adoptions_recent").on(table.projectId, table.revision.desc().nullsFirst()),
	// The database constraint is DEFERRABLE INITIALLY DEFERRED (legacy SQL); drizzle-kit cannot express that.
	foreignKey({
			columns: [table.actorId, table.operationId],
			foreignColumns: [operations.actorId, operations.id],
			name: "candidate_adoptions_actor_id_operation_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.candidateId],
			foreignColumns: [candidates.id],
			name: "candidate_adoptions_candidate_id_fkey"
		}),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "candidate_adoptions_project_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.selectionId],
			foreignColumns: [candidateSelections.id],
			name: "candidate_adoptions_selection_id_fkey"
		}),
	unique("candidate_adoptions_project_id_revision_key").on(table.projectId, table.revision),
	unique("candidate_adoptions_selection_id_key").on(table.selectionId),
	check("candidate_adoptions_change_kind_check", sql`change_kind = ANY (ARRAY['layout'::text, 'style'::text, 'surface'::text, 'mixed'::text])`),
	check("candidate_adoptions_revision_check", sql`revision > 0`),
]);

export const candidateRevisions = pgTable("candidate_revisions", {
	candidateId: uuid("candidate_id").notNull(),
	revision: integer().notNull(),
	objects: jsonb().notNull(),
	visualStyle: jsonb("visual_style"),
	surfaceDesign: jsonb("surface_design"),
}, (table) => [
	foreignKey({
			columns: [table.candidateId],
			foreignColumns: [candidates.id],
			name: "candidate_revisions_candidate_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.candidateId, table.revision], name: "candidate_revisions_pkey"}),
	check("candidate_revisions_revision_check", sql`revision > 0`),
]);
