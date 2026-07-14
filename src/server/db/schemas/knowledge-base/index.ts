import { sqliteTable, text, integer, unique, AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
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

export const kb_users = sqliteTable('kb_users', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  github_id: integer('github_id', { mode: 'number' }).notNull().unique(),
  login: text('login').notNull().unique(),
  avatar_url: text('avatar_url'),
  bio: text('bio'),
  is_following: integer('is_following', { mode: 'boolean' }).default(false).notNull(),
  followers_count: integer('followers_count', { mode: 'number' }),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const kb_starred_lists = sqliteTable('kb_starred_lists', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  github_slug: text('github_slug').notNull().unique(),
  description: text('description'),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const kb_repo_lists = sqliteTable('kb_repo_lists', {
  repo_id: integer('repo_id').notNull().references(() => kb_repos.id, { onDelete: 'cascade' }),
  list_id: integer('list_id').notNull().references(() => kb_starred_lists.id, { onDelete: 'cascade' }),
}, (t) => [
  unique().on(t.repo_id, t.list_id)
]);

export const kb_tags = sqliteTable('kb_tags', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  parent_id: integer('parent_id').references((): AnySQLiteColumn => kb_tags.id),
  color: text('color'),
  is_system: integer('is_system', { mode: 'boolean' }).default(false).notNull(),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const kb_repo_tags = sqliteTable('kb_repo_tags', {
  repo_id: integer('repo_id').notNull().references(() => kb_repos.id, { onDelete: 'cascade' }),
  tag_id: integer('tag_id').notNull().references(() => kb_tags.id, { onDelete: 'cascade' }),
}, (t) => [
  unique().on(t.repo_id, t.tag_id)
]);
