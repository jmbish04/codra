import { createApp } from './app';
import { runReviewJob } from './core/review';
import { reviewJobMessageSchema } from '@shared/schema';
import { logger } from '@server/core/logger';

import { runBestEffortJobMaintenance } from '@server/core/job-recovery';
import { soundHealthAlarmIfUnhealthy } from '@server/core/health';
import { notifyJobsChanged } from '@server/core/jobs-feed';

const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },

  async queue(batch: MessageBatch<unknown>, env: Env, _ctx: ExecutionContext) {
      try {
        await runBestEffortJobMaintenance(env);
      } catch (error) {
        logger.error('Pre-batch maintenance task failed', error instanceof Error ? error : new Error(String(error)));
      }

      for (const message of batch.messages) {
        const parseResult = reviewJobMessageSchema.safeParse(message.body);

        if (!parseResult.success) {
          logger.error('Invalid queue message schema; retrying so it can reach the DLQ', {
            body: message.body,
            error: parseResult.error.flatten(),
          });
          message.retry();
          continue;
        }

        try {
          const result = await runReviewJob(env, parseResult.data);
          // Notify the realtime jobs dashboard that this job may have changed.
          _ctx.waitUntil(notifyJobsChanged(env, { jobId: (parseResult.data as any).jobId }));
          if (result.action === 'retry') {
            message.retry({ delaySeconds: result.delaySeconds });
          } else {
            message.ack();
          }
        } catch (error) {
          logger.error('Queue message processing failed; retrying', error instanceof Error ? error : new Error(String(error)));
          message.retry();
        }
      }

      try {
        await runBestEffortJobMaintenance(env);
      } catch (error) {
        logger.error('Post-batch maintenance task failed', error instanceof Error ? error : new Error(String(error)));
      }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const { runFullSync } = await import('@server/services/sync/github-sync');
    // Backstop recovery on cron: the same expired-lease requeue that runs pre/post
    // every queue batch and on dashboard reads. Those cover active periods; this
    // catches a job stalled during a dead-quiet stretch (no webhooks, no dashboard
    // views) that would otherwise never self-heal. Note: piggybacks the 6h sync
    // cron — worst-case 6h heal; add a tighter cron only if that proves too slow.
    ctx.waitUntil(
      runBestEffortJobMaintenance(env).catch((error) => {
        logger.error('Scheduled job maintenance failed', error instanceof Error ? error : new Error(String(error)));
      })
    );
    // Sound the health alarm on cron: a loud error log (visible in observability)
    // whenever the review pipeline has stuck jobs.
    ctx.waitUntil(
      soundHealthAlarmIfUnhealthy(env).catch((error) => {
        logger.error('Scheduled health check failed', error instanceof Error ? error : new Error(String(error)));
      })
    );
    ctx.waitUntil(
      runFullSync(env).catch((error) => {
        logger.error('Scheduled full sync failed', error instanceof Error ? error : new Error(String(error)));
      })
    );
    // Advance any active Jules planning sessions one bounded step. No-ops instantly
    // when none are active — this is the stateless, cost-flat replacement for the
    // (removed) always-awake orchestration Durable Object.
    ctx.waitUntil(
      import('@server/services/jules-poller').then(({ advanceJulesOrchestration }) => advanceJulesOrchestration(env)).catch((error) => {
        logger.error('Jules orchestration poll failed', error instanceof Error ? error : new Error(String(error)));
      })
    );
  },
} satisfies ExportedHandler<Env>;

export { RepoAgent } from './agents/repo';
export { ReviewAgent } from './agents/review';
export { Chat, GitHubLikeMCP } from './agents/orchestrator';
export { PrReviewStream } from './agents/pr-stream';
export { JobsFeed } from './agents/jobs-feed';
