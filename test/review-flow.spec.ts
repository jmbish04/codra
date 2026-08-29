import { runReviewJob } from '@server/core/review';
import { createTestEnv, generateMockDiff, hasConfiguredTestDatabaseUrl } from './helpers';
import { vi } from 'vitest';
import { findExistingJobForHead, getJobForProcessing, insertJob, recordJobBatch, updateJobFileCount, updateJobStep } from '@server/db/jobs';
import { getFileReviewsForJobs, upsertFileReview } from '@server/db/file-reviews';
import { defaultRepoConfig } from '@shared/schema';
import { planReviewers } from '@server/core/reviewer-plan';


const sha = (char: string) => char.repeat(40);

// Properly mock the services as real classes with prototype methods
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
                    comments: [{
                        path: 'src/app.ts',
                        line: 1,
                        position: 1,
                        severity: 'P2',
                        category: 'quality',
                        title: 'Typo',
                        body: 'Fixed typo',
                    }],
                    verdict: 'comment',
                    fileSummary: 'Looks ok',
                    overallCorrectness: 'issues found',
                    confidenceScore: 0.9
                },
                modelUsed: 'test-model',
                provider: 'test-provider',
                inputTokens: 10,
                outputTokens: 5,
                rawText: '{}',
                userPrompt: '',
            };
        }
        async generateSummary() {
            return {
                modelUsed: 'sum-model',
                provider: 'google',
                rawText: '{"summary": "test"}',
                inputTokens: 3,
                outputTokens: 2,
            };
        }
        async callModel() {
            return {
                modelUsed: 'test-model',
                provider: 'test-provider',
                rawText: '{"keep":[0,1]}',
                inputTokens: 1,
                outputTokens: 1,
                userPrompt: '',
            };
        }
        async resolveBatchModel() { return null; }
        async submitReviewBatch() { return null; }
        async pollReviewBatch() { return { status: 'pending' }; }
        async buildReviewPrompt() {
            return {
                systemPrompt: 'system',
                userPrompt: 'user',
            };
        }
    }
    return {
        ModelService: MockModelService,
        isRetryableModelError: (error: unknown) => Boolean(error && typeof error === 'object' && (error as any).retryable === true),
    };
});

const dbDescribe = hasConfiguredTestDatabaseUrl() ? describe : describe.skip;
const REVIEW_FLOW_TIMEOUT_MS = 60_000;

