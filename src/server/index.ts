import { createApp } from './app';
import { runReviewJob } from './core/review';
import type { AppBindings } from './env';
import { reviewJobMessageSchema } from '@shared/schema';
import { logger } from '@server/core/logger';
import { runWithDb } from '@server/db/client';
import { runOpportunisticJobMaintenance } from '@server/core/job-recovery';

const app = createApp();

export default {
  fetch(request: Request, env: AppBindings, ctx: ExecutionContext) {
    return runWithDb(env, () => app.fetch(request, env, ctx));
  },

  async queue(batch: MessageBatch<unknown>, env: AppBindings, _ctx: ExecutionContext) {
    return runWithDb(env, async () => {
      await runOpportunisticJobMaintenance(env);

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

      await runOpportunisticJobMaintenance(env);
    });
  },
} satisfies ExportedHandler<AppBindings>;
