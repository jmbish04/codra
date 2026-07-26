import { sqliteTable, text, integer, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Standard files a repo's maintainers rejected: when a codra housekeeping PR is
 * CLOSED (not merged), the standard file paths it contained go here, and codra
 * never proposes a chore for those paths again. New standard files added later
 * are unaffected — only the closed ones are excluded.
 */
export const dismissedStandards = sqliteTable('dismissed_standards', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  owner: text('owner').notNull(),
  repo: text('repo').notNull(),
  target_path: text('target_path').notNull(),
  closed_pr_number: integer('closed_pr_number'),
}, (t) => [
  unique().on(t.owner, t.repo, t.target_path),
]);
