import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Queue of jules-fleet / jules-merge CLI runs. The Worker CANNOT execute these
 * (both packages import node:child_process + node:fs — not available on Workers).
 * The Worker only queues + tracks; an off-Worker runner (the Mac daemon, Node/Bun,
 * or a GitHub Action) claims a job, runs the real CLI, and reports the result back.
 */
export const fleetJobs = sqliteTable('fleet_jobs', {
  job_id: text('job_id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  repository_id: integer('repository_id', { mode: 'number' }).notNull(),
  // init | analyze | dispatch | merge
  kind: text('kind').notNull(),
  params_json: text('params_json'),
  // queued | running | completed | failed
  status: text('status').notNull().default('queued'),
  result_json: text('result_json'),
  error: text('error'),
  claimed_by: text('claimed_by'),
  created_by: text('created_by'),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index('idx_fleet_jobs_status').on(t.status, t.created_at)]);
