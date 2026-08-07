import { describe, expect, it, vi } from 'vitest';
import { resolveEngine } from '@server/core/engine-selector';
import type { ReviewEngine } from '@server/core/review-engine';
import type { RepoConfig } from '@shared/schema';
import { defaultRepoConfig } from '@shared/schema';

function fakeKv() {
  const m = new Map<string, string>();
  return {
    async get(k: string) { return m.get(k) ?? null; },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
  } as any;
}

function stubEngine(name: 'opencode' | 'computer' | 'native', healthy: boolean): ReviewEngine {
  return {
    name,
    healthCheck: vi.fn(async () => healthy),
    reviewPullRequest: vi.fn(async () => ({ comments: [], perReviewer: [] })),
  };
}

function config(engine: RepoConfig['review']['engine']): RepoConfig {
  return { ...defaultRepoConfig, review: { ...defaultRepoConfig.review, engine } };
}

function env(kv: any): Env {
  return { APP_KV: kv } as any;
}

describe('resolveEngine', () => {
  it('auto, all non-native unhealthy -> native', async () => {
    const opencode = stubEngine('opencode', false);
    const computer = stubEngine('computer', false);
    const native = stubEngine('native', true);
    const engines = { opencode: () => opencode, computer: () => computer, native: () => native };

    const result = await resolveEngine(env(fakeKv()), config('auto'), 1000, engines);
    expect(result).toBe(native);
  });

  it('auto, computer healthy -> computer (opencode tried first, unhealthy)', async () => {
    const opencode = stubEngine('opencode', false);
    const computer = stubEngine('computer', true);
    const native = stubEngine('native', true);
    const engines = { opencode: () => opencode, computer: () => computer, native: () => native };

    const result = await resolveEngine(env(fakeKv()), config('auto'), 1000, engines);
    expect(result).toBe(computer);
    expect(opencode.healthCheck).toHaveBeenCalled();
  });

  it('pinned opencode healthy -> opencode', async () => {
    const opencode = stubEngine('opencode', true);
    const native = stubEngine('native', true);
    const engines = { opencode: () => opencode, computer: () => stubEngine('computer', false), native: () => native };

    const result = await resolveEngine(env(fakeKv()), config('opencode'), 1000, engines);
    expect(result).toBe(opencode);
  });

  it('pinned opencode unhealthy -> native', async () => {
    const opencode = stubEngine('opencode', false);
    const native = stubEngine('native', true);
    const engines = { opencode: () => opencode, computer: () => stubEngine('computer', false), native: () => native };

    const result = await resolveEngine(env(fakeKv()), config('opencode'), 1000, engines);
    expect(result).toBe(native);
  });

  it('skips a candidate whose breaker is open, without calling healthCheck', async () => {
    const kv = fakeKv();
    // Trip the opencode breaker: 5 failures at t=0.
    await kv.put('breaker:opencode', JSON.stringify({ failures: 5, openedAt: 0 }));

    const opencode = stubEngine('opencode', true);
    const computer = stubEngine('computer', true);
    const native = stubEngine('native', true);
    const engines = { opencode: () => opencode, computer: () => computer, native: () => native };

    const result = await resolveEngine(env(kv), config('auto'), 1000, engines); // still within 60s cooldown
    expect(result).toBe(computer);
    expect(opencode.healthCheck).not.toHaveBeenCalled();
  });

  it('healthCheck throw records a breaker failure and falls through to next candidate', async () => {
    const kv = fakeKv();
    const opencode: ReviewEngine = {
      name: 'opencode',
      healthCheck: vi.fn(async () => { throw new Error('boom'); }),
      reviewPullRequest: vi.fn(),
    };
    const computer = stubEngine('computer', true);
    const native = stubEngine('native', true);
    const engines = { opencode: () => opencode, computer: () => computer, native: () => native };

    const result = await resolveEngine(env(kv), config('auto'), 1000, engines);
    expect(result).toBe(computer);

    const raw = await kv.get('breaker:opencode');
    expect(JSON.parse(raw!).failures).toBe(1);
  });
});
