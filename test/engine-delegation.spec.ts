import { runReviewJob } from '@server/core/review';
import { createTestEnv, generateMockDiff, hasConfiguredTestDatabaseUrl } from './helpers';
import { vi } from 'vitest';
import { findExistingJobForHead, recordJobBatch } from '@server/db/jobs';
import { getFileReviewsForJobs } from '@server/db/file-reviews';
import { resolveEngine } from '@server/core/engine-selector';
import type { ReviewEngine } from '@server/core/review-engine';
import { OpenCodeError } from '@server/engines/opencode-client';

const sha = (char: string) => char.repeat(40);

// Same shape as review-flow.spec.ts's mocks — reused verbatim so the queue-driven
// prepare -> review -> finalize lifecycle runs exactly as it does there; only
// resolveEngine (below) is swapped to exercise the delegation branch.
vi.mock('@server/services/github', () => {
  class MockGitHubService {
    async getPullRequest() {
      return {
        title: 'Test PR',
        body: 'Test Body',
        head: { sha: 'headsha', ref: 'feature' },
        base: { sha: 'basesha', ref: 'main' },
        user: { login: 'author' },
      };
    }
    async getPullRequestDiff() {
      return generateMockDiff([{ path: 'src/app.ts', content: 'console.log(1);' }]);
    }
    async createCheckRun() { return { id: 123 }; }
    async updateCheckRun() { return {}; }
    async createReview() { return { id: 456 }; }
    async ensureLabel() { return {}; }
    async addIssueLabels() { return {}; }
    async removeIssueLabelsIfPresent() { return {}; }
    async removeIssueLabel() { return {}; }
    async getRepoFileWithRefOrNull() { return { content: Array.from({ length: 50 }, (_, i) => `line${i + 1}`).join('\n'), sha: 'filesha' }; }
  }
  return { GitHubService: MockGitHubService };
});

vi.mock('@server/services/model', () => {
  class MockModelService {
    async reviewFile() {
      return {
        parsed: {
          comments: [{ path: 'src/app.ts', line: 1, position: 1, severity: 'P2', category: 'quality', title: 'Native finding', body: 'from native' }],
          verdict: 'comment', fileSummary: 'Looks ok', overallCorrectness: 'issues found', confidenceScore: 0.9,
        },
        modelUsed: 'test-model', provider: 'test-provider', inputTokens: 10, outputTokens: 5, rawText: '{}', userPrompt: '',
      };
    }
    async generateSummary() {
      return { modelUsed: 'sum-model', provider: 'google', rawText: '{"summary": "test"}', inputTokens: 3, outputTokens: 2 };
    }
    async callModel() {
      return { modelUsed: 'test-model', provider: 'test-provider', rawText: '{"keep":[0,1]}', inputTokens: 1, outputTokens: 1, userPrompt: '' };
    }
    async pollReviewBatch(_model: string, _requestId: string) {
      return {
        status: 'complete' as const,
        responses: [{ index: 0, rawText: '{"findings":[],"file_verdict":"approve","file_summary":"ok"}', error: null }],
      };
    }
  }
  return {
    ModelService: MockModelService,
    isRetryableModelError: (error: unknown) => Boolean(error && typeof error === 'object' && (error as any).retryable === true),
  };
});

// The one seam this file exercises: runReviewPhase calls resolveEngine(env,
// config, nowMs) with the real registry — mock it so tests can hand back a
// stub ReviewEngine without provisioning real opencode/computer infra.
vi.mock('@server/core/engine-selector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@server/core/engine-selector')>();
  return { ...actual, resolveEngine: vi.fn() };
});

function stubEngine(reviewPullRequest: ReviewEngine['reviewPullRequest']): ReviewEngine {
  return { name: 'opencode', isConfigured: () => true, healthCheck: vi.fn(async () => true), reviewPullRequest };
}

const dbDescribe = hasConfiguredTestDatabaseUrl() ? describe : describe.skip;
const TIMEOUT_MS = 60_000;

