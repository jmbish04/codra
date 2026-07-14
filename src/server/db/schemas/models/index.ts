import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const llmProviders = sqliteTable('llm_providers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull().unique(),
  api_format: text('api_format').notNull(),
  base_url: text('base_url'),
  encrypted_api_key: text('encrypted_api_key'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const modelConfigs = sqliteTable('model_configs', {
  model_id: text('model_id').primaryKey(),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  rpm: integer('rpm'),
  tpm: integer('tpm'),
  rpd: integer('rpd'),
  provider: text('provider').notNull(),
  provider_id: text('provider_id').notNull().references(() => llmProviders.id),
  model_name: text('model_name').notNull(),
});
