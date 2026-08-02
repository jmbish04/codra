import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { createAgentRouter } from '@server/routes/api/agent';
import { getDb } from '@server/db/client';
import { repositories } from '@server/db/schemas';
import { createFleetJob, claimFleetJob, listQueuedFleetJobs, completeFleetJob, getFleetJob } from '@server/db/fleet-jobs';
import { createTestEnv } from './helpers';

const KEY = 'test-webhook-secret';
const authed = { 'X-API-Key': KEY, 'content-type': 'application/json' } as const;

async function seedRepo(env: Env, owner: string, repo: string) {
  const [row] = await getDb(env).insert(repositories).values({ installation_id: 1, owner, repo }).returning();
  return row.id;
}

describe('fleet-jobs db', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('queues, lists with repo string, claims once, and completes', async () => {
    const repoId = await seedRepo(env, 'acme', 'widgets');
    const job = await createFleetJob(env, { repositoryId: repoId, kind: 'analyze', params: { milestone: '1' } });
    expect(job.status).toBe('queued');

    const queued = await listQueuedFleetJobs(env);
    expect(queued[0]).toMatchObject({ jobId: job.job_id, kind: 'analyze', repository: 'acme/widgets' });
    expect((queued[0].params as any).milestone).toBe('1');

    expect(await claimFleetJob(env, job.job_id, 'mac-1')).toBe(true);
    expect(await claimFleetJob(env, job.job_id, 'mac-2')).toBe(false); // already running
    expect(await listQueuedFleetJobs(env)).toHaveLength(0);

    await completeFleetJob(env, job.job_id, { status: 'completed', result: { merged: ['#10'] } });
    expect((await getFleetJob(env, job.job_id))?.status).toBe('completed');
  });
});

describe('fleet-jobs agent endpoints', () => {
  let env: Env;
  const app = new Hono<AppEnv>();
  app.route('/api/agent', createAgentRouter());
  beforeEach(() => { env = createTestEnv(); });

  it('serves queued jobs, claims, and records results (key-guarded)', async () => {
    expect((await app.request('/api/agent/fleet-jobs', {}, env)).status).toBe(401);

    const repoId = await seedRepo(env, 'acme', 'widgets');
    const job = await createFleetJob(env, { repositoryId: repoId, kind: 'merge', params: { prs: [10, 11] } });

    const list = await (await app.request('/api/agent/fleet-jobs', { headers: { 'X-API-Key': KEY } }, env)).json() as any;
    expect(list.jobs[0].jobId).toBe(job.job_id);

    const claim = await app.request(`/api/agent/fleet-jobs/${job.job_id}/claim`, { method: 'POST', headers: authed, body: JSON.stringify({ runner: 'mac-1' }) }, env);
    expect(claim.status).toBe(200);
    const claim2 = await app.request(`/api/agent/fleet-jobs/${job.job_id}/claim`, { method: 'POST', headers: authed, body: JSON.stringify({ runner: 'mac-2' }) }, env);
    expect(claim2.status).toBe(409);

    const result = await app.request(`/api/agent/fleet-jobs/${job.job_id}/result`, { method: 'POST', headers: authed, body: JSON.stringify({ status: 'completed', result: { merged: ['#10', '#11'] } }) }, env);
    expect(result.status).toBe(200);
    expect((await getFleetJob(env, job.job_id))?.status).toBe('completed');
  });
});
