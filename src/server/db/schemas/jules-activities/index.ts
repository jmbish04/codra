import { sqliteTable, text, integer, unique, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Cached snapshot of Jules session activities, persisted by the bounded poll /
 * external-watcher path (never by a per-request live Jules call). The monitoring
 * dashboard reads only from here, so a browser refresh is a cheap D1 read.
 *
 * `seq` is a monotonic surrogate used for stable ordering and as the opaque
 * `after` cursor. Dedup is by (session_id, activity_id).
 */
export const julesActivityCache = sqliteTable('jules_activity_cache', {
  seq: integer('seq', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  session_id: text('session_id').notNull(),
  task_id: text('task_id').notNull(),
  activity_id: text('activity_id').notNull(),
  type: text('type').notNull(),
  originator: text('originator'),
  name: text('name'),
  create_time: text('create_time'),
  description: text('description'),
  message: text('message'),
  title: text('title'),
  reason: text('reason'),
  plan_id: text('plan_id'),
  plan_json: text('plan_json'),        // { id, steps[] }
  artifacts_json: text('artifacts_json'), // JulesArtifact[]
  ingested_at: text('ingested_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  unique('uq_activity_session_id').on(t.session_id, t.activity_id),
  index('idx_activity_task_seq').on(t.task_id, t.seq),
]);

/** Per-session sync bookkeeping: when the cache was last refreshed. */
export const julesActivitySync = sqliteTable('jules_activity_sync', {
  session_id: text('session_id').primaryKey(),
  synced_at: text('synced_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
