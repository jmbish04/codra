import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Stateless Jules orchestration tracking — the global, cross-repo directory of
 * Jules planning sessions codra is supervising. Lives in D1 (NOT a Durable
 * Object): a DO's blocking loops bill wall-clock active-duration and its
 * embedded SQLite is easy to flood — this table is advanced only by short,
 * bounded cron ticks and webhook events, so cost stays flat.
 *
 * `task_id` is a fresh uuid per session, the correlation key for the (future /
 * external) webhook route and the global report.
 */
export const julesOrchestrationTasks = sqliteTable('jules_orchestration_tasks', {
  task_id: text('task_id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  package_id: text('package_id').notNull(),
  repository_id: integer('repository_id', { mode: 'number' }).notNull(),
  session_id: text('session_id'),
  // pending | planning | plan_review | awaiting_feedback | executing | pr_ready | accepted | stuck | failed
  status: text('status').notNull().default('pending'),
  iterations: integer('iterations', { mode: 'number' }).notNull().default(0),
  last_pr_url: text('last_pr_url'),
  error: text('error'),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  index('idx_jot_status').on(t.status),
  index('idx_jot_session').on(t.session_id),
  index('idx_jot_package').on(t.package_id),
]);

/** Append-only audit trail of state transitions — powers the global report. */
export const julesOrchestrationEvents = sqliteTable('jules_orchestration_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  task_id: text('task_id').notNull(),
  event: text('event').notNull(),
  payload: text('payload'),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index('idx_joe_task').on(t.task_id, t.created_at)]);
