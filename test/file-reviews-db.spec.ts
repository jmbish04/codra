import { describe, it, expect, beforeEach } from 'vitest';
import type { ParsedReviewComment } from '@shared/schema';
import { getDb } from '@server/db/client';
import { jobs, repositories, fileReviews } from '@server/db/schemas';
import { eq } from 'drizzle-orm';
import {
  insertFileReview,
  upsertFileReview,
  batchInsertFileReviews,
  getFileReviewsForJobs,
  REVIEW_COMMENTS_INSERT_CHUNK,
  FILE_REVIEWS_INSERT_CHUNK,
} from '@server/db/file-reviews';
import { createTestEnv } from './helpers';

function comment(i: number): ParsedReviewComment {
  return {
    path: `src/file-${i}.ts`,
    line: i,
    position: null,
    severity: 'P2',
    category: 'quality',
    title: `Issue ${i}`,
    body: `Body ${i}`,
    codeSuggestion: null,
  };
}

// 25 comments spans multiple chunks (>2x the chunk size), so a single
// unbounded multi-row insert would bind 25*9=225 params — over D1's 100 cap.
const N = 25;
const multi = Array.from({ length: N }, (_, i) => comment(i + 1));

async function seedJob(env: Env) {
  const db = getDb(env);
  const [repo] = await db.insert(repositories).values({ installation_id: 1, owner: 'acme', repo: 'widgets' }).returning();
  await db.insert(jobs).values({ id: 'job-1', repository_id: repo.id, pr_number: 1, status: 'reviewing', commit_sha: 'abc123', base_sha: 'def456', trigger: 'manual' } as any);
}

const baseReview = {
  fileStatus: 'done' as const,
  modelUsed: 'test-model',
  diffLineCount: 10,
  diffInput: 'diff',
  rawAiOutput: 'out',
  inputTokens: 1,
  outputTokens: 1,
  durationMs: 1,
  verdict: 'comment' as const,
  fileSummary: 'summary',
  errorMessage: null,
};

describe('file-reviews multi-row review_comments insert', () => {
  let env: Env;
  beforeEach(async () => { env = createTestEnv(); await seedJob(env); });

  // The real regression guard: node:sqlite does not enforce D1's 100-param cap,
  // so the integration tests below pass even on the buggy code. These assert the
  // chunk math stays under the cap regardless of the shim's leniency.
  it('review_comments chunk stays within D1 100-bound-param cap', () => {
    expect(REVIEW_COMMENTS_INSERT_CHUNK * 9).toBeLessThanOrEqual(100);
    expect(REVIEW_COMMENTS_INSERT_CHUNK).toBeGreaterThan(0);
  });

  it('file_reviews chunk stays within D1 100-bound-param cap', () => {
    expect(FILE_REVIEWS_INSERT_CHUNK * 17).toBeLessThanOrEqual(100);
    expect(FILE_REVIEWS_INSERT_CHUNK).toBeGreaterThan(0);
  });

  it('insertFileReview persists multiple comments', async () => {
    await insertFileReview(env, { jobId: 'job-1', filePath: 'a.ts', parsedComments: multi, ...baseReview });
    const [row] = await getFileReviewsForJobs(env, ['job-1']);
    expect(row.parsed_comments).toHaveLength(N);
  });

  it('upsertFileReview persists multiple comments', async () => {
    await upsertFileReview(env, 'job-1', { filePath: 'b.ts', parsedComments: multi, ...baseReview });
    const rows = await getFileReviewsForJobs(env, ['job-1']);
    expect(rows.find(r => r.file_path === 'b.ts')!.parsed_comments).toHaveLength(N);
  });

  it('upsertFileReview persists best_practice_checks as JSON', async () => {
    await upsertFileReview(env, 'job-1', {
      filePath: 'bp.ts',
      parsedComments: [],
      ...baseReview,
      bestPracticeChecks: [{ practice: 'D1 Bulk Insert Batching', status: 'violation', note: 'no batch' }],
    });
    const db = getDb(env);
    const [row] = await db.select().from(fileReviews).where(eq(fileReviews.file_path, 'bp.ts'));
    expect(JSON.parse(row.best_practice_checks!)).toEqual([
      { practice: 'D1 Bulk Insert Batching', status: 'violation', note: 'no batch' },
    ]);
  });

  it('batchInsertFileReviews persists multiple comments', async () => {
    await batchInsertFileReviews(env, 'job-1', [
      { filePath: 'c.ts', parsedComments: multi, ...baseReview },
    ]);
    const rows = await getFileReviewsForJobs(env, ['job-1']);
    expect(rows.find(r => r.file_path === 'c.ts')!.parsed_comments).toHaveLength(N);
  });

  // Many files spans multiple file_reviews chunks (12 files * 17 params = 204,
  // over the cap unbatched). Each file also carries multi comments, exercising
  // both chunked db.batch() paths and the cross-chunk returning() → comment map.
  it('batchInsertFileReviews persists many files across chunks', async () => {
    const files = Array.from({ length: 12 }, (_, i) => ({
      filePath: `many-${i}.ts`,
      parsedComments: [comment(i), comment(i + 100)],
      ...baseReview,
    }));
    await batchInsertFileReviews(env, 'job-1', files);
    const rows = await getFileReviewsForJobs(env, ['job-1']);
    const many = rows.filter(r => r.file_path.startsWith('many-'));
    expect(many).toHaveLength(12);
    expect(many.every(r => r.parsed_comments.length === 2)).toBe(true);
  });
});
