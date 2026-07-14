import { Hono } from 'hono';
import type { Context } from 'hono';
import { isSupportedGitHubWebhookEvent, type GitHubWebhookPayload } from '@shared/github';
import type { AppEnv } from '@server/env';
import { loadRepoConfig } from '@server/core/config';
import { extractReviewRequest } from '@server/core/review';
import { verifyGitHubWebhookSignature } from '@server/core/verify';
import { jsonError } from '@server/core/http';
import { findExistingJobForHead, insertJob, supersedeOlderJobs } from '@server/db/jobs';
import { recordWebhookDelivery } from '@server/db/webhook-deliveries';
import { getSecret } from '@server/utils/secrets';
import { GitHubClient } from '@server/core/github';

export async function handleGitHubWebhook(c: Context<AppEnv>) {
    const eventName = c.req.header('x-github-event');
    const deliveryId = c.req.header('x-github-delivery');
    const signature = c.req.header('x-hub-signature-256');
    const rawBody = await c.req.text();

    if (!eventName || !deliveryId) {
      return jsonError('Missing GitHub webhook headers.', 400);
    }

    const webhookSecret = getSecret(c.env, 'GITHUB_WEBHOOK_SECRET');
    const verified = await verifyGitHubWebhookSignature(webhookSecret, signature ?? null, rawBody);
    if (!verified) {
      return jsonError('Invalid webhook signature.', 401);
    }

    let payload: GitHubWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as GitHubWebhookPayload;
    } catch {
      return jsonError('Invalid webhook JSON payload.', 400);
    }

    const insertedDelivery = await recordWebhookDelivery(c.env, {
      deliveryId,
      eventName,
      owner: 'repository' in payload ? payload.repository.owner.login : null,
      repo: 'repository' in payload ? payload.repository.name : null,
      payload,
    });

    if (!insertedDelivery) {
      return c.json({ ok: true, duplicate: true }, 202);
    }

    const installationId = String(payload.installation?.id ?? '');
    if (!('repository' in payload) || !payload.repository) {
      return c.json({ ok: true, ignored: true }, 202);
    }

    if (!isSupportedGitHubWebhookEvent(eventName)) {
      return c.json({ ok: true, ignored: true, eventName }, 202);
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

      return c.json({ ok: true, message: 'kb_updated' }, 202);
    }

    if (!installationId) {
      return c.json({ ok: true, ignored: true }, 202);
    }

    const repoConfig = await loadRepoConfig(c.env, {
      installationId,
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
    });

    if (repoConfig.enabled === false) {
      return c.json({ ok: true, ignored: true, reason: 'repository_disabled' }, 202);
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
        return c.json({
          ok: true,
          duplicate: true,
          message: existingJob.status === 'queued' ? 'queued' : 'duplicate',
          job: existingJob,
        }, 202);
      }

      const job = await insertJob(c.env, {
        installationId: extracted.installationId,
        owner: extracted.owner,
        repo: extracted.repo,
        prNumber: extracted.prNumber,
        prTitle: extracted.prTitle,
        prAuthor: extracted.prAuthor,
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

      const repoAgentId = c.env.RepoAgent.idFromName(`${extracted.owner}/${extracted.repo}`);
      const repoAgent = c.env.RepoAgent.get(repoAgentId);
      
      c.executionCtx.waitUntil(
        repoAgent.fetch(new Request('https://repoagent/webhook', {
          method: 'POST',
          body: JSON.stringify(payload)
        })).catch((err: unknown) => {
          console.error('Failed to dispatch webhook to RepoAgent DO:', err);
        })
      );

      return c.json({ ok: true, message: 'delegated_to_repo_agent', job }, 202);
    }

    // Events that do not produce a concrete job, such as PR close cleanup or
    // mention events that need PR lookup, are still handled by the worker.
    await c.env.REVIEW_QUEUE.send({
      deliveryId,
      eventName,
      requestId: c.get('requestId'),
    });

    return c.json({ ok: true, message: 'queued' }, 202);
}

export function createWebhookRouter() {
  const app = new Hono<AppEnv>();

  app.post('/', handleGitHubWebhook);

  return app;
}
