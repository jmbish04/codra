import { describe, expect, it, vi } from 'vitest';
import { resolveEngine } from '@server/core/engine-selector';
import type { ReviewEngine } from '@server/core/review-engine';
import type { RepoConfig } from '@shared/schema';
import { defaultRepoConfig } from '@shared/schema';

/**
 * Creates a mock KV namespace for testing.
 */
function fakeKv() {
  const m = new Map<string, string>();
  return {
    async get(k: string) { return m.get(k) ?? null; },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
  } as any;
}

/**
 * Creates a mock review engine instance with configurable health and provision state.
 */
function stubEngine(name: 'opencode' | 'computer' | 'native', healthy: boolean, configured = true): ReviewEngine {
  return {
    name,
    isConfigured: vi.fn(() => configured),
    healthCheck: vi.fn(async () => healthy),
    reviewPullRequest: vi.fn(async () => ({ comments: [], perReviewer: [] })),
  };
}

/**
 * Generates a partial repository configuration with the specified engine setting.
 */
function config(engine: RepoConfig['review']['engine']): RepoConfig {
  return { ...defaultRepoConfig, review: { ...defaultRepoConfig.review, engine } };
}

/**
 * Creates a mock environment referencing the specified KV store.
 */
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

  it('a hanging healthCheck (never resolves, ignores signal) does not hang resolveEngine', async () => {
    const kv = fakeKv();
    const opencode: ReviewEngine = {
      name: 'opencode',
      isConfigured: () => true,
      healthCheck: vi.fn(() => new Promise<boolean>(() => {})), // never settles, ignores signal
      reviewPullRequest: vi.fn(),
    };
    const computer = stubEngine('computer', false);
    const native = stubEngine('native', true);
    const engines = { opencode: () => opencode, computer: () => computer, native: () => native };

    const result = await resolveEngine(env(kv), config('auto'), 1000, engines);
    expect(result).toBe(native);

    const raw = await kv.get('breaker:opencode');
    expect(JSON.parse(raw!).failures).toBe(1);
  }, 5000);

  it('healthCheck === false (no throw) records a breaker failure', async () => {
    const kv = fakeKv();
    const opencode = stubEngine('opencode', false);
    const native = stubEngine('native', true);
    const engines = { opencode: () => opencode, computer: () => stubEngine('computer', false), native: () => native };

    await resolveEngine(env(kv), config('opencode'), 1000, engines);

    const raw = await kv.get('breaker:opencode');
    expect(JSON.parse(raw!).failures).toBe(1);
  });

  it("pinned engine='native' -> candidate order is exactly ['native'], no breaker constructed", async () => {
    const kv = fakeKv();
    const native = stubEngine('native', true);
    const opencode = stubEngine('opencode', true);
    const computer = stubEngine('computer', true);
    const engines = { opencode: () => opencode, computer: () => computer, native: () => native };

    const result = await resolveEngine(env(kv), config('native'), 1000, engines);
    expect(result).toBe(native);
    expect(opencode.healthCheck).not.toHaveBeenCalled();
    expect(computer.healthCheck).not.toHaveBeenCalled();
    // no breaker key written for opencode/computer since they were never candidates
    expect(await kv.get('breaker:opencode')).toBeNull();
    expect(await kv.get('breaker:computer')).toBeNull();
  });

  it('healthCheck throw records a breaker failure and falls through to next candidate', async () => {
    const kv = fakeKv();
    const opencode: ReviewEngine = {
      name: 'opencode',
      isConfigured: () => true,
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

  it('unconfigured candidates (isConfigured=false) never touch the breaker/KV or healthCheck -> native, zero KV I/O', async () => {
    const kv = fakeKv();
    const getSpy = vi.spyOn(kv, 'get');
    const putSpy = vi.spyOn(kv, 'put');

    const opencode = stubEngine('opencode', true, false); // healthy but unconfigured
    const computer = stubEngine('computer', true, false);
    const native = stubEngine('native', true);
    const engines = { opencode: () => opencode, computer: () => computer, native: () => native };

    const result = await resolveEngine(env(kv), config('auto'), 1000, engines);
    expect(result).toBe(native);
    expect(opencode.isConfigured).toHaveBeenCalled();
    expect(opencode.healthCheck).not.toHaveBeenCalled();
    expect(computer.healthCheck).not.toHaveBeenCalled();
    // The default 'auto' config with nothing provisioned must do ZERO KV I/O.
    expect(getSpy).not.toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
  });
});
