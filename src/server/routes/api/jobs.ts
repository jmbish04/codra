import { Hono } from 'hono';
import { jobsQuerySchema } from '@shared/schema';
import type { AppEnv } from '@server/env';
import { bytesToHex, getJobDetail, getJobForProcessing, insertJob, listJobs, mapJob, supersedeOlderJobs } from '@server/db/jobs';
import { jsonError } from '@server/core/http';
import { runBestEffortJobMaintenance } from '@server/core/job-recovery';
import { loadRepoConfig } from '@server/core/config';

export function createJobsRouter() {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    await runBestEffortJobMaintenance(c.env);

    const rawQuery = c.req.query();
    const query = jobsQuerySchema.parse(rawQuery);

    const result = await listJobs(c.env, query as any);
    return c.json(result);
  });

  app.get('/:id', async (c) => {
    await runBestEffortJobMaintenance(c.env);

    const job = await getJobDetail(c.env, c.req.param('id'));
    if (!job) {
      return jsonError('Job not found.', 404);
    }

    return c.json({ job });
  });

  app.post('/:id/retry', async (c) => {
    const rawSource = await getJobForProcessing(c.env, c.req.param('id'));
    if (!rawSource) {
      return jsonError('Job not found.', 404);
    }
    const source = mapJob(rawSource);
    const currentConfig = await loadRepoConfig(c.env, {
      installationId: source.installationId,
      owner: source.owner,
      repo: source.repo,
    });

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
      configSnapshot: currentConfig.parsedJson,
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

  return app;
}
