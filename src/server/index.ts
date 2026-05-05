import { createApp } from './app';
import { runReviewJob } from './core/review';
import type { AppBindings } from './env';
import { reviewJobMessageSchema } from '@shared/schema';
import { recoverStaleJobs } from '@server/db/jobs';
import { logger } from '@server/core/logger';
import { runWithDb } from '@server/db/client';

const app = createApp();

/**
 * Jobs left in 'running' after a worker crash must be recovered before the
 * next batch is processed. The threshold is set to 20 minutes — well above
 * the longest expected review job but below Cloudflare's 30-minute CPU limit.
 */
const STALE_JOB_THRESHOLD_MINUTES = 20;

export default {
  fetch(request: Request, env: AppBindings, ctx: ExecutionContext) {
    return runWithDb(env, () => app.fetch(request, env, ctx));
  },

  async queue(batch: MessageBatch<unknown>, env: AppBindings, _ctx: ExecutionContext) {
    return runWithDb(env, async () => {
    // ── Stale-job recovery ──────────────────────────────────────────────────
    // Run once per batch. Any job that was 'running' for > threshold is a
    // leftover from a previous crashed invocation; mark it failed now so the
    // dashboard and future retries see an accurate state.
    try {
      const recovered = await recoverStaleJobs(env, STALE_JOB_THRESHOLD_MINUTES);
      if (recovered > 0) {
        logger.warn('Stale jobs recovered', { count: recovered, thresholdMinutes: STALE_JOB_THRESHOLD_MINUTES });
      }
    } catch (err) {
      // Non-fatal: log and continue processing the batch.
      logger.error('Failed to recover stale jobs', err instanceof Error ? err : new Error(String(err)));
    }

    // ── Process messages ────────────────────────────────────────────────────
    for (const message of batch.messages) {
      const parseResult = reviewJobMessageSchema.safeParse(message.body);

      if (!parseResult.success) {
        // Malformed message — cannot be retried meaningfully. Ack it so
        // Cloudflare delivers it to the DLQ for inspection instead of burning
        // retries on something that will never be valid.
        logger.error('Invalid queue message schema; discarding message', {
          body: message.body,
          error: parseResult.error.flatten(),
        });
        message.ack();
        continue;
      }

      try {
        await runReviewJob(env, parseResult.data);
        message.ack();
      } catch (error) {
        logger.error('Queue message processing failed; retrying', error instanceof Error ? error : new Error(String(error)));
        message.retry();
      }
    }
    });
  },
} satisfies ExportedHandler<AppBindings>;
