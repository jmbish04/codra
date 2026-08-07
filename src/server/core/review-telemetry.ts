import { logger } from '@server/core/logger';

export type ReviewMetrics = {
  repo: string; engine: string; reviewers: string; verdict: string; breakerState: string;
  findings: number; p0: number; p1: number; inputTokens: number; outputTokens: number;
  cacheReadTokens: number; cacheWriteTokens: number; cacheHitRate: number; costUsd: number; durationMs: number;
};

export type ReviewStepTrace = {
  jobId: string; phase: string; reviewer?: string; model: string;
  durationMs: number; findings: number;
  inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number;
};

/** Fire-and-forget high-cardinality datapoint; never throws, no-op if unbound. */
export function emitReviewDatapoint(env: { REVIEW_ANALYTICS?: { writeDataPoint(d: unknown): void } }, m: ReviewMetrics): void {
  try {
    env.REVIEW_ANALYTICS?.writeDataPoint({
      indexes: [m.repo],
      blobs: [m.repo, m.engine, m.reviewers, m.verdict, m.breakerState],
      doubles: [m.findings, m.p0, m.p1, m.inputTokens, m.outputTokens, m.cacheReadTokens,
        m.cacheWriteTokens, m.cacheHitRate, m.costUsd, m.durationMs],
    });
  } catch (err) {
    logger.error('emitReviewDatapoint failed (ignored)', err);
  }
}

/** One self-contained JSON line per reviewer/coordinator step (Workers Logs). */
export function logReviewStep(step: ReviewStepTrace): void {
  console.log(JSON.stringify({ t: 'review_step', ...step }));
}
