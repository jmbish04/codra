import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * A durable record of every PR codra opens on its own — standardization/
 * housekeeping today, missing-code or improvement PRs later. Captures what it
 * did, why (its reasoning), the PR it opened, and which PR review triggered it.
 */
export const agentActions = sqliteTable('agent_actions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  owner: text('owner').notNull(),
  repo: text('repo').notNull(),
  // What kind of action: 'standardization' | 'improvement' | ...
  action_type: text('action_type').notNull(),
  // Human-readable summary of the change and the reasoning behind it.
  summary: text('summary').notNull(),
  // JSON array of file paths codra changed.
  files: text('files', { mode: 'json' }),
  // The PR codra opened.
  pr_number: integer('pr_number'),
  pr_url: text('pr_url'),
  // The PR whose review triggered this action, and codra's job for it.
  triggering_pr_number: integer('triggering_pr_number'),
  triggering_job_id: text('triggering_job_id'),
});
