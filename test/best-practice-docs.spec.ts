import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getDb } from '@server/db/client';
import { jobs, repositories, fileReviews } from '@server/db/schemas';
import { createBestPractice } from '@server/db/best-practices';
import { aggregateBestPracticeDocs } from '@server/core/best-practice-docs';
import { createTestEnv } from './helpers';

async function seed(env: Env) {
  const db = getDb(env);
  const [repo] = await db.insert(repositories).values({ installation_id: 1, owner: 'o', repo: 'r' }).returning();
  await db.insert(jobs).values({ id: 'job-1', repository_id: repo.id, pr_number: 1, status: 'running', commit_sha: 'aa', base_sha: 'bb', trigger: 'manual' } as any);
  await createBestPractice(env, { name: 'D1 Bulk Insert Batching', infraId: 'cloudflare-workers', criteria: 'd1', instructions: '[]' });
  await db.insert(fileReviews).values([
    { job_id: 'job-1', file_path: 'a.ts', file_status: 'done', model_used: 'm', best_practice_checks: JSON.stringify([{ practice: 'D1 Bulk Insert Batching', status: 'violation', note: 'x' }]) },
    { job_id: 'job-1', file_path: 'b.ts', file_status: 'done', model_used: 'm', best_practice_checks: JSON.stringify([{ practice: 'D1 Bulk Insert Batching', status: 'pass' }]) },
  ] as any);
}

describe('aggregateBestPracticeDocs', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ result: { content: [{ type: 'text', text: 'D1 docs body' }] } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as any;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  it('tallies violations and attaches CF docs', async () => {
    const env = createTestEnv();
    await seed(env);
    const payload = await aggregateBestPracticeDocs(env, 'job-1');
    expect(payload.violated).toEqual(['D1 Bulk Insert Batching']);
    expect(payload.checks).toEqual([{ practice: 'D1 Bulk Insert Batching', passed: 1, violated: 1 }]);
    expect(payload.docs).toEqual([{ query: 'D1 Bulk Insert Batching', source: 'cloudflare-docs', content: 'D1 docs body' }]);
    // persisted on the job row
    const db = getDb(env);
    const { eq } = await import('drizzle-orm');
    const [job] = await db.select().from(jobs).where(eq(jobs.id, 'job-1'));
    expect(JSON.parse(job.best_practice_docs!).violated).toEqual(['D1 Bulk Insert Batching']);
  });
});
