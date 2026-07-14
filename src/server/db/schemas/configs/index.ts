import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { repositories } from '../repositories';

export const repoConfigs = sqliteTable('repo_configs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  repository_id: integer('repository_id').notNull().references(() => repositories.id).unique(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  main_model: text('main_model'),
  parsed_json: text('parsed_json', { mode: 'json' }),
  fallback_models: text('fallback_models', { mode: 'json' }).default('[]'),
  size_overrides: text('size_overrides', { mode: 'json' }),
});
