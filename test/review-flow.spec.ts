import { runReviewJob } from '@server/core/review';
import { createTestEnv, generateMockDiff } from './helpers';
import { vi } from 'vitest';
import { insertJob, getJobForProcessing } from '@server/db/jobs';
import { defaultRepoConfig } from '@shared/schema';

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
    return { ModelService: MockModelService };
});

describe('Review Flow Lifecycle', () => {
  const env = createTestEnv();

  it('completes a full review from pending job to finished', async () => {
    const job = await insertJob(env, {
      installationId: '123',
      owner: 'test-owner',
      repo: 'test-repo',
      prNumber: 1,
      prTitle: 'Test PR',
      prAuthor: 'author',
      commitSha: 'headsha',
      baseSha: 'basesha',
      trigger: 'auto',
      headRef: 'feature',
      baseRef: 'main',
      configSnapshot: defaultRepoConfig,
    });

    await runReviewJob(env, {
      jobId: job.id,
      deliveryId: 'delivery-123',
      installationId: '123',
      owner: 'test-owner',
      repo: 'test-repo',
      prNumber: 1,
      commitSha: 'headsha',
      trigger: 'auto',
    });

    const finalJob = await getJobForProcessing(env, job.id);
    expect(finalJob?.status).toBe('done');
  });

  it('stops processing if the job is superseded mid-way', async () => {
      const { GitHubService } = await import('@server/services/github');
      
      const job = await insertJob(env, {
        installationId: 'test-owner-supersede',
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 2,
        prTitle: 'Supersede Test',
        prAuthor: 'author',
        commitSha: 'headsha-2',
        baseSha: 'basesha-2',
        trigger: 'auto',
        headRef: 'feature',
        baseRef: 'main',
        configSnapshot: defaultRepoConfig,
      });

      // Spy on the prototype of our mocked class
      const getDiffSpy = vi.spyOn(GitHubService.prototype, 'getPullRequestDiff');
      
      getDiffSpy.mockImplementationOnce(async () => {
          const { getDb } = await import('@server/db/client');
          const sql = getDb(env);
          await sql.query('UPDATE jobs SET status = \'superseded\' WHERE id = $1', [job.id]);
          return generateMockDiff([{ path: 'test.ts', content: 'a' }]);
      });

      await runReviewJob(env, {
        jobId: job.id,
        deliveryId: 'delivery-456',
        installationId: '123',
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 2,
        commitSha: 'headsha-2',
        trigger: 'auto',
      });

      const finalJob = await getJobForProcessing(env, job.id);
      expect(finalJob?.status).toBe('superseded');
      expect(finalJob?.verdict).toBeNull();
  });
});
