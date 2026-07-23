import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { repositories } from '../repositories';

/**
 * Raw log of every webhook Gemini pushes to us (interaction.*, batch.*,
 * video.generated, …) — stored verbatim before any of it is acted on.
 */
export const geminiWebhookEvents = sqliteTable('gemini_webhook_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  received_at: text('received_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  /** The provider's `webhook-id` header; unique so redeliveries are deduped. */
  webhook_id: text('webhook_id').notNull().unique(),
  event_type: text('event_type').notNull(),
  interaction_id: text('interaction_id'),
  signature_verified: integer('signature_verified', { mode: 'boolean' }).notNull().default(false),
  payload: text('payload', { mode: 'json' }).notNull(),
});

/**
 * One row per in-flight Antigravity interaction. `file_index` maps the result
 * back onto jobs.batch_file_paths, mirroring the Workers AI batch path.
 */
export const antigravityInteractions = sqliteTable('antigravity_interactions', {
  interaction_id: text('interaction_id').primaryKey(),
  job_id: text('job_id').notNull(),
  file_index: integer('file_index').notNull(),
  status: text('status').notNull().default('in_progress'),
  output_text: text('output_text'),
  error: text('error'),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index('antigravity_interactions_job_idx').on(table.job_id)]);

export const webhookDeliveries = sqliteTable('webhook_deliveries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  received_at: text('received_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  repository_id: integer('repository_id').references(() => repositories.id),
  delivery_id: text('delivery_id').notNull().unique(),
  event_name: text('event_name').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
});
