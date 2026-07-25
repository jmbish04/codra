import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { jobs } from '../jobs';

/**
 * The running list of things codra decided to test while reviewing a PR — a
 * read-only API endpoint, an MCP tool, or a frontend page. Populated during
 * review (detection); executed afterwards (Phase 2/3). One row per target.
 */
export const testTargets = sqliteTable('test_targets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  job_id: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),

  owner: text('owner').notNull(),
  repo: text('repo').notNull(),
  pr_number: integer('pr_number').notNull(),

  // 'api' | 'mcp' | 'frontend'
  kind: text('kind').notNull(),
  // For api: GET/HEAD. For mcp/frontend: null.
  method: text('method'),
  // API route (e.g. /api/jobs/:id), MCP tool name, or frontend page path.
  target: text('target').notNull(),
  // Why codra chose to test it (one line, from the code review).
  reason: text('reason'),
  // JSON: params/args codra will send (derived from the reviewed code).
  params: text('params', { mode: 'json' }),

  // Execution outcome (Phase 2/3).
  // 'pending' | 'passed' | 'failed' | 'blocked_auth' | 'skipped' | 'error'
  status: text('status').notNull().default('pending'),
  status_code: integer('status_code'),
  // JSON: response body sample / findings / assertions.
  result: text('result', { mode: 'json' }),
  // Cloudflare Images URL for a frontend screenshot.
  screenshot_url: text('screenshot_url'),
  error: text('error'),
});
