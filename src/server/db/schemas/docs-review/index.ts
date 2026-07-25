import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Rules that trigger a mandatory Cloudflare-docs review during a code review.
 * When a PR's diff matches `trigger`, codra consults the named Cloudflare docs
 * skill and checks the code against `criteria`; any gotchas become pending best
 * practices.
 */
export const docsReviewRules = sqliteTable('docs_review_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  // A regex (JS, case-insensitive) matched against changed file paths + the diff.
  trigger: text('trigger').notNull(),
  // Which bundled Cloudflare docs skill to consult:
  // 'agents-sdk' | 'workers-best-practices' | 'cloudflare-jedi' | 'cloudflare' | 'durable-objects'
  skill: text('skill').notNull(),
  // What to verify (free text — becomes part of the review prompt).
  criteria: text('criteria').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  sort_order: integer('sort_order').notNull().default(0),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
