import { pgTable, text, timestamp, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';

const time = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const user = pgTable('hestia_auth_user', {
  id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false), image: text('image'),
  createdAt: time('created_at').notNull().defaultNow(), updatedAt: time('updated_at').notNull().defaultNow(),
});
export const session = pgTable('hestia_auth_session', {
  id: text('id').primaryKey(), expiresAt: time('expires_at').notNull(), token: text('token').notNull().unique(),
  createdAt: time('created_at').notNull().defaultNow(), updatedAt: time('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'), userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
}, table => [index('hestia_auth_session_user').on(table.userId)]);
export const account = pgTable('hestia_auth_account', {
  id: text('id').primaryKey(), accountId: text('account_id').notNull(), providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'), refreshToken: text('refresh_token'), idToken: text('id_token'),
  accessTokenExpiresAt: time('access_token_expires_at'), refreshTokenExpiresAt: time('refresh_token_expires_at'),
  scope: text('scope'), password: text('password'),
  createdAt: time('created_at').notNull().defaultNow(), updatedAt: time('updated_at').notNull().defaultNow(),
}, table => [index('hestia_auth_account_user').on(table.userId), uniqueIndex('hestia_auth_account_provider').on(table.providerId, table.accountId)]);
export const verification = pgTable('hestia_auth_verification', {
  id: text('id').primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(),
  expiresAt: time('expires_at').notNull(), createdAt: time('created_at').notNull().defaultNow(), updatedAt: time('updated_at').notNull().defaultNow(),
}, table => [index('hestia_auth_verification_identifier').on(table.identifier)]);

export const invitation = pgTable('hestia_invitation', {
  id: text('id').primaryKey(), email: text('email').notNull(), tokenHash: text('token_hash').notNull().unique(),
  expiresAt: time('expires_at').notNull(), createdAt: time('created_at').notNull().defaultNow(), consumedAt: time('consumed_at'),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
});
