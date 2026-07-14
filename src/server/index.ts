import { createApp } from './app';
import { runReviewJob } from './core/review';
import { reviewJobMessageSchema } from '@shared/schema';
import { logger } from '@server/core/logger';

import { runBestEffortJobMaintenance } from '@server/core/job-recovery';

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
    ctx.waitUntil(
      runFullSync(env).catch((error) => {
        logger.error('Scheduled full sync failed', error instanceof Error ? error : new Error(String(error)));
      })
    );
  },
} satisfies ExportedHandler<Env>;

export { RepoAgent } from './agents/repo';
export { ReviewAgent } from './agents/review';
export { Chat, GitHubLikeMCP } from './agents/orchestrator';
export { PrReviewStream } from './agents/pr-stream';
