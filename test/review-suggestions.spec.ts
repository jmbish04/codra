import { it, expect } from 'vitest';
import { getDb } from '@server/db/client';
import { jobs, repositories, fileReviews } from '@server/db/schemas';
import { getReviewSuggestions } from '@server/db/jobs';
import { createTestEnv } from './helpers';

const JOB = '11111111-1111-1111-1111-111111111111';

it('includes bestPracticeChecks per file and job-level bestPractices', async () => {
  const env = createTestEnv();
  const db = getDb(env);
  const [repo] = await db.insert(repositories).values({ installation_id: 1, owner: 'o', repo: 'r' }).returning();
  await db.insert(jobs).values({
    id: JOB,
    repository_id: repo.id,
    pr_number: 1,
    status: 'done',
    commit_sha: 'aa',
    base_sha: 'bb',
    trigger: 'manual',
    best_practice_docs: JSON.stringify({
      violated: ['D1 Bulk Insert Batching'],
      checks: [{ practice: 'D1 Bulk Insert Batching', passed: 0, violated: 1 }],
      docs: [{ query: 'D1 Bulk Insert Batching', source: 'cloudflare-docs', content: 'body' }],
    }),
  } as any);
  await db.insert(fileReviews).values({
    job_id: JOB,
    file_path: 'a.ts',
    file_status: 'done',
    model_used: 'm',
    best_practice_checks: JSON.stringify([
      { practice: 'D1 Bulk Insert Batching', status: 'violation', note: 'x' },
    ]),
  } as any);

  const out = await getReviewSuggestions(env, JOB);
  expect(out!.files[0].bestPracticeChecks).toEqual([
    { practice: 'D1 Bulk Insert Batching', status: 'violation', note: 'x' },
  ]);
  expect(out!.bestPractices!.violated).toEqual(['D1 Bulk Insert Batching']);
  expect(out!.bestPractices!.docs[0].content).toBe('body');
});
