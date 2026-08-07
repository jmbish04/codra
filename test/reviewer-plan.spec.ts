import { describe, expect, it } from 'vitest';
import { planReviewers } from '@server/core/reviewer-plan';
import { defaultRepoConfig } from '@shared/schema';

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
