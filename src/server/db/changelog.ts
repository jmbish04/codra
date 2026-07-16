import { eq, desc } from 'drizzle-orm';
import { getDb, parseJsonColumn } from './client';
import { changelogEntries, repositories } from './schemas';
import { changelogDetailSchema, changelogEntrySchema, type ChangelogChange, type ChangelogDetail } from '@shared/schema';

/** Public slug for a PR's changelog: owner-repo-pr12-abc1234. */
export function buildChangelogSlug(input: { owner: string; repo: string; prNumber: number; commitSha: string }) {
  const safe = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${safe(input.owner)}-${safe(input.repo)}-pr${input.prNumber}-${input.commitSha.slice(0, 7)}`;
}

export async function upsertChangelogEntry(
  env: Pick<Env, 'DB'>,
  input: {
    slug: string;
    jobId: string;
    repositoryId: number;
    prNumber: number;
    prUrl: string | null;
    headRef: string | null;
    commitSha: string | null;
    tag: string | null;
    area: string;
    title: string;
    summary: string;
    date: string;
    changes: ChangelogChange[];
    detail: ChangelogDetail;
  },
) {
  const db = getDb(env);
  const values = {
    slug: input.slug,
    job_id: input.jobId,
    repository_id: input.repositoryId,
    pr_number: input.prNumber,
    pr_url: input.prUrl,
    head_ref: input.headRef,
    commit_sha: input.commitSha,
    tag: input.tag,
    area: input.area,
    title: input.title,
    summary: input.summary,
    date: input.date,
    changes_json: input.changes,
    detail_json: input.detail,
  };

  await db.insert(changelogEntries).values(values).onConflictDoUpdate({
    target: changelogEntries.slug,
    set: { ...values, updated_at: new Date().toISOString() },
  });

  return input.slug;
}

function mapEntry(row: any) {
  return changelogEntrySchema.parse({
    slug: row.changelog_entries.slug,
    jobId: row.changelog_entries.job_id,
    owner: row.repositories.owner,
    repo: row.repositories.repo,
    prNumber: row.changelog_entries.pr_number,
    prUrl: row.changelog_entries.pr_url,
    headRef: row.changelog_entries.head_ref,
    commitSha: row.changelog_entries.commit_sha,
    tag: row.changelog_entries.tag,
    area: row.changelog_entries.area,
    title: row.changelog_entries.title,
    summary: row.changelog_entries.summary,
    date: row.changelog_entries.date,
    changes: parseJsonColumn(row.changelog_entries.changes_json, []),
    // Re-validate on read: the row was written from model output, and the
    // schema may have moved on since.
    detail: row.changelog_entries.detail_json
      ? changelogDetailSchema.parse(parseJsonColumn(row.changelog_entries.detail_json, {}))
      : null,
    createdAt: row.changelog_entries.created_at,
  });
}

export async function getChangelogEntry(env: Pick<Env, 'DB'>, slug: string) {
  const db = getDb(env);
  const row = await db
    .select()
    .from(changelogEntries)
    .innerJoin(repositories, eq(changelogEntries.repository_id, repositories.id))
    .where(eq(changelogEntries.slug, slug))
    .get();

  return row ? mapEntry(row) : null;
}

export async function getChangelogEntryForJob(env: Pick<Env, 'DB'>, jobId: string) {
  const db = getDb(env);
  const row = await db
    .select()
    .from(changelogEntries)
    .innerJoin(repositories, eq(changelogEntries.repository_id, repositories.id))
    .where(eq(changelogEntries.job_id, jobId))
    .get();

  return row ? mapEntry(row) : null;
}

export async function listChangelogEntries(env: Pick<Env, 'DB'>, limit = 50, offset = 0) {
  const db = getDb(env);
  const rows = await db
    .select()
    .from(changelogEntries)
    .innerJoin(repositories, eq(changelogEntries.repository_id, repositories.id))
    .orderBy(desc(changelogEntries.created_at))
    .limit(limit)
    .offset(offset)
    .all();

  return rows.map(mapEntry);
}
