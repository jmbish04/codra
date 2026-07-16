import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { repositories } from '../repositories';
import { jobs } from '../jobs';

/**
 * Per-PR changelog entries, written by the `changelog` phase after a review
 * completes. The detail page at /changelog/:slug is built entirely from these
 * rows. One entry per job — Codra's grouping is already the PR, so there is no
 * separate branches table.
 */
export const changelogEntries = sqliteTable(
  'changelog_entries',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    /** Stable public slug — the detail page URL and the dedupe key. */
    slug: text('slug').notNull().unique(),
    job_id: text('job_id').notNull().references(() => jobs.id),
    repository_id: integer('repository_id').notNull().references(() => repositories.id),
    pr_number: integer('pr_number').notNull(),
    pr_url: text('pr_url'),
    head_ref: text('head_ref'),
    commit_sha: text('commit_sha'),
    tag: text('tag'),
    area: text('area').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    date: text('date').notNull(),
    /** ChangelogChange[]: [{ kind, text }]. */
    changes_json: text('changes_json', { mode: 'json' }),
    /**
     * ChangelogDetail: problem, approach, apiChanges[], filesTouched[],
     * migrations[{tag,sql}], code[], diagrams[]. Model-authored, so every
     * consumer must treat the contents as untrusted.
     */
    detail_json: text('detail_json', { mode: 'json' }),
    created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    jobIdx: index('changelog_entries_job_idx').on(t.job_id),
    repoPrIdx: index('changelog_entries_repo_pr_idx').on(t.repository_id, t.pr_number),
    createdIdx: index('changelog_entries_created_idx').on(t.created_at),
  }),
);
