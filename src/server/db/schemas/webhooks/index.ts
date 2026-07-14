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
});
