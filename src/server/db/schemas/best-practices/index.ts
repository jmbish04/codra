import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const infrastructures = sqliteTable('infrastructures', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const bestPractices = sqliteTable('best_practices', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  infra_id: text('infra_id').notNull().references(() => infrastructures.id),
  criteria: text('criteria').notNull(),
  instructions: text('instructions').notNull(), // PlateJS JSON structure as text
  is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});
