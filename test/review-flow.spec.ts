import { runReviewJob } from '@server/core/review';
import { createTestEnv, generateMockDiff } from './helpers';
import { vi } from 'vitest';
import { findExistingJobForHead, getJobForProcessing, insertJob } from '@server/db/jobs';
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
});
