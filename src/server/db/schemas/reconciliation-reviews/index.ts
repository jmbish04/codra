import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * codra's review verdicts for jules-merge reconciliations. Before an off-Worker
 * runner merges a reconciliation PR, it asks the Worker to review the staged
 * result; codra (Kimi) approves or rejects. Attempts per `reconciliation_key`
 * are counted here to drive a hard circuit breaker — never an unbounded merge loop.
 */
export const reconciliationReviews = sqliteTable('reconciliation_reviews', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  repository_id: integer('repository_id', { mode: 'number' }).notNull(),
  reconciliation_key: text('reconciliation_key').notNull(),
  attempt: integer('attempt', { mode: 'number' }).notNull(),
  pr_number: integer('pr_number', { mode: 'number' }),
  verdict: text('verdict').notNull(), // approved | rejected
  feedback: text('feedback'),
  summary: text('summary'),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index('idx_recon_key').on(t.reconciliation_key, t.created_at)]);
