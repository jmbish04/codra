import { sqliteTable, text, integer, unique, AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const kb_tags = sqliteTable('kb_tags', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  parent_id: integer('parent_id').references((): AnySQLiteColumn => kb_tags.id),
  color: text('color'),
  is_system: integer('is_system', { mode: 'boolean' }).default(false).notNull(),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
