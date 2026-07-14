import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

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
