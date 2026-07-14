import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
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
});

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
