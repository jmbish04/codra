import { getDb } from '@server/db/client';
import { repositories, repoConfigs } from '@server/db/schemas';
import { eq, and } from 'drizzle-orm';
import { GitHubClient } from '@server/core/github';
import { loadRepoConfig } from '@server/core/config';
import { insertJob, supersedeOlderJobs, findAnyJobForHead, getMaxSeenPrNumber } from '@server/db/jobs';
import { logger } from '@server/core/logger';

/**
 * PRs opened before this date are never pulled by a sync — a floor that stops
 * years-old open PRs from being reviewed on a repo codra hasn't seen before.
 * For repos codra HAS reviewed, the per-repo PR-number watermark is the tighter
 * gate. ponytail: a constant is enough; make it a config row if it needs tuning.
 */
const SYNC_MIN_PR_CREATED_AT = '2026-07-23T00:00:00Z';

export type RepoSyncStat = {
  owner: string;
  repo: string;
  openPrs: number;
  enqueued: number;
  skipped: number;
  errors: number;
};

export type PrSyncSummary = {
  repos: RepoSyncStat[];
  totalEnqueued: number;
};

/**
 * Recovers PR reviews that live webhooks never produced (e.g. deliveries that
 * failed during an outage). For each enabled repo it asks GitHub for the
 * current open PRs and enqueues a review job for any PR head that has no job
 * yet. Idempotent: a head that already has a job (from a webhook or a prior
 * sync) is skipped, so re-running is safe.
 */
export type PrSyncProgress =
  | { type: 'start'; repoCount: number; message: string }
  | { type: 'repo'; owner: string; repo: string; index: number; repoCount: number; openPrs: number; enqueued: number; skipped: number; message: string }
  | { type: 'done'; totalEnqueued: number; repoCount: number; message: string };

export async function syncOpenPullRequests(
  env: Env,
  opts?: { repoFilter?: { owner: string; repo: string }; onProgress?: (e: PrSyncProgress) => void | Promise<void> },
): Promise<PrSyncSummary> {
  const db = getDb(env);
  const emit = async (e: PrSyncProgress) => { try { await opts?.onProgress?.(e); } catch { /* progress is best-effort */ } };

  const rows = await db.select({
    installation_id: repositories.installation_id,
    owner: repositories.owner,
    repo: repositories.repo,
  })
    .from(repoConfigs)
    .innerJoin(repositories, eq(repoConfigs.repository_id, repositories.id))
    .where(
      opts?.repoFilter
        ? and(
            eq(repositories.owner, opts.repoFilter.owner),
            eq(repositories.repo, opts.repoFilter.repo),
            eq(repoConfigs.enabled, true),
          )
        : eq(repoConfigs.enabled, true),
    )
    .all();

  const summary: PrSyncSummary = { repos: [], totalEnqueued: 0 };
  await emit({ type: 'start', repoCount: rows.length, message: `Scanning ${rows.length} enabled repo(s) for open pull requests…` });

  let index = 0;
  for (const row of rows) {
    index += 1;
    const installationId = String(row.installation_id);
    const client = new GitHubClient(env, installationId);
    const stat: RepoSyncStat = { owner: row.owner, repo: row.repo, openPrs: 0, enqueued: 0, skipped: 0, errors: 0 };

    try {
      const prs = await client.listOpenPullRequests(row.owner, row.repo);
      stat.openPrs = prs.length;

      const config = await loadRepoConfig(env, { installationId, owner: row.owner, repo: row.repo });
      if (config.enabled === false) {
        summary.repos.push(stat);
        continue;
      }

      // Per-repo watermark: only pull PRs newer than the highest PR codra
      // already registered for this repo. For never-seen repos, fall back to
      // the global date floor so ancient open PRs are not pulled.
      const watermark = await getMaxSeenPrNumber(env, { owner: row.owner, repo: row.repo });

      for (const pr of prs) {
        try {
          // Too old (repos codra hasn't seen) — before the floor.
          if (pr.createdAt < SYNC_MIN_PR_CREATED_AT) {
            stat.skipped++;
            continue;
          }
          // Not newer than what codra already has for this repo.
          if (watermark !== null && pr.number <= watermark) {
            stat.skipped++;
            continue;
          }
          const existing = await findAnyJobForHead(env, {
            owner: row.owner,
            repo: row.repo,
            prNumber: pr.number,
            commitSha: pr.headSha,
          });
          if (existing) {
            stat.skipped++;
            continue;
          }

          const job = await insertJob(env, {
            installationId,
            owner: row.owner,
            repo: row.repo,
            prNumber: pr.number,
            prTitle: pr.title,
            prAuthor: pr.authorLogin,
            prCreatedAt: pr.createdAt,
            commitSha: pr.headSha,
            baseSha: pr.baseSha,
            trigger: 'sync',
            headRef: pr.headRef,
            baseRef: pr.baseRef,
            configSnapshot: config.parsedJson,
          });

          await supersedeOlderJobs(env, {
            installationId,
            owner: row.owner,
            repo: row.repo,
            prNumber: pr.number,
            newJobId: job.id,
          });

          await env.REVIEW_QUEUE.send({
            jobId: job.id,
            deliveryId: crypto.randomUUID(),
            phase: 'prepare',
            requestId: crypto.randomUUID(),
          });

          stat.enqueued++;
          summary.totalEnqueued++;
        } catch (err) {
          stat.errors++;
          logger.error(
            `pr-sync failed for ${row.owner}/${row.repo}#${pr.number}`,
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      }
    } catch (err) {
      stat.errors++;
      logger.error(
        `pr-sync failed to list PRs for ${row.owner}/${row.repo}`,
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    summary.repos.push(stat);
    await emit({
      type: 'repo',
      owner: row.owner,
      repo: row.repo,
      index,
      repoCount: rows.length,
      openPrs: stat.openPrs,
      enqueued: stat.enqueued,
      skipped: stat.skipped,
      message: `${row.owner}/${row.repo}: ${stat.openPrs} open PR(s), ${stat.enqueued} queued${stat.skipped ? `, ${stat.skipped} skipped` : ''}`,
    });
  }

  await emit({ type: 'done', totalEnqueued: summary.totalEnqueued, repoCount: rows.length, message: `Done — queued ${summary.totalEnqueued} review(s) across ${rows.length} repo(s).` });
  return summary;
}
