// Generated from the legacy SQL migrations by drizzle-kit pull, then edited by hand. Keep in step with the database.
import { pgTable, index, uniqueIndex, foreignKey, unique, check, uuid, text, timestamp, integer, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { workspaces } from './workspaces';

export const hestiaAuthUser = pgTable("hestia_auth_user", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	email: text(),
	emailVerified: boolean("email_verified").default(false).notNull(),
	image: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	phoneNumber: text("phone_number"),
	// Customer accounts belong to one enterprise (ADR-0017): the same number at two enterprises is two accounts.
	// Null for platform accounts (members' e-mail accounts, personal users).
	workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: 'cascade' }),
}, (table) => [
	uniqueIndex("hestia_auth_user_phone_scope").on(sql`COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid)`, table.phoneNumber).where(sql`(phone_number IS NOT NULL)`),
	index("hestia_auth_user_workspace").on(table.workspaceId),
	check("hestia_auth_user_customer_scope", sql`(workspace_id IS NULL) OR ((phone_number IS NOT NULL) AND (email IS NULL))`),
	unique("hestia_auth_user_email_key").on(table.email),
	check("hestia_auth_email_normalized", sql`email = lower(email)`),
	check("hestia_auth_user_identifier", sql`(email IS NOT NULL) OR (phone_number IS NOT NULL)`),
	check("hestia_auth_user_phone_normalized", sql`phone_number ~ '^\\+861[3-9][0-9]{9}$'::text`),
]);

export const hestiaAuthSession = pgTable("hestia_auth_session", {
	id: text().primaryKey().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'date' }).notNull(),
	token: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id").notNull(),
}, (table) => [
	index("hestia_auth_session_user").on(table.userId),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [hestiaAuthUser.id],
			name: "hestia_auth_session_user_id_fkey"
		}).onDelete("cascade"),
	unique("hestia_auth_session_token_key").on(table.token),
]);

export const hestiaAuthAccount = pgTable("hestia_auth_account", {
	id: text().primaryKey().notNull(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id").notNull(),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true, mode: 'date' }),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true, mode: 'date' }),
	scope: text(),
	password: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("hestia_auth_account_provider").on(table.providerId, table.accountId),
	index("hestia_auth_account_user").on(table.userId),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [hestiaAuthUser.id],
			name: "hestia_auth_account_user_id_fkey"
		}).onDelete("cascade"),
]);

export const hestiaAuthVerification = pgTable("hestia_auth_verification", {
	id: text().primaryKey().notNull(),
	identifier: text().notNull(),
	value: text().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'date' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("hestia_auth_verification_identifier").on(table.identifier),
]);

export const hestiaInvitation = pgTable("hestia_invitation", {
	id: text().primaryKey().notNull(),
	email: text().notNull(),
	tokenHash: text("token_hash").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'date' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	consumedAt: timestamp("consumed_at", { withTimezone: true, mode: 'date' }),
	userId: text("user_id"),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [hestiaAuthUser.id],
			name: "hestia_invitation_user_id_fkey"
		}).onDelete("set null"),
	unique("hestia_invitation_token_hash_key").on(table.tokenHash),
	check("hestia_invitation_email_normalized", sql`email = lower(email)`),
]);

export const phoneOtpChallenges = pgTable("phone_otp_challenges", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	phoneNumber: text("phone_number").notNull(),
	/** Enterprise whose entry asked for the code; a code is used and counted only there (ADR-0017). */
	workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: 'cascade' }),
	sourceHash: text("source_hash").notNull(),
	codeHash: text("code_hash").notNull(),
	attempts: integer().default(0).notNull(),
	maxAttempts: integer("max_attempts").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'date' }).notNull(),
	consumedAt: timestamp("consumed_at", { withTimezone: true, mode: 'date' }),
	supersededAt: timestamp("superseded_at", { withTimezone: true, mode: 'date' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).default(sql`clock_timestamp()`).notNull(),
}, (table) => [
	index("phone_otp_challenges_phone").on(table.phoneNumber, table.createdAt.desc().nullsFirst()),
	index("phone_otp_challenges_workspace_phone").on(table.workspaceId, table.phoneNumber, table.createdAt.desc().nullsFirst()),
	index("phone_otp_challenges_source").on(table.sourceHash, table.createdAt.desc().nullsFirst()),
	check("phone_otp_challenges_attempts_check", sql`attempts >= 0`),
	check("phone_otp_challenges_max_attempts_check", sql`max_attempts > 0`),
	check("phone_otp_challenges_phone_number_check", sql`phone_number ~ '^\\+861[3-9][0-9]{9}$'::text`),
]);