dbDescribe('Review Flow Lifecycle', () => {
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

  it('completes a full review from pending job to finished', async () => {
    const repo = `test-repo-${Date.now()}-full`;
    const headSha = sha('a');
    const baseSha = sha('b');

    await runAndDrain({
      deliveryId: 'delivery-123',
      eventName: 'pull_request',
      payload: {
        action: 'opened',
        installation: { id: 123 },
        repository: { owner: { login: 'test-owner' }, name: repo },
        pull_request: {
          number: 1,
          head: { sha: headSha, ref: 'feature' },
          base: { sha: baseSha, ref: 'main' },
          title: 'Test PR',
          user: { login: 'author' },
          draft: false,
        }
      }
    });

    const finalJob = await findExistingJobForHead(env, {
      owner: 'test-owner',
      repo,
      prNumber: 1,
      commitSha: headSha,
      trigger: 'auto',
    });
    expect(finalJob?.status).toBe('done');
  }, REVIEW_FLOW_TIMEOUT_MS);

  it('stops processing if the job is superseded mid-way', async () => {
      const { GitHubService } = await import('@server/services/github');
      const repo = `test-repo-${Date.now()}-supersede`;
      const headSha = sha('c');
      const baseSha = sha('d');

      // Spy on the prototype of our mocked class
      const getDiffSpy = vi.spyOn(GitHubService.prototype, 'getPullRequestDiff');

      // Simulate a newer commit landing mid-review: insert a newer job for THIS
      // PR and supersede the older ones, so checkSuperseded flips the job under
      // test to 'superseded' on its next phase. (The previous version used
      // `require` — undefined under ESM — and targeted the wrong PR, so it never
      // actually superseded anything.)
      getDiffSpy.mockImplementationOnce(async () => {
          const jobs = await import('@server/db/jobs');
          const newer = await jobs.insertJob(env, {
            installationId: '123', owner: 'test-owner', repo, prNumber: 2,
            prTitle: 'Supersede Test', prAuthor: 'author',
            commitSha: sha('C'), baseSha, trigger: 'auto', headRef: 'feature', baseRef: 'main',
            configSnapshot: defaultRepoConfig,
          });
          await jobs.supersedeOlderJobs(env, { installationId: '123', owner: 'test-owner', repo, prNumber: 2, newJobId: newer.id });
          return generateMockDiff([{ path: 'test.ts', content: 'a' }]);
      });

      await runAndDrain({
        deliveryId: 'delivery-456',
        eventName: 'pull_request',
        payload: {
          action: 'opened',
          installation: { id: 123 },
          repository: { owner: { login: 'test-owner' }, name: repo },
          pull_request: {
            number: 2,
            head: { sha: headSha, ref: 'feature' },
            base: { sha: baseSha, ref: 'main' },
            title: 'Supersede Test',
            user: { login: 'author' },
            draft: false,
          }
        }
      });

      const finalJob = await findExistingJobForHead(env, {
        owner: 'test-owner',
        repo,
        prNumber: 2,
        commitSha: headSha,
        trigger: 'auto',
      });
      expect(finalJob?.status).toBe('superseded');
      expect(finalJob?.verdict).toBeNull();
  }, REVIEW_FLOW_TIMEOUT_MS);

  it('processes a pre-created retry job from a queue message', async () => {
    const repo = `test-repo-${Date.now()}-retry`;
    const sourceHeadSha = sha('1');
    const retryHeadSha = sha('2');
    const baseSha = sha('3');

    const source = await insertJob(env, {
      installationId: '123',
      owner: 'test-owner',
      repo,
      prNumber: 3,
      prTitle: 'Retry Test',
      prAuthor: 'author',
      commitSha: sourceHeadSha,
      baseSha,
      trigger: 'auto',
      headRef: 'feature',
      baseRef: 'main',
      configSnapshot: defaultRepoConfig,
    });

    const retry = await insertJob(env, {
      installationId: '123',
      owner: 'test-owner',
      repo,
      prNumber: 3,
      prTitle: 'Retry Test',
      prAuthor: 'author',
      commitSha: retryHeadSha,
      baseSha,
      trigger: 'retry',
      headRef: 'feature',
      baseRef: 'main',
      configSnapshot: defaultRepoConfig,
      retryOfJobId: source.id,
    });

    await runAndDrain({
      jobId: retry.id,
      deliveryId: 'delivery-retry',
    });

    const finalJob = await getJobForProcessing(env, retry.id);
    expect(finalJob?.status).toBe('done');
  }, REVIEW_FLOW_TIMEOUT_MS);

  it('inherits best_practice_checks from a parent done review on retry jobs', async () => {
    const { ModelService } = await import('@server/services/model');
    const reviewSpy = vi.spyOn(ModelService.prototype, 'reviewFile');
    const repo = `test-repo-${Date.now()}-retry-inherit-checks`;
    const sourceHeadSha = sha('4');
    const retryHeadSha = sha('5');
    const baseSha = sha('6');
    const inheritanceConfig = {
      ...defaultRepoConfig,
      model: {
        main: 'test-model',
        fallbacks: [],
        size_overrides: [],
      },
    };

    const source = await insertJob(env, {
      installationId: '123',
      owner: 'test-owner',
      repo,
      prNumber: 33,
      prTitle: 'Retry inherit checks',
      prAuthor: 'author',
      commitSha: sourceHeadSha,
      baseSha,
      trigger: 'auto',
      headRef: 'feature',
      baseRef: 'main',
      configSnapshot: inheritanceConfig,
    });
    const inheritedChecks = [{ practice: 'D1 Bulk Insert Batching', status: 'violation', note: 'missing db.batch()' }] as const;
    await upsertFileReview(env, source.id, {
      filePath: 'src/app.ts',
      fileStatus: 'done',
      modelUsed: 'test-model',
      modelProvider: 'test-provider',
      diffLineCount: 1,
      diffInput: 'old diff',
      rawAiOutput: '{}',
      parsedComments: [],
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
      verdict: 'approve',
      fileSummary: 'old',
      bestPracticeChecks: [...inheritedChecks],
      errorMessage: null,
    });

    const retry = await insertJob(env, {
      installationId: '123',
      owner: 'test-owner',
      repo,
      prNumber: 33,
      prTitle: 'Retry inherit checks',
      prAuthor: 'author',
      commitSha: retryHeadSha,
      baseSha,
      trigger: 'retry',
      headRef: 'feature',
      baseRef: 'main',
      configSnapshot: inheritanceConfig,
      retryOfJobId: source.id,
    });

    await runAndDrain({
      jobId: retry.id,
      deliveryId: 'delivery-retry-inherit-checks',
      phase: 'review',
    });

    expect(reviewSpy).not.toHaveBeenCalled();
    const inherited = (await getFileReviewsForJobs(env, [retry.id])).find((review) => review.file_path === 'src/app.ts');
    const inheritedPersistedChecks = typeof inherited?.best_practice_checks === 'string'
      ? JSON.parse(inherited.best_practice_checks)
      : (inherited?.best_practice_checks ?? []);
    expect(inheritedPersistedChecks).toEqual(inheritedChecks);
    reviewSpy.mockRestore();
  }, REVIEW_FLOW_TIMEOUT_MS);

  it('does not inherit parent file reviews from models outside the current retry strategy', async () => {
    const { ModelService } = await import('@server/services/model');
    const reviewSpy = vi.spyOn(ModelService.prototype, 'reviewFile');
    const repo = `test-repo-${Date.now()}-retry-model-filter`;
    const sourceHeadSha = sha('8');
    const retryHeadSha = sha('9');
    const baseSha = sha('0');

    const source = await insertJob(env, {
      installationId: '123',
      owner: 'test-owner',
      repo,
      prNumber: 6,
      prTitle: 'Retry Model Filter',
      prAuthor: 'author',
      commitSha: sourceHeadSha,
      baseSha,
      trigger: 'auto',
      headRef: 'feature',
      baseRef: 'main',
      configSnapshot: {
        ...defaultRepoConfig,
        model: {
          main: 'gemma-4-31b-it',
          fallbacks: ['gemma-4-26b-a4b-it', '@cf/zai-org/glm-4.7-flash'],
          size_overrides: [],
        },
      },
    });

    await upsertFileReview(env, source.id, {
      filePath: 'src/app.ts',
      fileStatus: 'done',
      modelUsed: '@cf/zai-org/glm-4.7-flash',
      modelProvider: 'cloudflare',
      diffLineCount: 1,
      diffInput: 'old diff',
      rawAiOutput: '{}',
      parsedComments: [],
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
      verdict: 'approve',
      fileSummary: 'old',
      errorMessage: null,
    });

    const retry = await insertJob(env, {
      installationId: '123',
      owner: 'test-owner',
      repo,
      prNumber: 6,
      prTitle: 'Retry Model Filter',
      prAuthor: 'author',
      commitSha: retryHeadSha,
      baseSha,
      trigger: 'retry',
      headRef: 'feature',
      baseRef: 'main',
      configSnapshot: {
        ...defaultRepoConfig,
        model: {
          main: 'gemma-4-31b-it',
          fallbacks: ['gemma-4-26b-a4b-it'],
          size_overrides: [],
        },
      },
      retryOfJobId: source.id,
    });

    await runAndDrain({
      jobId: retry.id,
      deliveryId: 'delivery-retry-model-filter',
    });

    expect(reviewSpy).toHaveBeenCalled();
    const reviews = await getFileReviewsForJobs(env, [retry.id]);
    expect(reviews.find((review) => review.file_path === 'src/app.ts')?.model_used).toBe('test-model');
    reviewSpy.mockRestore();
  }, REVIEW_FLOW_TIMEOUT_MS);

  it('persists best_practice_checks from completed batch responses', async () => {
    const { ModelService } = await import('@server/services/model');
    const repo = `test-repo-${Date.now()}-batch-checks`;
    const headSha = sha('7');
    const baseSha = sha('8');

    const job = await insertJob(env, {
      installationId: '123',
      owner: 'test-owner',
      repo,
      prNumber: 34,
      prTitle: 'Batch checks',
      prAuthor: 'author',
      commitSha: headSha,
      baseSha,
      trigger: 'auto',
      headRef: 'feature',
      baseRef: 'main',
      configSnapshot: defaultRepoConfig,
    });
    await updateJobFileCount(env, job.id, 1);
    await updateJobStep(env, job.id, 'Preparation', { status: 'done' });
    await recordJobBatch(env, job.id, {
      requestId: 'batch-request-1',
      model: '@cf/meta/llama-3.1-8b-instruct-fast',
      filePaths: ['src/app.ts'],
      accountId: 'test-cf-account',
    });
    const expectedChecks = [{ practice: 'D1 Bulk Insert Batching', status: 'violation', note: 'chunk writes were sequential' }];
    const pollSpy = vi.spyOn(ModelService.prototype as any, 'pollReviewBatch').mockResolvedValue({
      status: 'complete',
      usage: { inputTokens: 0, outputTokens: 0 },
      responses: [{
        index: 0,
        error: null,
        rawText: JSON.stringify({
          findings: [],
          best_practice_checks: expectedChecks,
          overall_correctness: 'patch is correct',
          overall_explanation: 'No findings',
          overall_confidence_score: 0.9,
        }),
      }],
    });

    await runAndDrain({
      jobId: job.id,
      deliveryId: 'delivery-batch-checks',
      phase: 'review',
    });

    expect(pollSpy).toHaveBeenCalled();
    const batchReview = (await getFileReviewsForJobs(env, [job.id])).find((review) => review.file_path === 'src/app.ts');
    const persistedChecks = typeof batchReview?.best_practice_checks === 'string'
      ? JSON.parse(batchReview.best_practice_checks)
      : (batchReview?.best_practice_checks ?? []);
    expect(persistedChecks).toEqual(expectedChecks);
    pollSpy.mockRestore();
  }, REVIEW_FLOW_TIMEOUT_MS);

  it('resumes an existing queued duplicate job instead of stranding it', async () => {
    const repo = `test-repo-${Date.now()}-duplicate`;
    const headSha = sha('4');
    const baseSha = sha('5');

    const existing = await insertJob(env, {
      installationId: '123',
      owner: 'test-owner',
      repo,
      prNumber: 4,
      prTitle: 'Duplicate Test',
      prAuthor: 'author',
      commitSha: headSha,
      baseSha,
      trigger: 'auto',
      headRef: 'feature',
      baseRef: 'main',
      configSnapshot: defaultRepoConfig,
    });

    await runAndDrain({
      deliveryId: 'delivery-duplicate',
      eventName: 'pull_request',
      payload: {
        action: 'opened',
        installation: { id: 123 },
        repository: { owner: { login: 'test-owner' }, name: repo },
        pull_request: {
          number: 4,
          head: { sha: headSha, ref: 'feature' },
          base: { sha: baseSha, ref: 'main' },
          title: 'Duplicate Test',
          user: { login: 'author' },
          draft: false,
        },
      },
    });

    const finalJob = await getJobForProcessing(env, existing.id);
    expect(finalJob?.status).toBe('done');
  }, REVIEW_FLOW_TIMEOUT_MS);

  it('schedules a delayed continuation instead of spending queue retries on transient model failures', async () => {
    const { ModelService } = await import('@server/services/model');
    const retryableError = Object.assign(new Error('Google API timed out after 45000ms'), { retryable: true });
    const reviewSpy = vi.spyOn(ModelService.prototype, 'reviewFile').mockRejectedValue(retryableError);
    const repo = `test-repo-${Date.now()}-transient`;
    const headSha = sha('6');
    const baseSha = sha('7');

    const job = await insertJob(env, {
      installationId: '123',
      owner: 'test-owner',
      repo,
      prNumber: 5,
      prTitle: 'Transient Test',
      prAuthor: 'author',
      commitSha: headSha,
      baseSha,
      trigger: 'auto',
      headRef: 'feature',
      baseRef: 'main',
      configSnapshot: defaultRepoConfig,
    });
    await updateJobFileCount(env, job.id, 1);
    await updateJobStep(env, job.id, 'Preparation', { status: 'done' });

    await (async () => {
      (env.REVIEW_QUEUE as any).sent.length = 0;
      const result = await runReviewJob(env, {
        jobId: job.id,
        deliveryId: 'delivery-transient',
        phase: 'review',
      });

      expect(result).toEqual({ action: 'ack' });
      expect(reviewSpy).toHaveBeenCalled();
      expect((env.REVIEW_QUEUE as any).sent).toHaveLength(1);
      expect((env.REVIEW_QUEUE as any).sent[0]).toMatchObject({
        jobId: job.id,
        phase: 'review',
        options: { delaySeconds: 30 },
      });
    })();

    const finalJob = await getJobForProcessing(env, job.id);
    expect(finalJob?.status).toBe('running');
    expect(finalJob?.lease_owner).toBeNull();

    reviewSpy.mockRestore();
  }, REVIEW_FLOW_TIMEOUT_MS);

  it('reviews files in a chunk concurrently', async () => {
    const { GitHubService } = await import('@server/services/github');
    const { ModelService } = await import('@server/services/model');
    const repo = `test-repo-${Date.now()}-concurrent`;
    const headSha = sha('8');
    const baseSha = sha('9');
    const getDiffSpy = vi.spyOn(GitHubService.prototype, 'getPullRequestDiff').mockResolvedValue(
      generateMockDiff([
        { path: 'src/one.ts', content: 'console.log(1);' },
        { path: 'src/two.ts', content: 'console.log(2);' },
        { path: 'src/three.ts', content: 'console.log(3);' },
      ]),
    );
    let active = 0;
    let maxActive = 0;
    const reviewSpy = vi.spyOn(ModelService.prototype as any, 'reviewFile').mockImplementation(async (params: any) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active -= 1;
      return {
        parsed: {
          comments: [],
          verdict: 'approve',
          fileSummary: `Reviewed ${params.file.path}`,
          overallCorrectness: 'no issues',
          confidenceScore: 0.9,
        },
        modelUsed: 'test-model',
        provider: 'test-provider',
        inputTokens: 10,
        outputTokens: 5,
        rawText: '{}',
        userPrompt: '',
      };
    });

    const job = await insertJob(env, {
      installationId: '123',
      owner: 'test-owner',
      repo,
      prNumber: 6,
      prTitle: 'Concurrent Test',
      prAuthor: 'author',
      commitSha: headSha,
      baseSha,
      trigger: 'auto',
      headRef: 'feature',
      baseRef: 'main',
      configSnapshot: defaultRepoConfig,
    });
    await updateJobFileCount(env, job.id, 3);
    await updateJobStep(env, job.id, 'Preparation', { status: 'done' });

    await (async () => {
      (env.REVIEW_QUEUE as any).sent.length = 0;
      const result = await runReviewJob(env, {
        jobId: job.id,
        deliveryId: 'delivery-concurrent',
        phase: 'review',
      });

      expect(result).toEqual({ action: 'ack' });
      // REVIEW_CHUNK_FILE_LIMIT caps concurrent FILES at 3; each file also fans
      // out to every planned reviewer concurrently (trivial tier under
      // defaultRepoConfig = security + correctness), so max concurrent
      // reviewFile() calls is filesInFlight x reviewersPerFile.
      const reviewersPerFile = planReviewers(3, 3, defaultRepoConfig.review).length;
      expect(maxActive).toBe(3 * reviewersPerFile);
      expect((env.REVIEW_QUEUE as any).sent[0]).toMatchObject({ jobId: job.id, phase: 'finalize' });
    })();

    const reviews = await getFileReviewsForJobs(env, [job.id]);
    expect(reviews.filter((review) => review.file_status === 'done')).toHaveLength(3);

    reviewSpy.mockRestore();
    getDiffSpy.mockRestore();
  }, REVIEW_FLOW_TIMEOUT_MS);

  it('fans out to multiple specialized reviewers on a small PR and persists engine_used=native', async () => {
    const repo = `test-repo-${Date.now()}-fanout`;
    const headSha = sha('1');
    const baseSha = sha('2');

    await runAndDrain({
      deliveryId: 'delivery-fanout',
      eventName: 'pull_request',
      payload: {
        action: 'opened',
        installation: { id: 123 },
        repository: { owner: { login: 'test-owner' }, name: repo },
        pull_request: {
          number: 2,
          head: { sha: headSha, ref: 'feature' },
          base: { sha: baseSha, ref: 'main' },
          title: 'Test PR',
          user: { login: 'author' },
          draft: false,
        },
      },
    });

    const finalJob = await findExistingJobForHead(env, {
      owner: 'test-owner',
      repo,
      prNumber: 2,
      commitSha: headSha,
      trigger: 'auto',
    });
    expect(finalJob?.status).toBe('done');

    // Default config, tiny diff -> trivial risk tier -> 2 reviewers (security +
    // correctness). The shared mocked ModelService.reviewFile ignores its
    // params and always returns 1 comment / 10 input / 5 output tokens, so the
    // fanned-out aggregate for this file should be exactly double.
    const reviewersPerFile = planReviewers(1, 1, defaultRepoConfig.review).length;
    expect(reviewersPerFile).toBe(2);

    const reviews = await getFileReviewsForJobs(env, [finalJob!.id]);
    const fileReview = reviews.find((r) => r.file_path === 'src/app.ts');
    expect(fileReview?.file_status).toBe('done');
    expect(fileReview?.engine_used).toBe('native');
    expect(fileReview?.input_tokens).toBe(10 * reviewersPerFile);
    expect(fileReview?.output_tokens).toBe(5 * reviewersPerFile);
    expect(fileReview?.parsed_comments).toHaveLength(reviewersPerFile);
  }, REVIEW_FLOW_TIMEOUT_MS);

  it('bounds subrequests for a large multi-file PR and batches DO comment streaming per file', async () => {
    const { GitHubService } = await import('@server/services/github');
    const { ModelService } = await import('@server/services/model');
    const repo = `test-repo-${Date.now()}-budget`;
    const headSha = sha('3');
    const baseSha = sha('4');

    // >100 total added lines across 5 files -> full risk tier (6 reviewers)
    // under defaultRepoConfig's risk_tiers (lite_max_lines: 100).
    const files = Array.from({ length: 5 }, (_, i) => ({
      path: `src/file${i}.ts`,
      content: Array.from({ length: 25 }, (_, j) => `console.log(${i}, ${j});`).join('\n'),
    }));
    const getDiffSpy = vi.spyOn(GitHubService.prototype, 'getPullRequestDiff').mockResolvedValue(generateMockDiff(files));
    const reviewSpy = vi.spyOn(ModelService.prototype as any, 'reviewFile');

    // No PrReviewStream binding is provided by createTestEnv (see helpers.ts),
    // so wire up a stub that records every DO fetch's body — this is what
    // proves comments are batched into ONE array per file instead of one
    // fetch per comment (the CRITICAL fix: up to 6 reviewers x max_comments
    // findings per file previously meant up to ~60 DO fetches PER FILE).
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

    const job = await insertJob(env, {
      installationId: '123',
      owner: 'test-owner',
      repo,
      prNumber: 9,
      prTitle: 'Budget Test',
      prAuthor: 'author',
      commitSha: headSha,
      baseSha,
      trigger: 'auto',
      headRef: 'feature',
      baseRef: 'main',
      configSnapshot: defaultRepoConfig,
    });
    await updateJobFileCount(env, job.id, files.length);
    await updateJobStep(env, job.id, 'Preparation', { status: 'done' });

    const reviewersPerFile = planReviewers(200, files.length, defaultRepoConfig.review).length;
    expect(reviewersPerFile).toBe(6);

    (env.REVIEW_QUEUE as any).sent.length = 0;
    // A single invocation, not drained: proves what ONE queue message does,
    // which is exactly the unit Cloudflare's 50-subrequest cap applies to.
    const result = await runReviewJob(env, { jobId: job.id, deliveryId: 'delivery-budget', phase: 'review' });
    expect(result).toEqual({ action: 'ack' });

    // REVIEW_CHUNK_FILE_LIMIT (3) x reviewersPerFile (6) = 18 model calls max
    // for this invocation — nowhere near the 50-subrequest cap, and NOT
    // files.length(5) x reviewersPerFile(6) = 30 all fired in one shot.
    expect(reviewSpy.mock.calls.length).toBeGreaterThan(0);
    expect(reviewSpy.mock.calls.length).toBeLessThanOrEqual(3 * reviewersPerFile);
    expect(reviewSpy.mock.calls.length).toBeLessThan(50);

    // One DO fetch per file processed (not per comment), and each one carries
    // an array of that file's aggregated comments.
    expect(doFetchBodies.length).toBeGreaterThan(0);
    expect(doFetchBodies.length).toBeLessThanOrEqual(3);
    for (const body of doFetchBodies) {
      expect(Array.isArray(body)).toBe(true);
    }

    // Not every file fit in this invocation's chunk, so the job re-enqueued
    // 'review' to continue the rest next invocation instead of exceeding the
    // budget trying to do it all at once.
    expect((env.REVIEW_QUEUE as any).sent.some((m: any) => m.jobId === job.id && m.phase === 'review')).toBe(true);

    reviewSpy.mockRestore();
    getDiffSpy.mockRestore();
    delete (env as any).PrReviewStream;
  }, REVIEW_FLOW_TIMEOUT_MS);

  it('marks completed jobs with skipped files as partial reviews', async () => {
    const { GitHubService } = await import('@server/services/github');
    const { ModelService } = await import('@server/services/model');
    const repo = `test-repo-${Date.now()}-partial`;
    const headSha = sha('e');
    const baseSha = sha('f');
    const getDiffSpy = vi.spyOn(GitHubService.prototype, 'getPullRequestDiff').mockResolvedValue(
      generateMockDiff([
        { path: 'src/app.ts', content: 'console.log(1);' },
        { path: 'src/failed.ts', content: 'console.log(2);' },
      ]),
    );

    const job = await insertJob(env, {
      installationId: '123',
      owner: 'test-owner',
      repo,
      prNumber: 7,
      prTitle: 'Partial Test',
      prAuthor: 'author',
      commitSha: headSha,
      baseSha,
      trigger: 'auto',
      headRef: 'feature',
      baseRef: 'main',
      configSnapshot: defaultRepoConfig,
    });
    const summarySpy = vi.spyOn(ModelService.prototype as any, 'generateSummary');
    await updateJobFileCount(env, job.id, 2);
    await updateJobStep(env, job.id, 'Preparation', { status: 'done' });
    await updateJobStep(env, job.id, 'Reviewing Files', { status: 'done' });
    await upsertFileReview(env, job.id, {
      filePath: 'src/app.ts',
      fileStatus: 'done',
      modelUsed: 'test-model',
      modelProvider: 'test-provider',
      diffLineCount: 1,
      diffInput: 'diff',
      rawAiOutput: '{}',
      parsedComments: [],
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
      verdict: 'approve',
      fileSummary: 'ok',
      errorMessage: null,
    });
    await upsertFileReview(env, job.id, {
      filePath: 'src/failed.ts',
      fileStatus: 'failed',
      modelUsed: 'gemma-4-31b-it',
      modelProvider: 'google',
      diffLineCount: 1,
      diffInput: '',
      rawAiOutput: null,
      parsedComments: [],
      inputTokens: null,
      outputTokens: null,
      durationMs: 1,
      verdict: null,
      fileSummary: null,
      errorMessage: 'Review skipped after 3 repeated model provider outages.',
    });

    await (async () => {
      (env.REVIEW_QUEUE as any).sent.length = 0;
      const result = await runReviewJob(env, {
        jobId: job.id,
        deliveryId: 'delivery-partial',
        phase: 'finalize',
      });
      expect(result).toEqual({ action: 'ack' });
    })();

    const finalJob = await getJobForProcessing(env, job.id);
    expect(finalJob?.status).toBe('done');
    expect(finalJob?.error_msg).toContain('Partial review: 1 of 2 files');
    const steps = typeof finalJob?.steps === 'string' ? JSON.parse(finalJob.steps) : finalJob?.steps;
    expect(steps?.find((step: { name: string }) => step.name === 'Completing')?.status).toBe('done');
    expect(finalJob?.summary_markdown).toMatch(/^### .*Codra Review/);
    expect(finalJob?.summary_model).toBeNull();
    expect(summarySpy).not.toHaveBeenCalled();
    summarySpy.mockRestore();
    getDiffSpy.mockRestore();
  }, REVIEW_FLOW_TIMEOUT_MS);

  it('coordinator source-verification reads the PR head SHA, not the default branch', async () => {
    const { GitHubService } = await import('@server/services/github');
    const repo = `test-repo-${Date.now()}-coordinator`;
    const headSha = sha('c');
    const baseSha = sha('d');
    const getDiffSpy = vi.spyOn(GitHubService.prototype, 'getPullRequestDiff').mockResolvedValue(
      generateMockDiff([
        { path: 'src/app.ts', content: 'console.log(1);' },
        { path: 'src/other.ts', content: 'console.log(2);' },
      ]),
    );
    const getFileSpy = vi.spyOn(GitHubService.prototype as any, 'getRepoFileWithRefOrNull');

    const job = await insertJob(env, {
      installationId: '123',
      owner: 'test-owner',
      repo,
      prNumber: 8,
      prTitle: 'Coordinator Test',
      prAuthor: 'author',
      commitSha: headSha,
      baseSha,
      trigger: 'auto',
      headRef: 'feature',
      baseRef: 'main',
      configSnapshot: { ...defaultRepoConfig, review: { ...defaultRepoConfig.review, coordinator: 'test-model' } },
    });
    await updateJobFileCount(env, job.id, 2);
    await updateJobStep(env, job.id, 'Preparation', { status: 'done' });
    await updateJobStep(env, job.id, 'Reviewing Files', { status: 'done' });
    const lowConfidenceComment = {
      path: 'src/app.ts', line: 1, position: 1, severity: 'P2' as const, category: 'quality' as const,
      title: 'Maybe an issue', body: 'Not sure', confidenceScore: 0.3,
    };
    await upsertFileReview(env, job.id, {
      filePath: 'src/app.ts',
      fileStatus: 'done',
      modelUsed: 'test-model',
      modelProvider: 'test-provider',
      diffLineCount: 1,
      diffInput: 'diff',
      rawAiOutput: '{}',
      parsedComments: [lowConfidenceComment],
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
      verdict: 'comment',
      fileSummary: 'ok',
      errorMessage: null,
    });
    await upsertFileReview(env, job.id, {
      filePath: 'src/other.ts',
      fileStatus: 'done',
      modelUsed: 'test-model',
      modelProvider: 'test-provider',
      diffLineCount: 1,
      diffInput: 'diff',
      rawAiOutput: '{}',
      parsedComments: [{ ...lowConfidenceComment, path: 'src/other.ts', title: 'Another maybe' }],
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
      verdict: 'comment',
      fileSummary: 'ok',
      errorMessage: null,
    });

    const result = await runReviewJob(env, { jobId: job.id, deliveryId: 'delivery-coordinator', phase: 'finalize' });
    expect(result).toEqual({ action: 'ack' });

    // The mocked GitHubService.getPullRequest() always returns head.sha: 'headsha'
    // regardless of the job's own commitSha — asserting against that literal
    // (not the job's headSha) is what proves fetchSource threads pr.head.sha
    // rather than defaulting to no ref (the default branch).
    expect(getFileSpy).toHaveBeenCalled();
    for (const call of getFileSpy.mock.calls) {
      expect(call[3]).toBe('headsha'); // ref must be the PR head, not the default branch
    }

    getFileSpy.mockRestore();
    getDiffSpy.mockRestore();
  }, REVIEW_FLOW_TIMEOUT_MS);

  it('finalize re-enqueues review when seeded pending placeholders remain', async () => {
    const { GitHubService } = await import('@server/services/github');
    const repo = `test-repo-${Date.now()}-pending-finalize`;
    const headSha = sha('e');
    const getDiffSpy = vi.spyOn(GitHubService.prototype, 'getPullRequestDiff').mockResolvedValue(
      generateMockDiff([
        { path: 'src/done.ts', content: 'done();' },
        { path: 'src/pending.ts', content: 'pending();' },
      ]),
    );

    const job = await insertJob(env, {
      installationId: '123',
      owner: 'test-owner',
      repo,
      prNumber: 9,
      prTitle: 'Pending finalize',
      prAuthor: 'author',
      commitSha: headSha,
      baseSha: sha('f'),
      trigger: 'auto',
      headRef: 'feature',
      baseRef: 'main',
      configSnapshot: defaultRepoConfig,
    });
    await updateJobFileCount(env, job.id, 2);
    await updateJobStep(env, job.id, 'Preparation', { status: 'done' });
    await updateJobStep(env, job.id, 'Reviewing Files', { status: 'running' });
    await upsertFileReview(env, job.id, {
      filePath: 'src/done.ts',
      fileStatus: 'done',
      modelUsed: 'test-model',
      modelProvider: 'test-provider',
      diffLineCount: 1,
      diffInput: 'diff',
      rawAiOutput: '{}',
      parsedComments: [],
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
      verdict: 'approve',
      fileSummary: 'ok',
      errorMessage: null,
    });
    await upsertFileReview(env, job.id, {
      filePath: 'src/pending.ts',
      fileStatus: 'pending',
      modelUsed: 'pending',
      diffLineCount: 1,
      diffInput: 'diff',
      rawAiOutput: null,
      parsedComments: [],
      inputTokens: null,
      outputTokens: null,
      durationMs: null,
      verdict: null,
      fileSummary: null,
      errorMessage: null,
    });

    (env.REVIEW_QUEUE as any).sent.length = 0;
    const result = await runReviewJob(env, {
      jobId: job.id,
      deliveryId: 'delivery-pending-finalize',
      phase: 'finalize',
    });
    expect(result).toEqual({ action: 'ack' });
    expect((env.REVIEW_QUEUE as any).sent[0]).toMatchObject({ jobId: job.id, phase: 'review' });

    const jobAfter = await getJobForProcessing(env, job.id);
    expect(jobAfter?.status).not.toBe('done');

    getDiffSpy.mockRestore();
  }, REVIEW_FLOW_TIMEOUT_MS);
});
