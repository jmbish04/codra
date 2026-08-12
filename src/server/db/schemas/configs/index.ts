import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { repositories } from '../repositories';

export const repoConfigs = sqliteTable('repo_configs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  repository_id: integer('repository_id').notNull().references(() => repositories.id).unique(),
  // Code Review auto-trigger. The two flags below are independent auto-toggles
  // for the DocString Enforcer (Jules docs-gap) and Toolbox Watcher
  // (core-github-standardization) checks; both default off.
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  docstring_enabled: integer('docstring_enabled', { mode: 'boolean' }).notNull().default(false),
  toolbox_enabled: integer('toolbox_enabled', { mode: 'boolean' }).notNull().default(false),
  external_jules_enabled: integer('external_jules_enabled', { mode: 'boolean' }).notNull().default(false),
  main_model: text('main_model'),
  parsed_json: text('parsed_json', { mode: 'json' }),
  fallback_models: text('fallback_models', { mode: 'json' }).default('[]'),
  size_overrides: text('size_overrides', { mode: 'json' }),
});
