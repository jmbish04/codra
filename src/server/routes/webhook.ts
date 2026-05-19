import { Hono } from 'hono';
import { isSupportedGitHubWebhookEvent, type GitHubWebhookPayload } from '@shared/github';
import type { AppEnv } from '@server/env';
import { loadRepoConfig } from '@server/core/config';
import { extractReviewRequest } from '@server/core/review';
import { verifyGitHubWebhookSignature } from '@server/core/verify';
import { jsonError } from '@server/core/http';
import { findExistingJobForHead, insertJob, supersedeOlderJobs } from '@server/db/jobs';
import { recordWebhookDelivery } from '@server/db/webhook-deliveries';

export function createWebhookRouter() {
  const app = new Hono<AppEnv>();

  app.post('/', async (c) => {
    const eventName = c.req.header('x-github-event');
    const deliveryId = c.req.header('x-github-delivery');
    const signature = c.req.header('x-hub-signature-256');
    const rawBody = await c.req.text();

    if (!eventName || !deliveryId) {
      return jsonError('Missing GitHub webhook headers.', 400);
    }

    const verified = await verifyGitHubWebhookSignature(c.env.GITHUB_APP_WEBHOOK_SECRET, signature ?? null, rawBody);
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
    if (!installationId || !('repository' in payload) || !payload.repository) {
      return c.json({ ok: true, ignored: true }, 202);
    }

    if (!isSupportedGitHubWebhookEvent(eventName)) {
      return c.json({ ok: true, ignored: true, eventName }, 202);
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

      await c.env.REVIEW_QUEUE.send({
        jobId: job.id,
        deliveryId,
        phase: 'prepare',
        requestId: c.get('requestId'),
      });

      return c.json({ ok: true, message: 'queued', job }, 202);
    }

    // Events that do not produce a concrete job, such as PR close cleanup or
    // mention events that need PR lookup, are still handled by the worker.
    await c.env.REVIEW_QUEUE.send({
      deliveryId,
      eventName,
      requestId: c.get('requestId'),
    });

    return c.json({ ok: true, message: 'queued' }, 202);
  });

  return app;
}
