import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * A Jules coding-agent session Codra stages when it detects a documentation
 * gap during a PR review. Staged at review time; launched only once the
 * triggering PR merges (Jules starts from GitHub HEAD).
 */
export const julesSessions = sqliteTable('jules_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  owner: text('owner').notNull(),
  repo: text('repo').notNull(),
  triggering_pr_number: integer('triggering_pr_number').notNull(),
  triggering_job_id: text('triggering_job_id'),
  // 'staged' | 'launched' | 'skipped' | 'error'
  state: text('state').notNull().default('staged'),
  prompt: text('prompt').notNull(),
  gap_summary: text('gap_summary').notNull(),
  session_id: text('session_id'),
  session_url: text('session_url'),
  session_state: text('session_state'),
  error_msg: text('error_msg'),
  pr_comment_id: integer('pr_comment_id'),
  // The PR this session opened (captured after launch) — links a reviewed PR
  // back to its Jules session so codra can direct corrections to it.
  created_pr_number: integer('created_pr_number'),
  created_pr_url: text('created_pr_url'),
  // Session origin/category. INTERNAL_CODRA = Codra created it; EXTERNAL_* =
  // a non-Codra Jules PR (CI-present vs not). Stamped INTERNAL_CODRA here.
  category: text('category').notNull().default('INTERNAL_CODRA'),
  // Cat-3 subcategory. Only 'docs' today; column exists so routing/dedup can
  // disambiguate future internal kinds.
  kind: text('kind').notNull().default('docs'),
  // Source paths Codra scoped the task to (docstring gaps). Persisted so later
  // verification can check Jules touched the right files.
  target_files: text('target_files', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  // Telemetry from SessionResource.automationMode (AUTO_CREATE_PR etc). Not a routing key.
  automation_mode: text('automation_mode'),
});
