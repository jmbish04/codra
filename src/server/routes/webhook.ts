import { Hono } from 'hono';
import type { Context } from 'hono';
import { isSupportedGitHubWebhookEvent, type GitHubWebhookPayload } from '@shared/github';
import type { AppEnv } from '@server/env';
import { loadRepoConfig } from '@server/core/config';
import { extractReviewRequest, cancelReviewsForClosedPr } from '@server/core/review';
import { verifyGitHubWebhookSignature } from '@server/core/verify';
import { jsonError } from '@server/core/http';
import { countAutoReviewsForPr, findActiveJobsForPr, findExistingJobForHead, insertJob, MAX_AUTO_REVIEWS_PER_PR } from '@server/db/jobs';
import { recordWebhookDelivery, finalizeWebhookDelivery, type DeliveryOutcome } from '@server/db/webhook-deliveries';
import { getWorkerApiKey } from '@server/utils/secrets';
import { notifyJobsChanged } from '@server/core/jobs-feed';
import { GitHubClient } from '@server/core/github';

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
    // are visible on the dashboard too. `inserted` is true for the first
    // sighting of a delivery id and false for a GitHub retry of one already
    // recorded (onConflictDoNothing). A genuine insert failure (e.g. payload
    // over D1's size limit) must NOT be treated as a fresh delivery — doing so
    // would re-queue duplicate review jobs on every retry — so we abort with a
    // 500 and let GitHub retry against a hopefully-recovered DB instead.
    let inserted: boolean;
    try {
      inserted = await recordWebhookDelivery(c.env, {
        deliveryId,
        eventName,
        payload: rawBody,
      });
    } catch (err) {
      console.error('Failed to record webhook delivery:', err);
      return jsonError('Failed to record webhook delivery.', 500);
    }

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

      if (eventName === 'check_run' || eventName === 'check_suite' || eventName === 'workflow_run') {
        const p = payload as import('@shared/github').CheckWebhookPayload;
        const detail = p.check_run ?? p.check_suite ?? p.workflow_run;
        if (p.action !== 'completed' || !detail || (detail.conclusion !== 'failure' && detail.conclusion !== 'timed_out')) {
          return finish(202, { ok: true, ignored: true }, 'no_action');
        }
        if (!installationId) {
          return finish(202, { ok: true, message: 'ci_failure_noted' }, 'no_action');
        }

        const ciRepoConfig = await loadRepoConfig(c.env, {
          installationId, owner: p.repository.owner.login, repo: p.repository.name,
        });
        if (!ciRepoConfig.externalJulesEnabled) {
          return finish(202, { ok: true, message: 'ci_failure_noted' }, 'no_action');
        }

        const { classifyAndLinkJulesPr, enqueueExternalReview } = await import('@server/core/jules-pr');
        const gh = new GitHubClient(c.env, installationId);

        // GitHub omits `pull_requests` for fork PRs and checks created before the
        // PR link existed — fall back to resolving PRs by the failing commit SHA.
        let prNumbers = (detail.pull_requests ?? []).map((prRef) => prRef.number);
        if (prNumbers.length === 0 && detail.head_sha) {
          prNumbers = await gh.listPullRequestNumbersForCommit(p.repository.owner.login, p.repository.name, detail.head_sha);
        }
        if (prNumbers.length === 0) {
          return finish(202, { ok: true, message: 'ci_failure_noted' }, 'no_action');
        }

        let queuedJobId: string | undefined;
        for (const prNumber of prNumbers) {
          try {
            const pr = await gh.getPullRequest(p.repository.owner.login, p.repository.name, prNumber);
            // The SHA-fallback endpoint returns closed/merged PRs too — never
            // review one (a delayed CI failure on a just-merged commit).
            if (pr.state && pr.state !== 'open') continue;
            // The PR may have moved on since this CI run started — only review
            // when the failing commit is still the PR head; otherwise wait for
            // the new commit's own CI-completion webhook.
            if (detail.head_sha && pr.head.sha !== detail.head_sha) continue;
            const link = await classifyAndLinkJulesPr(c.env, {
              owner: p.repository.owner.login, repo: p.repository.name, prNumber,
              prUrl: `https://github.com/${p.repository.owner.login}/${p.repository.name}/pull/${prNumber}`,
              body: pr.body, headRef: pr.head.ref,
            });
            if (link.kind !== 'external') continue;
            const jobId = await enqueueExternalReview(c.env, gh, {
              owner: p.repository.owner.login, repo: p.repository.name, prNumber,
              installationId, configSnapshot: ciRepoConfig.parsedJson, deliveryId, requestId: c.get('requestId'),
            });
            if (jobId) queuedJobId = jobId;
          } catch (err) {
            console.error('Failed to route CI-failure PR to external review:', err);
          }
        }
        return finish(
          202,
          { ok: true, message: queuedJobId ? 'queued' : 'ci_failure_noted' },
          queuedJobId ? 'job_created' : 'no_action',
          queuedJobId ? { action: 'review', jobId: queuedJobId } : undefined,
        );
      }

      if (!installationId) {
        return finish(202, { ok: true, ignored: true }, 'ignored_no_installation');
      }

      const repoConfig = await loadRepoConfig(c.env, {
        installationId,
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
      });

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

        // Jules opens PRs as the authenticating user (not a bot), so the isBotSender
        // gate does not catch them. Recognize Codra's own Jules docs PRs and divert
        // them out of the paid standard review; link the PR to its session.
        const { classifyAndLinkJulesPr, enqueueExternalReview } = await import('@server/core/jules-pr');
        const link = await classifyAndLinkJulesPr(c.env, {
          owner: payload.repository.owner.login,
          repo: payload.repository.name,
          prNumber: prPayload.pull_request.number,
          prUrl,
          body: prPayload.pull_request.body,
          headRef: prPayload.pull_request.head?.ref ?? '',
        }).catch(() => ({ kind: 'none' as const }));
        if (link.kind === 'diverted') {
          const verifyGh = new GitHubClient(c.env, installationId);
          const { verifyDivertedJulesPr } = await import('@server/core/jules-pr-verify');
          c.executionCtx.waitUntil(
            verifyDivertedJulesPr(c.env, verifyGh, {
              session: link.session,
              owner: payload.repository.owner.login,
              repo: payload.repository.name,
              prNumber: prPayload.pull_request.number,
              headSha: prPayload.pull_request.head.sha,
            }).catch((err) => console.error('Jules PR verification failed:', err)),
          );
          return finish(
            202,
            { ok: true, message: 'jules_pr_diverted' },
            'jules_pr_diverted',
            { prNumber: prPayload.pull_request.number },
          );
        }

        // External Jules PR (no Codra session): route to review only when the
        // repo opted in AND CI is absent — otherwise wait for the CI-completion
        // webhook to fire the review on failure. This branch always returns —
        // an external Jules PR must never fall through to the standard review.
        if (link.kind === 'external') {
          if (repoConfig.externalJulesEnabled) {
            const gh = new GitHubClient(c.env, installationId);
            const hasCI = await gh.hasConfiguredCI(payload.repository.owner.login, payload.repository.name, prPayload.pull_request.base.ref).catch(() => true);
            if (!hasCI) {
              const jobId = await enqueueExternalReview(c.env, gh, {
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                prNumber: prPayload.pull_request.number,
                installationId,
                configSnapshot: repoConfig.parsedJson,
                deliveryId,
                requestId: c.get('requestId'),
              });
              return finish(
                202,
                { ok: true, message: jobId ? 'queued' : 'no_action' },
                jobId ? 'job_created' : 'no_action',
                jobId ? { action: 'review', prNumber: prPayload.pull_request.number, jobId } : { prNumber: prPayload.pull_request.number },
              );
            }
          }
          // opted-out, or CI present (wait for the CI-failure webhook): never standard-review an external Jules PR
          return finish(202, { ok: true, message: 'external_jules_no_action' }, 'no_action', { prNumber: prPayload.pull_request.number });
        }
      }

      // No blanket `enabled === false` gate: on-demand @codra-app mentions must
      // work even when every auto-toggle is off. extractReviewRequest returns
      // null for an auto event whose repo has no check enabled, so a disabled
      // repo still produces no auto job.
      const extracted = extractReviewRequest({
        eventName,
        payload,
        botUsername: c.env.BOT_USERNAME,
        config: repoConfig.parsedJson,
        flags: {
          enabled: repoConfig.enabled,
          docstringEnabled: repoConfig.docstringEnabled,
          toolboxEnabled: repoConfig.toolboxEnabled,
          externalJulesEnabled: repoConfig.externalJulesEnabled,
        },
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

        // This fast path only handles auto (PR) events — mentions have no
        // commitSha here and fall through to the queue/resolveQueuedJob path.
        // Loop guard: an auto commit never restarts an in-flight review.
        const activeJobs = await findActiveJobsForPr(c.env, {
          owner: extracted.owner, repo: extracted.repo, prNumber: extracted.prNumber,
        });
        if (activeJobs.length > 0) {
          return finish(202, {
            ok: true, duplicate: true, reason: 'review_in_flight',
            message: `A review is already running for PR #${extracted.prNumber}. Comment ${c.env.BOT_USERNAME ? '@' + c.env.BOT_USERNAME + ' review' : 'the review trigger'} to restart it.`,
          }, 'job_created', { action: 'review', prNumber: extracted.prNumber, jobId: activeJobs[0].id });
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
          scope: extracted.scope,
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
