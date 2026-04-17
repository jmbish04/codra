import { Hono } from 'hono';
import type { GitHubWebhookEventName, GitHubWebhookPayload, PullRequestWebhookPayload } from '@shared/github';
import type { AppEnv } from '@server/env';
import { extractReviewRequest } from '@server/core/review';
import { verifyGitHubWebhookSignature } from '@server/core/verify';
import { jsonError } from '@server/core/http';
import { GitHubClient } from '@server/core/github';
import { loadRepoConfig } from '@server/core/config';
import { findExistingJobForHead, insertJob, supersedeOlderJobs } from '@server/db/jobs';
import { recordWebhookDelivery } from '@server/db/webhook-deliveries';

export function createWebhookRouter() {
  const app = new Hono<AppEnv>();

  app.post('/', async (c) => {
    const eventName = c.req.header('x-github-event') as GitHubWebhookEventName | undefined;
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

    const payload = JSON.parse(rawBody) as GitHubWebhookPayload;
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

    const github = new GitHubClient(c.env, installationId);
    const repoConfig = await loadRepoConfig(c.env, github, {
      installationId,
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
    });

    if (repoConfig.enabled === false) {
      return c.json({ ok: true, ignored: true, reason: 'repo_disabled' }, 202);
    }

    const extracted = extractReviewRequest({
      eventName,
      payload,
      botUsername: c.env.BOT_USERNAME,
      config: repoConfig.parsedJson,
    });

    if (!extracted) {
      if (eventName === 'pull_request') {
        const prPayload = payload as PullRequestWebhookPayload;
        if (prPayload.action === 'closed' && repoConfig.parsedJson.review.labels !== false) {
          const labels = repoConfig.parsedJson.review.labels;
          await github.removeIssueLabel(prPayload.repository.owner.login, prPayload.repository.name, prPayload.pull_request.number, labels.p1);
          await github.removeIssueLabel(prPayload.repository.owner.login, prPayload.repository.name, prPayload.pull_request.number, labels.p2);
          await github.removeIssueLabel(prPayload.repository.owner.login, prPayload.repository.name, prPayload.pull_request.number, labels.p3);
          return c.json({ ok: true, cleaned: true }, 200);
        }
      }
      return c.json({ ok: true, ignored: true }, 202);
    }

    let resolved = extracted;
    if (eventName === 'issue_comment') {
      const pr = await github.getPullRequest(extracted.owner, extracted.repo, extracted.prNumber);
      resolved = {
        ...extracted,
        prTitle: pr.title,
        prAuthor: pr.user.login,
        commitSha: pr.head.sha,
        baseSha: pr.base.sha,
        headRef: pr.head.ref,
        baseRef: pr.base.ref,
      };
    }

    const duplicateJob = await findExistingJobForHead(c.env, {
      owner: resolved.owner,
      repo: resolved.repo,
      prNumber: resolved.prNumber,
      commitSha: resolved.commitSha,
      trigger: resolved.trigger,
    });
    if (duplicateJob) {
      return c.json({ ok: true, duplicate: true, jobId: duplicateJob.id }, 202);
    }

    const job = await insertJob(c.env, {
      installationId: resolved.installationId,
      owner: resolved.owner,
      repo: resolved.repo,
      prNumber: resolved.prNumber,
      prTitle: resolved.prTitle,
      prAuthor: resolved.prAuthor,
      commitSha: resolved.commitSha,
      baseSha: resolved.baseSha,
      trigger: resolved.trigger,
      headRef: resolved.headRef,
      baseRef: resolved.baseRef,
      configSnapshot: repoConfig.parsedJson,
    });

    // Supersede any older pending/running jobs for this PR
    await supersedeOlderJobs(c.env, {
      installationId: resolved.installationId,
      owner: resolved.owner,
      repo: resolved.repo,
      prNumber: resolved.prNumber,
      newJobId: job.id,
    });

    await c.env.REVIEW_QUEUE.send({
      jobId: job.id,
      deliveryId,
      installationId: resolved.installationId,
      owner: resolved.owner,
      repo: resolved.repo,
      prNumber: resolved.prNumber,
      commitSha: resolved.commitSha,
      trigger: resolved.trigger,
      requestId: c.get('requestId'),
    });

    return c.json({ ok: true, jobId: job.id }, 202);
  });

  return app;
}
