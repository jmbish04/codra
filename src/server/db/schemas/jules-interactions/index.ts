import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Index of every interaction codra has with a Jules session — the prompts codra
 * sends (launch, corrections directed at a Jules PR, poller improve/answer) and
 * their status. This is the single source of truth for "where a Jules task
 * stands," so codra never loses track of what it has asked Jules to do.
 *
 * A row with status 'started' is the signal that codra has kicked off a Jules
 * action (e.g. a correction on a reviewed PR).
 */
export const julesInteractions = sqliteTable('jules_interactions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  session_id: text('session_id'),
  repository: text('repository'),      // owner/repo
  pr_number: integer('pr_number', { mode: 'number' }),
  // outbound (codra → Jules) | inbound (Jules → codra)
  direction: text('direction').notNull().default('outbound'),
  // launch | correction | improve | answer | clarify | note
  kind: text('kind').notNull(),
  text: text('text'),
  // started | sent | error
  status: text('status').notNull().default('started'),
  error: text('error'),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  index('idx_jint_session').on(t.session_id, t.created_at),
  index('idx_jint_pr').on(t.repository, t.pr_number),
]);
