import { getDb } from '@server/db/client';
import { repositories, repoConfigs } from '@server/db/schemas';
import { eq, and } from 'drizzle-orm';
import { GitHubClient } from '@server/core/github';
import { loadRepoConfig } from '@server/core/config';
import { insertJob, supersedeOlderJobs, findAnyJobForHead } from '@server/db/jobs';
import { logger } from '@server/core/logger';

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
export async function syncOpenPullRequests(
  env: Env,
  opts?: { repoFilter?: { owner: string; repo: string } },
): Promise<PrSyncSummary> {
  const db = getDb(env);

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

  for (const row of rows) {
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

      for (const pr of prs) {
        try {
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
  }

  return summary;
}
