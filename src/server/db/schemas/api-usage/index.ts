import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const apiUsage = sqliteTable('api_usage', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  prompt_tokens: integer('prompt_tokens').notNull().default(0),
  completion_tokens: integer('completion_tokens').notNull().default(0),
  total_tokens: integer('total_tokens').notNull().default(0),
  source: text('source').notNull(), // 'local' or 'gateway'
  gateway_id: text('gateway_id').notNull().default(''), // e.g. 'codra' or empty string for local
  datetime_hour: text('datetime_hour').notNull().default(''), // e.g. '2026-07-14 15:00:00' or empty string for local
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  gatewayUniqueIdx: uniqueIndex('gateway_unique_idx').on(
    table.source,
    table.provider,
    table.model,
    table.gateway_id,
    table.datetime_hour
  ),
}));
