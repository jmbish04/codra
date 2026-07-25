import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { repositories } from '../repositories';

export const webhookDeliveries = sqliteTable('webhook_deliveries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  received_at: text('received_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  repository_id: integer('repository_id').references(() => repositories.id),
  delivery_id: text('delivery_id').notNull().unique(),
  event_name: text('event_name').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  // Outcome of processing this delivery (finalized at each handler exit). See
  // DeliveryOutcome in src/server/db/webhook-deliveries.ts.
  outcome: text('outcome').notNull().default('received'),
  // The codra action the delivery triggered, if any (e.g. 'review', 'kb_update').
  action: text('action'),
  // The PR the delivery concerns, when applicable.
  pr_number: integer('pr_number'),
  // The review job created for this delivery, when one was.
  job_id: text('job_id'),
  // Error message when outcome = 'error'.
  error: text('error'),
});
