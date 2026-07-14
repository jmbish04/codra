import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const kb_repos = sqliteTable('kb_repos', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  github_id: integer('github_id', { mode: 'number' }).notNull().unique(),
  full_name: text('full_name').notNull().unique(),
  language: text('language'),
  topics: text('topics', { mode: 'json' }).default('[]'),
  is_starred: integer('is_starred', { mode: 'boolean' }).default(false).notNull(),
  is_watched: integer('is_watched', { mode: 'boolean' }).default(false).notNull(),
  is_forked_by_me: integer('is_forked_by_me', { mode: 'boolean' }).default(false).notNull(),
  stargazers_count: integer('stargazers_count', { mode: 'number' }),
  starred_at: text('starred_at'),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
