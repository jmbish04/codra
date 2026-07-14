import { Hono } from 'hono';
import type { Context } from 'hono';
import { defaultRepoConfig, jobsQuerySchema } from '@shared/schema';
import type { AppEnv } from '@server/env';
import { bytesToHex, getJobDetail, getJobForProcessing, insertJob, listJobs, mapJob, supersedeOlderJobs, forceRestartJob } from '@server/db/jobs';
import { jsonError } from '@server/core/http';
import { scheduleBestEffortJobMaintenance } from '@server/core/job-recovery';
import { loadRepoConfig } from '@server/core/config';

function jobEtag(input: { id: string; status: string; updatedAt: string; fileCount: number; commentCount: number }) {
  return `"job-${input.id}-${input.status}-${input.fileCount}-${input.commentCount}-${new Date(input.updatedAt).getTime()}"`;
}

function getExecutionContext(c: Context<AppEnv>) {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

export function createJobsRouter() {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    scheduleBestEffortJobMaintenance(c.env, getExecutionContext(c));

    const rawQuery = c.req.query();
    const query = jobsQuerySchema.parse(rawQuery);

    const result = await listJobs(c.env, query as any);
    return c.json(result);
  });

  app.get('/:id', async (c) => {
    scheduleBestEffortJobMaintenance(c.env, getExecutionContext(c));

    const job = await getJobDetail(c.env, c.req.param('id'));
    if (!job) {
      return jsonError('Job not found.', 404);
    }

    const etag = jobEtag(job);
    const lastModified = new Date(job.updatedAt).toUTCString();
    if (c.req.header('if-none-match') === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          'Last-Modified': lastModified,
        },
      });
    }

    const response = c.json({ job });
    response.headers.set('ETag', etag);
    response.headers.set('Last-Modified', lastModified);
    response.headers.set('Cache-Control', 'private, no-cache');
    return response;
  });

  app.post('/:id/retry', async (c) => {
    const rawSource = await getJobForProcessing(c.env, c.req.param('id'));
    if (!rawSource) {
      return jsonError('Job not found.', 404);
    }
    const source = mapJob(rawSource);
    let configSnapshot;
    try {
      const currentConfig = await loadRepoConfig(c.env, {
        installationId: source.installationId,
        owner: source.owner,
        repo: source.repo,
      });
      configSnapshot = currentConfig?.parsedJson ?? defaultRepoConfig;
    } catch (e) {
      configSnapshot = defaultRepoConfig;
    }

    const job = await insertJob(c.env, {
      installationId: source.installationId,
      owner: source.owner,
      repo: source.repo,
      prNumber: source.prNumber,
      prTitle: source.prTitle,
      prAuthor: source.prAuthor,
      commitSha: source.commitSha,
      baseSha: bytesToHex(rawSource.base_sha), // base_sha is only in raw row/detail
      trigger: 'retry',
      headRef: rawSource.head_ref,
      baseRef: rawSource.base_ref,
      configSnapshot,
      retryOfJobId: source.id,
    });

    // Supersede any older pending/running jobs for this PR
    await supersedeOlderJobs(c.env, {
      installationId: source.installationId,
      owner: source.owner,
      repo: source.repo,
      prNumber: source.prNumber,
      newJobId: job.id,
    });

    // Send to queue using the NEW schema (background worker will handle it)
    await c.env.REVIEW_QUEUE.send({
      jobId: job.id,
      deliveryId: crypto.randomUUID(),
      phase: 'prepare',
      requestId: c.get('requestId'),
    });

    return c.json({ job }, 202);
  });

  app.post('/:id/force-restart', async (c) => {
    const jobId = c.req.param('id');
    const success = await forceRestartJob(c.env, jobId);
    if (!success) {
      return jsonError('Job not found.', 404);
    }

    // Immediately queue the message to review
    await c.env.REVIEW_QUEUE.send({
      jobId,
      deliveryId: crypto.randomUUID(),
      phase: 'review',
      requestId: c.get('requestId'),
    });

    const job = await getJobDetail(c.env, jobId);
    return c.json({ job }, 200);
  });

  return app;
}
