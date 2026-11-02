// Generated from the legacy SQL migrations by drizzle-kit pull, then edited by hand. Keep in step with the database.
import { pgTable, pgView, index, uniqueIndex, foreignKey, unique, check, primaryKey, uuid, text, timestamp, integer, jsonb, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hestiaAuthUser } from './identity';

export const workspaces = pgTable("workspaces", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	kind: text().notNull(),
	name: text().notNull(),
	slug: text(),
	personalUserId: text("personal_user_id"),
	settings: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.kind],
			foreignColumns: [workspaceTypes.kind],
			name: "workspaces_kind_fkey"
		}),
	unique("workspaces_slug_key").on(table.slug),
	unique("workspaces_personal_user_id_key").on(table.personalUserId),
	check("workspaces_name_check", sql`(length(name) >= 1) AND (length(name) <= 120)`),
	check("workspaces_settings_check", sql`jsonb_typeof(settings) = 'object'::text`),
	check("workspaces_slug_check", sql`slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'::text`),
]);

export const workspaceTypes = pgTable("workspace_types", {
	kind: text().primaryKey().notNull(),
	maxMembers: integer("max_members"),
	usagePolicy: text("usage_policy").notNull(),
	provisioning: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	customerEntry: boolean("customer_entry").default(false).notNull(),
}, (table) => [
	uniqueIndex("workspace_types_single_per_user").on(table.provisioning).where(sql`(provisioning = 'per_user'::text)`),
	check("workspace_types_kind_check", sql`kind ~ '^[a-z][a-z0-9-]{1,31}$'::text`),
	check("workspace_types_max_members_check", sql`(max_members IS NULL) OR (max_members > 0)`),
	check("workspace_types_provisioning_check", sql`provisioning = ANY (ARRAY['per_user'::text, 'explicit'::text])`),
	check("workspace_types_usage_policy_check", sql`usage_policy = ANY (ARRAY['member_credits'::text, 'unmetered'::text])`),
]);

export const workspaceCustomers = pgTable("workspace_customers", {
	workspaceId: uuid("workspace_id").notNull(),
	userId: text("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("workspace_customers_user").on(table.userId),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [hestiaAuthUser.id],
			name: "workspace_customers_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "workspace_customers_workspace_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.workspaceId, table.userId], name: "workspace_customers_pkey"}),
]);

export const workspaceMembers = pgTable("workspace_members", {
	workspaceId: uuid("workspace_id").notNull(),
	userId: text("user_id").notNull(),
	role: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("workspace_members_user").on(table.userId),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "workspace_members_workspace_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.workspaceId, table.userId], name: "workspace_members_pkey"}),
	check("workspace_members_role_check", sql`role = ANY (ARRAY['admin'::text, 'member'::text])`),
]);

export const projectAccess = pgView("project_access", {	projectId: uuid("project_id"),
	workspaceId: uuid("workspace_id"),
	userId: text("user_id"),
	via: text(),
	role: text(),
}).existing();
