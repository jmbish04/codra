import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Liveness of external watcher agents (e.g. the local OpenTUI daemon on the Mac
 * that holds Jules `session.stream()` open and pings the worker on activity).
 * One row per agent; the daemon upserts a heartbeat on a regular cadence so the
 * dashboard — and the cron fallback — know whether the real-time watcher is alive.
 */
export const agentHeartbeats = sqliteTable('agent_heartbeats', {
  agent_id: text('agent_id').primaryKey(),
  hostname: text('hostname'),
  version: text('version'),
  active_sessions: integer('active_sessions', { mode: 'number' }).notNull().default(0),
  last_seen_at: text('last_seen_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
