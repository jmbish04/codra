import type { AppBindings } from '@server/env';
import { getTerminalJobsNeedingCheckRunCompletion, markJobCheckRunCompleted, recoverExpiredJobLeases } from '@server/db/jobs';
import { logger } from '@server/core/logger';
import { GitHubService } from '@server/services/github';

const MAX_RECOVERY_COUNT = 3;

export async function recoverJobs(env: AppBindings) {
  try {
    const recovered = await recoverExpiredJobLeases(env, MAX_RECOVERY_COUNT);
    for (const jobId of recovered.requeuedJobIds) {
      await env.REVIEW_QUEUE.send({
        jobId,
        deliveryId: crypto.randomUUID(),
        phase: 'review',
      });
    }

    if (recovered.requeuedJobIds.length > 0 || recovered.failedJobs.length > 0) {
      logger.warn('Expired job leases recovered', {
        requeued: recovered.requeuedJobIds.length,
        failed: recovered.failedJobs.length,
      });
    }
  } catch (err) {
    logger.error('Failed to recover expired job leases', err instanceof Error ? err : new Error(String(err)));
  }
}

export async function completeTerminalCheckRuns(env: AppBindings) {
  const jobs = await getTerminalJobsNeedingCheckRunCompletion(env);
  for (const job of jobs) {
    if (!job.check_run_id) continue;

    try {
      const github = new GitHubService(env, job.installation_id);
      await github.updateCheckRun(job.owner, job.repo, job.check_run_id, {
        status: 'completed',
        conclusion: job.status === 'superseded' ? 'neutral' : 'failure',
        title: job.status === 'superseded' ? 'Review superseded' : 'Review failed',
        summary: job.error_msg ?? (job.status === 'superseded' ? 'Superseded by a newer commit or job.' : 'Review failed.'),
      });
      await markJobCheckRunCompleted(env, job.id);
    } catch (error) {
      logger.error(`Failed to complete terminal check run for job ${job.id}`, error instanceof Error ? error : new Error(String(error)));
    }
  }
}

export async function runOpportunisticJobMaintenance(env: AppBindings) {
  await recoverJobs(env);
  await completeTerminalCheckRuns(env);
}
