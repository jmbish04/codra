import { describe, expect, it } from 'vitest';
import { planReviewers, selectFilePlanForBudget } from '@server/core/reviewer-plan';
import { defaultRepoConfig } from '@shared/schema';
import type { ReviewerId } from '@server/prompts/reviewers';

const base = defaultRepoConfig.review;

describe('planReviewers', () => {
  it('trivial diff → security+correctness', () => {
    expect(new Set(planReviewers(8, 1, base))).toEqual(new Set(['security', 'correctness']));
  });
  it('lite diff → +bugs+performance', () => {
    expect(new Set(planReviewers(80, 2, base))).toEqual(new Set(['security', 'correctness', 'bugs', 'performance']));
  });
  it('full diff → all five + docs', () => {
    expect(new Set(planReviewers(500, 3, base))).toEqual(
      new Set(['security', 'correctness', 'bugs', 'performance', 'quality', 'docs']));
  });
  it('intersects with focus', () => {
    const cfg = { ...base, focus: ['security'] as any };
    expect(planReviewers(500, 3, cfg)).toEqual(['security']);
  });
});

describe('selectFilePlanForBudget', () => {
  const fullPlan: ReviewerId[] = ['security', 'correctness', 'bugs', 'performance', 'quality', 'docs'];

  it('proceeds with the full plan when it fits the remaining subrequest budget', () => {
    // plan.length(6) + 2 margin = 8 needed; budget has plenty of room.
    const decision = selectFilePlanForBudget(fullPlan, 0, (needed) => needed <= 42);
    expect(decision).toEqual({ action: 'proceed', plan: fullPlan });
  });

  it('single-reviewer plans always proceed unchanged, regardless of budget', () => {
    const decision = selectFilePlanForBudget(['security'], 0, () => false);
    expect(decision).toEqual({ action: 'proceed', plan: ['security'] });
  });

  it('defers to the next invocation when a LATER file in the chunk no longer fits', () => {
    // processedThisChunk > 0 means earlier files already started this
    // invocation; don't cram a reduced review into this file, wait for a
    // fresh per-invocation budget instead.
    const decision = selectFilePlanForBudget(fullPlan, 1, () => false);
    expect(decision).toEqual({ action: 'defer' });
  });

  it('degrades to the trivial-tier subset when even the FIRST file this invocation cannot fit', () => {
    // processedThisChunk === 0: no later invocation would do any better if we
    // just deferred (a fresh tracker still starts every invocation the same
    // way) — better to make partial progress now.
    const decision = selectFilePlanForBudget(fullPlan, 0, () => false);
    expect(decision).toEqual({ action: 'proceed', plan: ['security', 'correctness'] });
  });

  it('falls back to the first reviewer if the plan has no trivial-tier members and nothing fits', () => {
    const decision = selectFilePlanForBudget(['bugs', 'performance'], 0, () => false);
    expect(decision).toEqual({ action: 'proceed', plan: ['bugs'] });
  });
});
