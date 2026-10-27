import { pgTable, uuid, text, integer, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey(), ownerId: text('owner_id').notNull(), name: text('name').notNull(),
  revision: integer('revision').notNull(), snapshot: jsonb('snapshot').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
export const projectRevisions = pgTable('project_revisions', {
  projectId: uuid('project_id').notNull().references(() => projects.id),
  revision: integer('revision').notNull(), snapshot: jsonb('snapshot').notNull(),
  operationId: uuid('operation_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.projectId, t.revision] })]);
export const resources = pgTable('resources', {
  id: uuid('id').primaryKey(), projectId: uuid('project_id').notNull().references(() => projects.id),
  objectKey: text('object_key').notNull(), mediaType: text('media_type').notNull(),
  state: text('state').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
