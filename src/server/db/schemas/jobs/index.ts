import { sqliteTable, text, integer, blob, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { repositories } from '../repositories';

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  retry_of_job_id: text('retry_of_job_id'),
  check_run_id: integer('check_run_id', { mode: 'number' }),
  review_id: integer('review_id', { mode: 'number' }),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  started_at: text('started_at'),
  finished_at: text('finished_at'),
  repository_id: integer('repository_id').notNull().references(() => repositories.id),
  pr_number: integer('pr_number').notNull(),
  total_input_tokens: integer('total_input_tokens').default(0),
  total_output_tokens: integer('total_output_tokens').default(0),
  file_count: integer('file_count').default(0),
  comment_count: integer('comment_count').default(0),
  // Rollup of every file_reviews.total_cost_usd for this job (USD). Sum here
  // powers per-review and N-day dashboard cost without re-aggregating children.
  total_cost_usd: real('total_cost_usd'),
  overall_confidence_score: real('overall_confidence_score'),
  commit_sha: blob('commit_sha').notNull(),
  base_sha: blob('base_sha').notNull(),
  trigger: text('trigger').notNull(),
  // Which checks this job runs: { codeReview, docstring, toolbox }. NULL is the
  // legacy shape { codeReview: true, docstring: false, toolbox: false }.
  scope: text('scope', { mode: 'json' }),
  status: text('status').notNull().default('queued'),
  verdict: text('verdict'),
  pr_title: text('pr_title'),
  pr_author: text('pr_author'),
  // When the PR was opened on GitHub (ISO 8601). Distinct from created_at,
  // which is when codra registered the job. Used for display and the sync floor.
  pr_created_at: text('pr_created_at'),
  head_ref: text('head_ref'),
  base_ref: text('base_ref'),
  summary_model: text('summary_model'),
  overall_correctness: text('overall_correctness'),
  error_msg: text('error_msg'),
  summary_markdown: text('summary_markdown'),
  config_snapshot: text('config_snapshot', { mode: 'json' }),
  steps: text('steps', { mode: 'json' }).default('[]'),
  check_run_completed_at: text('check_run_completed_at'),
  lease_owner: text('lease_owner'),
  lease_expires_at: text('lease_expires_at'),
  heartbeat_at: text('heartbeat_at'),
  recovery_count: integer('recovery_count').notNull().default(0),
  last_queue_message_at: text('last_queue_message_at'),
  status_comment_id: integer('status_comment_id', { mode: 'number' }),
  // In-flight Workers AI async batch: the request id to poll, the model that
  // owns it, and the ordered file paths whose index maps to each response id.
  batch_request_id: text('batch_request_id'),
  batch_model: text('batch_model'),
  // Cloudflare account id the batch was queued on — a request_id is only
  // pollable from the account that submitted it.
  batch_account_id: text('batch_account_id'),
  batch_file_paths: text('batch_file_paths', { mode: 'json' }),
  // JSON: { violated: string[], checks: {practice,passed,violated}[], docs: CloudflareDocResult[] }
  best_practice_docs: text('best_practice_docs'),
  batch_submitted_at: text('batch_submitted_at'),
});
