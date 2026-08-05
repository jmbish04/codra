import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '@server/db/client';
import { jobs, repositories } from '@server/db/schemas';
import { eq } from 'drizzle-orm';
import { cancelJob, cancelQueuedJobs } from '@server/db/jobs';
import { createTestEnv } from './helpers';

async function seedRepo(env: Env): Promise<number> {
  const [row] = await getDb(env).insert(repositories)
    .values({ installation_id: 1, owner: 'acme', repo: 'app' })
    .returning({ id: repositories.id });
  return row.id;
}

async function seedJob(env: Env, status: string, repositoryId: number): Promise<string> {
  const db = getDb(env);
  const [row] = await db.insert(jobs).values({
    repository_id: repositoryId,
    pr_number: 1,
    commit_sha: new Uint8Array([1]),
    base_sha: new Uint8Array([2]),
    trigger: 'sync',
    status,
  }).returning({ id: jobs.id });
  return row.id;
}

const statusOf = async (env: Env, id: string) =>
  (await getDb(env).select({ status: jobs.status }).from(jobs).where(eq(jobs.id, id)).get())?.status;

describe('queue cancellation', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('cancelQueuedJobs supersedes only queued jobs, leaving running/terminal alone', async () => {
    const repo = await seedRepo(env);
    const q1 = await seedJob(env, 'queued', repo);
    const q2 = await seedJob(env, 'queued', repo);
    const running = await seedJob(env, 'running', repo);
    const done = await seedJob(env, 'done', repo);

    const cancelled = await cancelQueuedJobs(env, 'test clear');
    expect(cancelled.sort()).toEqual([q1, q2].sort());

    expect(await statusOf(env, q1)).toBe('superseded');
    expect(await statusOf(env, q2)).toBe('superseded');
    expect(await statusOf(env, running)).toBe('running'); // in-flight job untouched
    expect(await statusOf(env, done)).toBe('done');
  });

  it('cancelJob cancels queued or running, but no-ops on a terminal job', async () => {
    const repo = await seedRepo(env);
    const queued = await seedJob(env, 'queued', repo);
    const running = await seedJob(env, 'running', repo);
    const done = await seedJob(env, 'done', repo);

    expect(await cancelJob(env, queued, 'x')).toBe(true);
    expect(await statusOf(env, queued)).toBe('superseded');

    expect(await cancelJob(env, running, 'x')).toBe(true);
    expect(await statusOf(env, running)).toBe('superseded');

    expect(await cancelJob(env, done, 'x')).toBe(false); // already terminal
    expect(await statusOf(env, done)).toBe('done');
  });
});
