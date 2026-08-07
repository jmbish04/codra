import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '@server/db/client';
import { jobs, repositories } from '@server/db/schemas';
import { extractReviewRequest, isBotSender } from '@server/core/review';
import { countAutoReviewsForPr, MAX_AUTO_REVIEWS_PER_PR } from '@server/db/jobs';
import { defaultRepoConfig } from '@shared/schema';
import { createTestEnv } from './helpers';

async function seedRepo(env: Env): Promise<number> {
  const [row] = await getDb(env).insert(repositories)
    .values({ installation_id: 123, owner: 'test-owner', repo: 'app' })
    .returning({ id: repositories.id });
  return row.id;
}

async function seedJob(env: Env, repositoryId: number, prNumber: number, trigger: string): Promise<string> {
  const db = getDb(env);
  const [row] = await db.insert(jobs).values({
    repository_id: repositoryId,
    pr_number: prNumber,
    commit_sha: new Uint8Array([Math.floor(Math.random() * 255)]),
    base_sha: new Uint8Array([Math.floor(Math.random() * 255)]),
    trigger,
    status: 'done',
  }).returning({ id: jobs.id });
  return row.id;
}

function pullRequestPayload(sender?: { login: string; type?: string }) {
  return {
    action: 'opened',
    installation: { id: 123 },
    repository: { owner: { login: 'test-owner' }, name: 'app' },
    sender,
    pull_request: {
      number: 1,
      head: { sha: 'a'.repeat(40), ref: 'feature' },
      base: { sha: 'b'.repeat(40), ref: 'main' },
      title: 'Test PR',
      user: { login: 'author' },
      draft: false,
    },
  } as any;
}

describe('isBotSender', () => {
  it('is true when sender.type is Bot', () => {
    expect(isBotSender({ login: 'some-app', type: 'Bot' }, 'codra-app')).toBe(true);
  });

  it('is true for a [bot] suffixed login', () => {
    expect(isBotSender({ login: 'dependabot[bot]', type: 'User' }, 'codra-app')).toBe(true);
  });

  it('is true when login matches botUsername, case-insensitive', () => {
    expect(isBotSender({ login: 'Codra-App', type: 'User' }, 'codra-app')).toBe(true);
  });

  it('is false for a normal human sender', () => {
    expect(isBotSender({ login: 'alice', type: 'User' }, 'codra-app')).toBe(false);
  });

  it('is false for a null/undefined sender', () => {
    expect(isBotSender(null, 'codra-app')).toBe(false);
    expect(isBotSender(undefined, 'codra-app')).toBe(false);
  });
});

describe('extractReviewRequest bot guard', () => {
  it('returns null for a pull_request event from a bot sender', () => {
    const result = extractReviewRequest({
      eventName: 'pull_request',
      payload: pullRequestPayload({ login: 'codra-app[bot]', type: 'Bot' }),
      botUsername: 'codra-app',
      config: defaultRepoConfig,
    });
    expect(result).toBeNull();
  });

  it('returns an auto-trigger request for a pull_request event from a human sender', () => {
    const result = extractReviewRequest({
      eventName: 'pull_request',
      payload: pullRequestPayload({ login: 'alice', type: 'User' }),
      botUsername: 'codra-app',
      config: defaultRepoConfig,
    });
    expect(result?.trigger).toBe('auto');
  });
});

describe('countAutoReviewsForPr', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('MAX_AUTO_REVIEWS_PER_PR is 3', () => {
    expect(MAX_AUTO_REVIEWS_PER_PR).toBe(3);
  });

  it('counts only auto-triggered jobs for the PR', async () => {
    const repo = await seedRepo(env);
    await seedJob(env, repo, 1, 'auto');
    await seedJob(env, repo, 1, 'auto');
    await seedJob(env, repo, 1, 'auto');
    await seedJob(env, repo, 1, 'mention');

    const count = await countAutoReviewsForPr(env, {
      installationId: '123', owner: 'test-owner', repo: 'app', prNumber: 1,
    });
    expect(count).toBe(3);
    // The cap check in webhook.ts / resolveQueuedJob is `autoCount >= MAX_AUTO_REVIEWS_PER_PR`.
    // At exactly 3 existing auto jobs, a 4th auto trigger must be blocked.
    expect(count >= MAX_AUTO_REVIEWS_PER_PR).toBe(true);
  });

  it('boundary: one below the cap does not block, at the cap blocks', async () => {
    const repo = await seedRepo(env);
    await seedJob(env, repo, 5, 'auto');
    await seedJob(env, repo, 5, 'auto');

    const belowCap = await countAutoReviewsForPr(env, {
      installationId: '123', owner: 'test-owner', repo: 'app', prNumber: 5,
    });
    expect(belowCap).toBe(2);
    expect(belowCap >= MAX_AUTO_REVIEWS_PER_PR).toBe(false);

    await seedJob(env, repo, 5, 'auto');
    const atCap = await countAutoReviewsForPr(env, {
      installationId: '123', owner: 'test-owner', repo: 'app', prNumber: 5,
    });
    expect(atCap).toBe(3);
    expect(atCap >= MAX_AUTO_REVIEWS_PER_PR).toBe(true);
  });

  it('does not count auto jobs from a different PR', async () => {
    const repo = await seedRepo(env);
    await seedJob(env, repo, 1, 'auto');
    await seedJob(env, repo, 2, 'auto');

    const count = await countAutoReviewsForPr(env, {
      installationId: '123', owner: 'test-owner', repo: 'app', prNumber: 1,
    });
    expect(count).toBe(1);
  });
});
