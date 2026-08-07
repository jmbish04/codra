import { describe, expect, it, vi } from 'vitest';
import { emitReviewDatapoint, logReviewStep } from '@server/core/review-telemetry';

describe('review telemetry', () => {
  it('writes one Analytics Engine datapoint and never throws', () => {
    const writes: any[] = [];
    const env: any = { REVIEW_ANALYTICS: { writeDataPoint: (d: any) => writes.push(d) } };
    expect(() => emitReviewDatapoint(env, {
      repo: 'o/r', engine: 'native', reviewers: 'security,correctness', verdict: 'comment',
      breakerState: 'closed', findings: 2, p0: 0, p1: 1, inputTokens: 100, outputTokens: 20,
      cacheReadTokens: 80, cacheWriteTokens: 20, cacheHitRate: 0.8, costUsd: 0.01, durationMs: 1234,
    })).not.toThrow();
    expect(writes).toHaveLength(1);
    expect(writes[0].blobs).toContain('native');
    expect(writes[0].doubles).toContain(1234);
  });

  it('emit is a no-op when the binding is missing', () => {
    expect(() => emitReviewDatapoint({} as any, {} as any)).not.toThrow();
  });

  it('logReviewStep emits valid self-contained JSON', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logReviewStep({ jobId: 'j', phase: 'review', reviewer: 'security', model: 'm', durationMs: 10, findings: 1 });
    const line = spy.mock.calls.at(-1)?.[0] as string;
    expect(() => JSON.parse(line)).not.toThrow();
    spy.mockRestore();
  });
});
