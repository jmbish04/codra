import { Hono } from 'hono';
import type { Context } from 'hono';
import { isSupportedGitHubWebhookEvent, type GitHubWebhookPayload } from '@shared/github';
import type { AppEnv } from '@server/env';
import { loadRepoConfig } from '@server/core/config';
import { extractReviewRequest, cancelReviewsForClosedPr } from '@server/core/review';
import { verifyGitHubWebhookSignature } from '@server/core/verify';
import { jsonError } from '@server/core/http';
import { countAutoReviewsForPr, findExistingJobForHead, insertJob, supersedeOlderJobs } from '@server/db/jobs';
import { recordWebhookDelivery, finalizeWebhookDelivery, type DeliveryOutcome } from '@server/db/webhook-deliveries';
import { getWorkerApiKey } from '@server/utils/secrets';
import { notifyJobsChanged } from '@server/core/jobs-feed';
import { GitHubClient } from '@server/core/github';

// Auto (non-mention, non-retry) reviews are capped per PR so a chatty push
// history can't burn review budget forever; @mention and manual retry always
// bypass this cap.
const MAX_AUTO_REVIEWS_PER_PR = 3;

/**
 * handleGitHubWebhook
 */
export async function handleGitHubWebhook(c: Context<AppEnv>) {
    const eventName = c.req.header('x-github-event');
    const deliveryId = c.req.header('x-github-delivery');
    const signature = c.req.header('x-hub-signature-256');
    const rawBody = await c.req.text();

    if (!eventName || !deliveryId) {
      // No delivery id means nothing to record or de-duplicate against.
      return jsonError('Missing GitHub webhook headers.', 400);
    }

    // Record the delivery BEFORE verifying, so rejected and failed deliveries
    // are visible on the dashboard too. Never let a recording failure block
    // webhook processing.
    const inserted = await recordWebhookDelivery(c.env, {
      deliveryId,
      eventName,
      owner: null,
      repo: null,
      payload: rawBody,
    }).catch(() => true);

    // `owner`/`repo` become known after the payload parses; finish() links them.
    let owner: string | null = null;
    let repo: string | null = null;

    // Finalize the delivery's outcome and return the response. Only the first
    // sighting of a delivery id (inserted === true) writes an outcome, so a
    // duplicate retry never clobbers the original delivery's recorded result.
    /**
     * finish
     */
    const finish = async (
      status: 200 | 202 | 401 | 500,
      body: Record<string, unknown>,
      outcome: DeliveryOutcome,
      extra?: { action?: string; prNumber?: number; jobId?: string; error?: string },
    ) => {
      if (inserted) {
        await finalizeWebhookDelivery(c.env, deliveryId, { outcome, owner, repo, ...extra }).catch(() => {});
      }
      return c.json(body, status);
    };

    const webhookSecret = await getWorkerApiKey(c.env);
    const verified = await verifyGitHubWebhookSignature(webhookSecret, signature ?? null, rawBody);
    if (!verified) {
      return finish(401, { ok: false, error: 'Invalid webhook signature.' }, 'rejected_signature');
    }

    // Duplicate delivery (GitHub retry with the same id): acknowledge without
    // reprocessing or overwriting the original outcome.
    if (!inserted) {
      return c.json({ ok: true, duplicate: true }, 202);
    }

    let payload: GitHubWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as GitHubWebhookPayload;
    } catch {
      await finalizeWebhookDelivery(c.env, deliveryId, { outcome: 'invalid_payload' }).catch(() => {});
      return jsonError('Invalid webhook JSON payload.', 400);
    }

    if ('repository' in payload && payload.repository) {
      owner = payload.repository.owner.login;
      repo = payload.repository.name;
    }

    try {
      const installationId = String(payload.installation?.id ?? '');
      if (!('repository' in payload) || !payload.repository) {
        return finish(202, { ok: true, ignored: true }, 'ignored_no_repository');
      }

      if (!isSupportedGitHubWebhookEvent(eventName)) {
        return finish(202, { ok: true, ignored: true, eventName }, 'ignored_unsupported_event');
      }

      if (['star', 'watch', 'fork'].includes(eventName)) {
        const { upsertRepo } = await import('@server/db/knowledge-base');

        if (eventName === 'star') {
          const starPayload = payload as import('@shared/github').StarWebhookPayload;
          await upsertRepo(c.env, {
            github_id: starPayload.repository.id,
            full_name: starPayload.repository.full_name,
            language: starPayload.repository.language,
            topics: starPayload.repository.topics,
            is_starred: starPayload.action === 'created',
            stargazers_count: starPayload.repository.stargazers_count,
          });
        } else if (eventName === 'watch') {
          const watchPayload = payload as import('@shared/github').WatchWebhookPayload;
          if (watchPayload.action === 'started') {
            await upsertRepo(c.env, {
              github_id: watchPayload.repository.id,
              full_name: watchPayload.repository.full_name,
              language: watchPayload.repository.language,
              topics: watchPayload.repository.topics,
              is_watched: true,
              stargazers_count: watchPayload.repository.stargazers_count,
            });
          }
        } else if (eventName === 'fork') {
          const forkPayload = payload as import('@shared/github').ForkWebhookPayload;
          await upsertRepo(c.env, {
            github_id: forkPayload.forkee.id,
            full_name: forkPayload.forkee.full_name,
            language: forkPayload.forkee.language,
            topics: forkPayload.forkee.topics,
            is_forked_by_me: true,
            stargazers_count: forkPayload.forkee.stargazers_count,
          });
        }

        return finish(202, { ok: true, message: 'kb_updated' }, 'kb_updated', { action: 'kb_update' });
      }

      if (!installationId) {
        return finish(202, { ok: true, ignored: true }, 'ignored_no_installation');
      }

      // A PR that was merged/closed should cancel any review codra still has
      // queued or running for it, with a comment linking the cancelled job.
      if (eventName === 'pull_request') {
        const prPayload = payload as import('@shared/github').PullRequestWebhookPayload;
        // Fast-path: link a PR event to a Jules orchestration task by its recorded url
        // (canonical GitHub html_url, matching what the poller stores from the snapshot).
        const prUrl = `https://github.com/${payload.repository.owner.login}/${payload.repository.name}/pull/${prPayload.pull_request.number}`;
        {
          const { markPrReadyByUrl } = await import('@server/db/jules-orchestration');
          c.executionCtx.waitUntil(markPrReadyByUrl(c.env, prUrl).catch(() => false));
        }
        if (prPayload.action === 'closed') {
          const prNumber = prPayload.pull_request.number;
          const merged = prPayload.pull_request.merged === true;
          const owner = payload.repository.owner.login;
          const repo = payload.repository.name;

          // A CLOSED (not merged) codra housekeeping PR means the maintainers
          // rejected those standard files — never propose them again.
          if (!merged && prPayload.pull_request.head?.ref?.startsWith('codra/housekeeping')) {
            try {
              const { getHousekeepingPrFiles, recordDismissedStandards } = await import('@server/db/dismissed-standards');
              const files = await getHousekeepingPrFiles(c.env, owner, repo, prNumber);
              await recordDismissedStandards(c.env, { owner, repo, targetPaths: files, closedPrNumber: prNumber });
            } catch (err) {
              console.error('Failed to record dismissed standards:', err);
            }
          }

          const gh = new GitHubClient(c.env, installationId);
          const cancelled = await cancelReviewsForClosedPr(
            c.env,
            gh,
            { owner: payload.repository.owner.login, repo: payload.repository.name, prNumber },
            merged ? 'merged' : 'closed',
          ).catch((err) => { console.error('Failed to cancel reviews for closed PR:', err); return 0; });

          if (merged) {
            const { launchStagedJulesSessions } = await import('@server/core/jules');
            c.executionCtx.waitUntil(
              launchStagedJulesSessions(c.env, gh, { owner, repo, prNumber })
                .catch((err) => console.error('Jules launch on merge failed:', err)),
            );
          }

          return finish(
            202,
            { ok: true, message: 'pr_closed', cancelledReviews: cancelled },
            cancelled > 0 ? 'review_cancelled' : 'no_action',
            cancelled > 0 ? { action: 'review_cancelled', prNumber } : { prNumber },
          );
        }
      }

      const repoConfig = await loadRepoConfig(c.env, {
        installationId,
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
      });

      if (repoConfig.enabled === false) {
        return finish(202, { ok: true, ignored: true, reason: 'repository_disabled' }, 'ignored_repo_disabled');
      }

      const extracted = extractReviewRequest({
        eventName,
        payload,
        botUsername: c.env.BOT_USERNAME,
        config: repoConfig.parsedJson,
      });

      if (extracted?.trigger === 'mention' && eventName === 'issue_comment' && 'comment' in payload && payload.comment?.id) {
        try {
          const gh = new GitHubClient(c.env, installationId);
          await gh.createIssueCommentReaction(
            extracted.owner,
            extracted.repo,
            payload.comment.id,
            'eyes'
          );
        } catch (err) {
          console.error('Failed to add emoji reaction to comment:', err);
        }
      }

      if (extracted?.commitSha && extracted.baseSha) {
        const existingJob = await findExistingJobForHead(c.env, {
          owner: extracted.owner,
          repo: extracted.repo,
          prNumber: extracted.prNumber,
          commitSha: extracted.commitSha,
          trigger: extracted.trigger,
        });

        if (existingJob) {
          return finish(202, {
            ok: true,
            duplicate: true,
            message: existingJob.status === 'queued' ? 'queued' : 'duplicate',
            job: existingJob,
          }, 'job_created', { action: 'review', prNumber: extracted.prNumber, jobId: existingJob.id });
        }

        if (extracted.trigger === 'auto') {
          const autoCount = await countAutoReviewsForPr(c.env, {
            installationId: extracted.installationId,
            owner: extracted.owner, repo: extracted.repo, prNumber: extracted.prNumber,
          });
          if (autoCount >= MAX_AUTO_REVIEWS_PER_PR) {
            return finish(202, {
              ok: true, ignored: true, reason: 'auto_review_cap_reached',
              message: `Automatic review cap (${MAX_AUTO_REVIEWS_PER_PR}) reached for PR #${extracted.prNumber}. Comment ${c.env.BOT_USERNAME ? '@' + c.env.BOT_USERNAME + ' review' : 'the review trigger'} to run another.`,
            }, 'ignored_auto_cap', { prNumber: extracted.prNumber });
          }
        }

        const job = await insertJob(c.env, {
          installationId: extracted.installationId,
          owner: extracted.owner,
          repo: extracted.repo,
          prNumber: extracted.prNumber,
          prTitle: extracted.prTitle,
          prAuthor: extracted.prAuthor,
          prCreatedAt: extracted.prCreatedAt,
          commitSha: extracted.commitSha,
          baseSha: extracted.baseSha,
          trigger: extracted.trigger,
          headRef: extracted.headRef,
          baseRef: extracted.baseRef,
          configSnapshot: repoConfig.parsedJson,
        });

        await supersedeOlderJobs(c.env, {
          installationId: extracted.installationId,
          owner: extracted.owner,
          repo: extracted.repo,
          prNumber: extracted.prNumber,
          newJobId: job.id,
        });

        // Enqueue the job for the review pipeline (runReviewJob). This is the
        // path that actually processes the job, updates its status, posts the
        // formatted review, and runs test detection.
        await c.env.REVIEW_QUEUE.send({
          jobId: job.id,
          deliveryId,
          phase: 'prepare',
          requestId: c.get('requestId'),
        });
        c.executionCtx.waitUntil(notifyJobsChanged(c.env, { jobId: job.id, status: 'queued' }));

        return finish(202, { ok: true, message: 'queued', job }, 'job_created', {
          action: 'review',
          prNumber: extracted.prNumber,
          jobId: job.id,
        });
      }

      // Events that do not produce a concrete job, such as PR close cleanup or
      // mention events that need PR lookup, are still handled by the worker.
      await c.env.REVIEW_QUEUE.send({
        deliveryId,
        eventName,
        requestId: c.get('requestId'),
      });

      return finish(202, { ok: true, message: 'queued' }, 'queued', { action: 'queued' });
    } catch (err) {
      return finish(500, { ok: false, error: 'Webhook processing failed.' }, 'error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
}

/**
 * createWebhookRouter
 */
export function createWebhookRouter() {
  const app = new Hono<AppEnv>();

  app.post('/', handleGitHubWebhook);

  return app;
}
