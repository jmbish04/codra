import { describe, it, expect, vi, afterEach } from 'vitest';
import { syncOpenPullRequests } from '@server/services/sync/pr-sync';
import { GitHubClient } from '@server/core/github';
import { createTestEnv, seedEnabledRepo } from './helpers';

describe('open-PR sync', () => {
  afterEach(() => vi.restoreAllMocks());

  it('enqueues missing open PRs once and is idempotent on re-run', async () => {
    const env = createTestEnv();
    await seedEnabledRepo(env, { installationId: 123, owner: 'acme', repo: 'core-remodel' });

    // Relative to now so it stays inside sync's rolling 2-day age window — a
    // hardcoded date silently ages out of the window and fails over time.
    const recentlyCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    vi.spyOn(GitHubClient.prototype, 'listOpenPullRequests').mockResolvedValue([
      { number: 210, title: 'Feat X', authorLogin: 'alice', headSha: 'aa11', headRef: 'feat-x', baseSha: 'bb22', baseRef: 'main', createdAt: recentlyCreatedAt },
    ]);

    const first = await syncOpenPullRequests(env);
    expect(first.totalEnqueued).toBe(1);
    expect(first.repos[0]).toMatchObject({ owner: 'acme', repo: 'core-remodel', openPrs: 1, enqueued: 1, skipped: 0 });
    expect((env.REVIEW_QUEUE as any).sent.length).toBe(1);

    // Re-run: the head already has a job → nothing new enqueued.
    const second = await syncOpenPullRequests(env);
    expect(second.totalEnqueued).toBe(0);
    expect(second.repos[0]).toMatchObject({ enqueued: 0, skipped: 1 });
  });

  it('scopes to a single repo via repoFilter and ignores others', async () => {
    const env = createTestEnv();
    await seedEnabledRepo(env, { installationId: 1, owner: 'acme', repo: 'alpha' });
    await seedEnabledRepo(env, { installationId: 1, owner: 'acme', repo: 'beta' });

    const spy = vi.spyOn(GitHubClient.prototype, 'listOpenPullRequests').mockResolvedValue([]);

    await syncOpenPullRequests(env, { repoFilter: { owner: 'acme', repo: 'beta' } });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('acme', 'beta');
  });
});
