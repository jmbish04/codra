import { describe, it, expect } from 'vitest';
import { repoConfigSchema } from '@shared/schema';

describe('repo config jules + deployWorkflow toggles', () => {
  it('defaults both to enabled', () => {
    const cfg = repoConfigSchema.parse({});
    expect(cfg.review.jules.enabled).toBe(true);
    expect(cfg.review.deployWorkflow.enabled).toBe(true);
  });
  it('respects an explicit opt-out', () => {
    const cfg = repoConfigSchema.parse({ review: { jules: { enabled: false } } });
    expect(cfg.review.jules.enabled).toBe(false);
    expect(cfg.review.deployWorkflow.enabled).toBe(true);
  });
});
