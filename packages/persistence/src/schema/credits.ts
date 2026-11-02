// Generated from the legacy SQL migrations by drizzle-kit pull, then edited by hand. Keep in step with the database.
import { pgTable, index, uniqueIndex, foreignKey, check, uuid, text, timestamp, integer, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hestiaAuthUser } from './identity';

export const creditRules = pgTable("credit_rules", {
	singleton: boolean().default(true).primaryKey().notNull(),
	registrationGrant: integer("registration_grant").notNull(),
	qaCost: integer("qa_cost").notNull(),
	editCost: integer("edit_cost").notNull(),
	designCost: integer("design_cost").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	check("credit_rules_design_cost_check", sql`(design_cost >= 1) AND (design_cost <= 1000000)`),
	check("credit_rules_edit_cost_check", sql`(edit_cost >= 1) AND (edit_cost <= 1000000)`),
	check("credit_rules_qa_cost_check", sql`(qa_cost >= 1) AND (qa_cost <= 1000000)`),
	check("credit_rules_registration_grant_check", sql`(registration_grant >= 0) AND (registration_grant <= 1000000)`),
	check("credit_rules_singleton_check", sql`singleton`),
]);

export const creditAccounts = pgTable("credit_accounts", {
	userId: text("user_id").primaryKey().notNull(),
	available: integer().notNull(),
	reserved: integer().default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [hestiaAuthUser.id],
			name: "credit_accounts_user_id_fkey"
		}).onDelete("cascade"),
	check("credit_accounts_available_check", sql`available >= 0`),
	check("credit_accounts_reserved_check", sql`reserved >= 0`),
]);

export const creditLedger = pgTable("credit_ledger", {
	id: uuid().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	kind: text().notNull(),
	amount: integer().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("credit_ledger_user_created").on(table.userId, table.createdAt.desc().nullsFirst(), table.id.desc().nullsFirst()),
	uniqueIndex("credit_single_registration_grant").on(table.userId).where(sql`(kind = 'registration_grant'::text)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [hestiaAuthUser.id],
			name: "credit_ledger_user_id_fkey"
		}).onDelete("cascade"),
]);