dbDescribe('Engine delegation in runReviewPhase', () => {
  const env = createTestEnv();

  async function runAndDrain(message: Parameters<typeof runReviewJob>[1]) {
    (env.REVIEW_QUEUE as any).sent.length = 0;
    await runReviewJob(env, message);
    const queue = env.REVIEW_QUEUE as any;
    while (queue.sent.length > 0) {
      const next = queue.sent.shift();
      await runReviewJob(env, next);
    }
  }

  it('a healthy engine delegation persists results, skips the native loop, and enqueues finalize', async () => {
    const { ModelService } = await import('@server/services/model');
    const reviewFileSpy = vi.spyOn(ModelService.prototype, 'reviewFile');

    const engine = stubEngine(async () => ({
      comments: [{ path: 'src/app.ts', line: 2, position: 2, severity: 'P1', category: 'bugs', title: 'Engine finding', body: 'from opencode' }],
      perReviewer: [{ reviewer: 'bugs', file: 'src/app.ts', inputTokens: 7, outputTokens: 3, cacheReadTokens: 1, cacheWriteTokens: 0, findings: 1 }],
    }));
    (resolveEngine as any).mockResolvedValue(engine);

    const repo = `test-repo-${Date.now()}-engine-ok`;
    const headSha = sha('e');
    const baseSha = sha('f');

    await runAndDrain({
      deliveryId: 'delivery-engine-ok',
      eventName: 'pull_request',
      payload: {
        action: 'opened',
        installation: { id: 123 },
        repository: { owner: { login: 'test-owner' }, name: repo },
        pull_request: {
          number: 10,
          head: { sha: headSha, ref: 'feature' },
          base: { sha: baseSha, ref: 'main' },
          title: 'Test PR',
          user: { login: 'author' },
          draft: false,
        },
      },
    });

    const finalJob = await findExistingJobForHead(env, { owner: 'test-owner', repo, prNumber: 10, commitSha: headSha, trigger: 'auto' });
    expect(finalJob?.status).toBe('done');

    // Native per-file loop never ran — every finding came from the engine.
    expect(reviewFileSpy).not.toHaveBeenCalled();

    const reviews = await getFileReviewsForJobs(env, [finalJob!.id]);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].engine_used).toBe('opencode');
    expect(reviews[0].file_status).toBe('done');
    expect((reviews[0].parsed_comments as any[])[0].title).toBe('Engine finding');

    const breakerRaw = await env.APP_KV.get('breaker:opencode');
    expect(breakerRaw ? JSON.parse(breakerRaw).failures : 0).toBe(0);
  }, TIMEOUT_MS);

  it('a retryable engine failure trips the breaker and falls back to the native loop', async () => {
    const { ModelService } = await import('@server/services/model');
    const reviewFileSpy = vi.spyOn(ModelService.prototype, 'reviewFile');

    const engine = stubEngine(async () => { throw new OpenCodeError('connectivity failure', true); });
    (resolveEngine as any).mockResolvedValue(engine);

    const repo = `test-repo-${Date.now()}-engine-fallback`;
    const headSha = sha('1');
    const baseSha = sha('2');

    await runAndDrain({
      deliveryId: 'delivery-engine-fallback',
      eventName: 'pull_request',
      payload: {
        action: 'opened',
        installation: { id: 123 },
        repository: { owner: { login: 'test-owner' }, name: repo },
        pull_request: {
          number: 11,
          head: { sha: headSha, ref: 'feature' },
          base: { sha: baseSha, ref: 'main' },
          title: 'Test PR',
          user: { login: 'author' },
          draft: false,
        },
      },
    });

    const finalJob = await findExistingJobForHead(env, { owner: 'test-owner', repo, prNumber: 11, commitSha: headSha, trigger: 'auto' });
    // Job still completes — the failed delegation fell through to native, which succeeded.
    expect(finalJob?.status).toBe('done');
    expect(reviewFileSpy).toHaveBeenCalled();

    const reviews = await getFileReviewsForJobs(env, [finalJob!.id]);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].engine_used).toBe('native');
    expect((reviews[0].parsed_comments as any[])[0].title).toBe('Native finding');

    const breakerRaw = await env.APP_KV.get('breaker:opencode');
    expect(breakerRaw).not.toBeNull();
    expect(JSON.parse(breakerRaw!).failures).toBe(1);
  }, TIMEOUT_MS);

  it('a multi-file delegated PR streams to PrReviewStream in exactly ONE DO fetch carrying all files\' comments', async () => {
    const { GitHubService } = await import('@server/services/github');
    const diffSpy = vi.spyOn(GitHubService.prototype, 'getPullRequestDiff').mockResolvedValue(
      generateMockDiff([
        { path: 'src/app.ts', content: 'console.log(1);' },
        { path: 'src/other.ts', content: 'console.log(2);' },
      ]),
    );

    const engine = stubEngine(async () => ({
      comments: [
        { path: 'src/app.ts', line: 1, position: 1, severity: 'P1', category: 'bugs', title: 'Finding A', body: 'from opencode' },
        { path: 'src/other.ts', line: 1, position: 1, severity: 'P2', category: 'quality', title: 'Finding B', body: 'from opencode' },
      ],
      perReviewer: [
        { reviewer: 'bugs', file: 'src/app.ts', inputTokens: 5, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, findings: 1 },
        { reviewer: 'quality', file: 'src/other.ts', inputTokens: 4, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, findings: 1 },
      ],
    }));
    (resolveEngine as any).mockResolvedValue(engine);

    // Mirrors review-flow.spec.ts's DO-stream stub pattern: no PrReviewStream
    // binding is provided by createTestEnv, so wire one up here and count fetches.
    const doFetchBodies: unknown[] = [];
    (env as any).PrReviewStream = {
      idFromName: () => 'stream-id',
      get: () => ({
        fetch: async (req: Request) => {
          doFetchBodies.push(await req.clone().json());
          return new Response('OK');
        },
      }),
    };

    const repo = `test-repo-${Date.now()}-engine-multifile`;
    const headSha = sha('9');
    const baseSha = sha('8');

    await runAndDrain({
      deliveryId: 'delivery-engine-multifile',
      eventName: 'pull_request',
      payload: {
        action: 'opened',
        installation: { id: 123 },
        repository: { owner: { login: 'test-owner' }, name: repo },
        pull_request: {
          number: 12,
          head: { sha: headSha, ref: 'feature' },
          base: { sha: baseSha, ref: 'main' },
          title: 'Test PR',
          user: { login: 'author' },
          draft: false,
        },
      },
    });

    const finalJob = await findExistingJobForHead(env, { owner: 'test-owner', repo, prNumber: 12, commitSha: headSha, trigger: 'auto' });
    expect(finalJob?.status).toBe('done');

    const reviews = await getFileReviewsForJobs(env, [finalJob!.id]);
    expect(reviews).toHaveLength(2);
    expect(reviews.every((r) => r.engine_used === 'opencode')).toBe(true);

    // Exactly ONE DO fetch for the whole delegated result, not one per file.
    expect(doFetchBodies).toHaveLength(1);
    const body = doFetchBodies[0] as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect((body as any[]).map((c) => c.title).sort()).toEqual(['Finding A', 'Finding B']);

    diffSpy.mockRestore();
    delete (env as any).PrReviewStream;
  }, TIMEOUT_MS);

  it('skips engine delegation while a native batch is already in flight (job.batchRequestId set)', async () => {
    const { ModelService } = await import('@server/services/model');
    const pollSpy = vi.spyOn(ModelService.prototype, 'pollReviewBatch');

    const reviewPullRequest = vi.fn();
    const engine = stubEngine(reviewPullRequest);
    (resolveEngine as any).mockResolvedValue(engine);

    const repo = `test-repo-${Date.now()}-batch-inflight`;
    const headSha = sha('7');
    const baseSha = sha('6');
    const queue = env.REVIEW_QUEUE as any;
    queue.sent.length = 0;

    // Drive only the 'prepare' phase so the job exists with its 'review' phase
    // continuation queued but not yet processed.
    await runReviewJob(env, {
      deliveryId: 'delivery-batch-inflight',
      eventName: 'pull_request',
      payload: {
        action: 'opened',
        installation: { id: 123 },
        repository: { owner: { login: 'test-owner' }, name: repo },
        pull_request: {
          number: 13,
          head: { sha: headSha, ref: 'feature' },
          base: { sha: baseSha, ref: 'main' },
          title: 'Test PR',
          user: { login: 'author' },
          draft: false,
        },
      },
    });

    const preparedJob = await findExistingJobForHead(env, { owner: 'test-owner', repo, prNumber: 13, commitSha: headSha, trigger: 'auto' });
    expect(preparedJob).toBeTruthy();

    // Simulate a native Workers AI batch already submitted on a prior invocation.
    await recordJobBatch(env, preparedJob!.id, {
      requestId: 'batch-inflight-1',
      model: 'test-batch-model',
      filePaths: ['src/app.ts'],
      accountId: 'test-cf-account',
    });

    expect(queue.sent.length).toBeGreaterThan(0);
    const reviewMessage = queue.sent.shift();
    await runReviewJob(env, reviewMessage);

    // The healthy engine must NOT be invoked while the batch is in flight —
    // taking it over would orphan the already-submitted batch.
    expect(reviewPullRequest).not.toHaveBeenCalled();
    // Instead the existing native batch path drained it.
    expect(pollSpy).toHaveBeenCalledWith('test-batch-model', 'batch-inflight-1', 'test-cf-account');

    const reviews = await getFileReviewsForJobs(env, [preparedJob!.id]);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].model_used).toBe('test-batch-model');
    expect(reviews[0].file_status).toBe('done');
  }, TIMEOUT_MS);
});
