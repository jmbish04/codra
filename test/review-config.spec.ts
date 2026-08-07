import { describe, expect, it } from 'vitest';
import { repoConfigSchema } from '@shared/schema';

describe('review config engine/coordinator defaults', () => {
  it('defaults engine=auto, coordinator=null, risk tiers 10/100', () => {
    const cfg = repoConfigSchema.parse({});
    expect(cfg.review.engine).toBe('auto');
    expect(cfg.review.coordinator).toBeNull();
    expect(cfg.review.risk_tiers).toEqual({ trivial_max_lines: 10, lite_max_lines: 100 });
  });

  it('accepts an explicit engine pin', () => {
    const cfg = repoConfigSchema.parse({ review: { engine: 'native' } });
    expect(cfg.review.engine).toBe('native');
  });
});
