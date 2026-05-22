import { runReviewJob } from '@server/core/review';
import { createTestEnv, generateMockDiff, hasConfiguredTestDatabaseUrl } from './helpers';
import { vi } from 'vitest';
import { findExistingJobForHead, getJobForProcessing, insertJob, updateJobFileCount, updateJobStep } from '@server/db/jobs';
import { getFileReviewsForJobs, upsertFileReview } from '@server/db/file-reviews';
import { defaultRepoConfig } from '@shared/schema';
import { runWithDb } from '@server/db/client';

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
        async removeIssueLabel() { return {}; }
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
                rawText: '{"summary": "test"}',
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
    await runWithDb(env, async () => {
      (env.REVIEW_QUEUE as any).sent.length = 0;
      await runReviewJob(env, message);
      const queue = env.REVIEW_QUEUE as any;
      while (queue.sent.length > 0) {
        const next = queue.sent.shift();
        await runReviewJob(env, next);
      }
    });
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
      
      getDiffSpy.mockImplementationOnce(async () => {
          const { getDb } = await import('@server/db/client');
          const sql = getDb(env);
          await sql.query(
            `
              UPDATE jobs j
              SET status = 'superseded'
              FROM repositories r
              WHERE j.repository_id = r.id
                AND r.owner = $1
                AND r.repo = $2
                AND j.pr_number = $3
            `,
            ['test-owner', repo, 2],
          );
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

    await runWithDb(env, async () => {
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
        options: { delaySeconds: 60 },
      });
    });

    const finalJob = await getJobForProcessing(env, job.id);
    expect(finalJob?.status).toBe('running');
    expect(finalJob?.lease_owner).toBeNull();

    reviewSpy.mockRestore();
  }, REVIEW_FLOW_TIMEOUT_MS);

  it('marks completed jobs with skipped files as partial reviews', async () => {
    const { GitHubService } = await import('@server/services/github');
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

    await runWithDb(env, async () => {
      (env.REVIEW_QUEUE as any).sent.length = 0;
      const result = await runReviewJob(env, {
        jobId: job.id,
        deliveryId: 'delivery-partial',
        phase: 'finalize',
      });
      expect(result).toEqual({ action: 'ack' });
    });

    const finalJob = await getJobForProcessing(env, job.id);
    expect(finalJob?.status).toBe('done');
    expect(finalJob?.error_msg).toContain('Partial review: 1 of 2 files');
    getDiffSpy.mockRestore();
  }, REVIEW_FLOW_TIMEOUT_MS);
});
