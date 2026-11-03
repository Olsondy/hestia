// Generated from the legacy SQL migrations by drizzle-kit pull, then edited by hand. Keep in step with the database.
import { pgTable, foreignKey, check, primaryKey, uuid, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { workspaces } from './workspaces';

export const workspaceStones = pgTable("workspace_stones", {
	workspaceId: uuid("workspace_id").notNull(),
	stoneId: text("stone_id").notNull(),
	version: integer().notNull(),
	status: text().$type<'active' | 'retired'>().default('active').notNull(),
	spec: jsonb().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "workspace_stones_workspace_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.workspaceId, table.stoneId, table.version], name: "workspace_stones_pkey"}),
	check("workspace_stones_status_check", sql`status = ANY (ARRAY['active'::text, 'retired'::text])`),
	check("workspace_stones_stone_id_check", sql`(length(stone_id) >= 1) AND (length(stone_id) <= 120)`),
	check("workspace_stones_version_check", sql`version > 0`),
]);

/** 软装风格目录 (K01): workspace-private, versions immutable, retired versions stay readable for existing schemes. */
export const workspaceSoftStyles = pgTable("workspace_soft_styles", {
	workspaceId: uuid("workspace_id").notNull(),
	styleId: text("style_id").notNull(),
	version: integer().notNull(),
	status: text().$type<'active' | 'retired'>().default('active').notNull(),
	spec: jsonb().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "workspace_soft_styles_workspace_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.workspaceId, table.styleId, table.version], name: "workspace_soft_styles_pkey"}),
	check("workspace_soft_styles_status_check", sql`status = ANY (ARRAY['active'::text, 'retired'::text])`),
]);
