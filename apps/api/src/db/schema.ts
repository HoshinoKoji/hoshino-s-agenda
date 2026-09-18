import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

export const accounts = sqliteTable('accounts', {
  email: text('email').primaryKey(),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
})

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  ownerEmail: text('owner_email').notNull().references(() => accounts.email, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  unique().on(table.id, table.ownerEmail),
  index('projects_owner').on(table.ownerEmail),
  check('projects_name_length', sql`length(${table.name}) BETWEEN 1 AND 64`),
])

export const entries = sqliteTable('entries', {
  id: text('id').primaryKey(),
  ownerEmail: text('owner_email').notNull().references(() => accounts.email, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull(),
  date: text('date'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  unique().on(table.id, table.ownerEmail),
  foreignKey({ columns: [table.projectId, table.ownerEmail], foreignColumns: [projects.id, projects.ownerEmail] }).onDelete('cascade'),
  index('entries_owner_date').on(table.ownerEmail, table.date),
  index('entries_project').on(table.projectId),
  check('entries_title_length', sql`length(${table.title}) BETWEEN 1 AND 200`),
  check('entries_completed_boolean', sql`${table.completed} IN (0, 1)`),
])

export const entryReferences = sqliteTable('entry_references', {
  sourceId: text('source_id').notNull(),
  targetId: text('target_id').notNull(),
  ownerEmail: text('owner_email').notNull(),
}, table => [
  primaryKey({ columns: [table.sourceId, table.targetId] }),
  foreignKey({ columns: [table.sourceId, table.ownerEmail], foreignColumns: [entries.id, entries.ownerEmail] }).onDelete('cascade'),
  foreignKey({ columns: [table.targetId, table.ownerEmail], foreignColumns: [entries.id, entries.ownerEmail] }).onDelete('cascade'),
  check('references_not_self', sql`${table.sourceId} != ${table.targetId}`),
  index('references_owner').on(table.ownerEmail),
  index('references_target').on(table.targetId),
])
