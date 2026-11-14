import { pgTable, index, unique, check, uuid, text, timestamp, integer, boolean, jsonb, bigint } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Model registry (ADR-0018). A model service is an address + key + protocol; a model is one model ID enabled on it.
// The key is stored only as AES-256-GCM ciphertext under HESTIA_SECRET_KEY; only its last four characters are shown.
export const modelServices = pgTable("model_services", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	protocol: text().$type<'chat' | 'responses' | 'anthropic'>().notNull(),
	baseUrl: text("base_url").notNull(),
	keyCiphertext: text("key_ciphertext").notNull(),
	keyTail: text("key_tail").notNull(),
	compat: jsonb().$type<Record<string, unknown>>().notNull(),
	timeoutSeconds: integer("timeout_seconds").notNull(),
	concurrency: integer().notNull(),
	ping: jsonb().$type<Record<string, unknown>>(),
	catalog: jsonb().$type<Record<string, unknown>>(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, () => [
	check("model_services_protocol_check", sql`protocol = ANY (ARRAY['chat'::text, 'responses'::text, 'anthropic'::text])`),
	check("model_services_limits_check", sql`timeout_seconds BETWEEN 5 AND 600 AND concurrency BETWEEN 1 AND 1000`),
]);

export const models = pgTable("models", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	serviceId: uuid("service_id").notNull().references(() => modelServices.id, { onDelete: 'restrict' }),
	modelId: text("model_id").notNull(),
	manual: boolean().default(false).notNull(),
	name: text().notNull(),
	description: text().default('').notNull(),
	maxOutput: integer("max_output").notNull(),
	params: jsonb().$type<Record<string, unknown>>().notNull(),
	state: text().$type<'draft' | 'checking' | 'admitted' | 'failed' | 'stale' | 'disabled'>().default('draft').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	unique("models_service_model_key").on(table.serviceId, table.modelId),
	check("models_state_check", sql`state = ANY (ARRAY['draft'::text, 'checking'::text, 'admitted'::text, 'failed'::text, 'stale'::text, 'disabled'::text])`),
]);

// Price versions: a change applies from the next call; each call records the version it used, history is never repriced.
export const modelPrices = pgTable("model_prices", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	modelId: uuid("model_id").notNull().references(() => models.id, { onDelete: 'cascade' }),
	inputPerMillion: bigint("input_per_million", { mode: 'number' }).notNull(),
	outputPerMillion: bigint("output_per_million", { mode: 'number' }).notNull(),
	effectiveAt: timestamp("effective_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("model_prices_model").on(table.modelId, table.effectiveAt),
	check("model_prices_nonnegative", sql`input_per_million >= 0 AND output_per_million >= 0`),
]);

// Access checks: real calls with synthetic samples; results and evidence are kept.
export const modelChecks = pgTable("model_checks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	modelId: uuid("model_id").notNull().references(() => models.id, { onDelete: 'cascade' }),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'date' }),
	status: text().$type<'running' | 'passed' | 'failed'>().notNull(),
	results: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
	failure: text(),
	startedBy: text("started_by").notNull(),
}, (table) => [
	index("model_checks_model").on(table.modelId, table.startedAt),
	check("model_checks_status_check", sql`status = ANY (ARRAY['running'::text, 'passed'::text, 'failed'::text])`),
]);
