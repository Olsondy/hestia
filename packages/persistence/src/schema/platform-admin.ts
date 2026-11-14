import { pgTable, index, check, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hestiaAuthUser } from './identity';

// Platform administration (ADR-0018). Granted only by a command on the server, never self-service.
// `super` also lets the account look into any enterprise workbench read-only for troubleshooting.
export const platformAdmins = pgTable("platform_admins", {
	userId: text("user_id").primaryKey().notNull().references(() => hestiaAuthUser.id, { onDelete: 'cascade' }),
	level: text().$type<'platform' | 'super'>().notNull(),
	grantedAt: timestamp("granted_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	grantedVia: text("granted_via").notNull(),
}, () => [
	check("platform_admins_level_check", sql`level = ANY (ARRAY['platform'::text, 'super'::text])`),
]);

// Every change a platform administrator makes, and every grant or revoke. Append-only; keys are only ever
// recorded as "replaced". `actor` keeps the e-mail so the record survives the account being deleted.
export const platformAudit = pgTable("platform_audit", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	at: timestamp({ withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	actorUserId: text("actor_user_id").references(() => hestiaAuthUser.id, { onDelete: 'set null' }),
	actor: text().notNull(),
	action: text().notNull(),
	target: text().notNull(),
	detail: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
}, (table) => [
	index("platform_audit_at").on(table.at.desc()),
]);
