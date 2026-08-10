import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { jobs } from '../jobs';

export const fileReviews = sqliteTable('file_reviews', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  job_id: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  diff_line_count: integer('diff_line_count'),
  input_tokens: integer('input_tokens'),
  output_tokens: integer('output_tokens'),
  duration_ms: integer('duration_ms'),
  confidence_score: real('confidence_score'),
  file_status: text('file_status').notNull(),
  verdict: text('verdict'),
  file_path: text('file_path').notNull(),
  model_used: text('model_used').notNull(),
  model_provider: text('model_provider'),
  overall_correctness: text('overall_correctness'),
  file_summary: text('file_summary'),
  error_msg: text('error_msg'),
  diff_input: text('diff_input'),
  raw_ai_output: text('raw_ai_output'),
  transient_error_count: integer('transient_error_count').notNull().default(0),
  // Rollup of file_review_costs.total_cost for this file (USD). Snapshotted at
  // review time so historical cost reflects the price then, not current rates.
  total_cost_usd: real('total_cost_usd'),
  engine_used: text('engine_used'),
  cache_read_tokens: integer('cache_read_tokens'),
  cache_write_tokens: integer('cache_write_tokens'),
  // JSON: BestPracticeCheck[] — per-file best-practice pass/violation results.
  best_practice_checks: text('best_practice_checks'),
});

// Per-usage-type cost breakdown for a single file review. One row per usage
// type (ai_input_tokens, ai_output_tokens, do_requests, do_duration_ms,
// d1_rows_read, d1_rows_written, subrequests). Cost is a stored snapshot:
// total_cost = usage_amount / per_units * unit_price, priced at review time.
export const fileReviewCosts = sqliteTable('file_review_costs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  file_review_id: text('file_review_id').notNull().references(() => fileReviews.id, { onDelete: 'cascade' }),
  // Denormalized so N-day dashboard aggregation can group by job without a join.
  job_id: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  usage_type: text('usage_type').notNull(),
  usage_amount: real('usage_amount').notNull().default(0),
  unit_price: real('unit_price').notNull().default(0),
  per_units: real('per_units').notNull().default(1),
  currency: text('currency').notNull().default('USD'),
  total_cost: real('total_cost').notNull().default(0),
  rate_source: text('rate_source').notNull().default('fallback'), // 'core-guardian' | 'fallback'
  priced_at: integer('priced_at').notNull().default(0), // epoch ms of the rate snapshot
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  fileReviewIdx: index('file_review_costs_file_review_idx').on(table.file_review_id),
  jobIdx: index('file_review_costs_job_idx').on(table.job_id),
}));

export const reviewComments = sqliteTable('review_comments', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  file_review_id: text('file_review_id').notNull().references(() => fileReviews.id, { onDelete: 'cascade' }),
  line: integer('line'),
  position: integer('position'),
  path: text('path').notNull(),
  severity: text('severity').notNull(),
  category: text('category').notNull().default('quality'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  code_suggestion: text('code_suggestion'),
});
