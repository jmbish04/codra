import { describe, it, expect, beforeEach } from 'vitest';
import { enqueueExternalReview } from '@server/core/jules-pr';
import { insertJob } from '@server/db/jobs';
import { createTestEnv } from './helpers';

const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);

function fakeGh(overrides: Record<string, unknown> = {}) {
  return {
    getPullRequest: async (_o: string, _r: string, n: number) => ({
      number: n,
      title: 'external jules pr',
      body: 'https://jules.google.com/task/999999',
      draft: false,
      head: { sha: HEAD_SHA, ref: 'jules-x-999999' },
      base: { sha: BASE_SHA, ref: 'main' },
      user: { login: 'jmbish04' },
      ...overrides,
    }),
  } as any;
}

describe('enqueueExternalReview', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('enqueues a codeReview-only job and sends it to the review queue', async () => {
    const jobId = await enqueueExternalReview(env, fakeGh(), {
      owner: 'o', repo: 'r', prNumber: 7, installationId: '1',
      configSnapshot: null, deliveryId: 'd1', requestId: 'req1',
    });

    expect(jobId).toBeTruthy();
    const sent = (env.REVIEW_QUEUE as any).sent as { jobId: string; phase: string }[];
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ jobId, phase: 'prepare' });
  });

  it('does not enqueue a second job when one is already active for the PR', async () => {
    // Seed an active (queued) job for the same PR.
    await insertJob(env, {
      installationId: '1', owner: 'o', repo: 'r', prNumber: 8,
      prTitle: 't', prAuthor: 'a', commitSha: HEAD_SHA, baseSha: BASE_SHA,
      trigger: 'auto', headRef: 'jules-x-8', baseRef: 'main',
      scope: { codeReview: true, docstring: false, toolbox: false },
    });

    const jobId = await enqueueExternalReview(env, fakeGh(), {
      owner: 'o', repo: 'r', prNumber: 8, installationId: '1',
      configSnapshot: null, deliveryId: 'd2',
    });

    expect(jobId).toBeNull();
    // Only the seeded job exists; enqueueExternalReview sent nothing.
    const sent = (env.REVIEW_QUEUE as any).sent as unknown[];
    expect(sent).toHaveLength(0);
  });
});
