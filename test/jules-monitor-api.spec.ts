import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { createPlanningPackagesRouter } from '@server/routes/api/planning-packages';
import { getDb } from '@server/db/client';
import { repositories } from '@server/db/schemas';
import { createPackage } from '@server/db/planning-packages';
import { createOrchestrationTask, updateTaskStatus, logTaskEvent } from '@server/db/jules-orchestration';
import { upsertActivities } from '@server/db/jules-activities';
import { recordHeartbeat } from '@server/db/agent-heartbeats';
import { createTestEnv } from './helpers';

function makeApp() {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('sessionUser', { githubUserId: 1, login: 'tester', name: null, avatarUrl: null, email: null, signedInAt: '' });
    await next();
  });
  app.route('/api/planning-packages', createPlanningPackagesRouter());
  return app;
}

async function seedRepo(env: Env, owner: string, repo: string) {
  const [row] = await getDb(env).insert(repositories).values({ installation_id: 1, owner, repo }).returning();
  return row.id;
}

describe('jules monitoring endpoints', () => {
  let env: Env;
  const app = makeApp();
  beforeEach(() => { env = createTestEnv(); });

  it('maps a joined task to the camelCase DTO with sessionUrl + repository', async () => {
    const repoId = await seedRepo(env, 'acme', 'widgets');
    const pkg = await createPackage(env, { repositoryId: repoId, slug: 'feature-abc', title: 'Feature ABC' });
    const task = await createOrchestrationTask(env, { packageId: pkg.id, repositoryId: repoId });
    await updateTaskStatus(env, task.task_id, { status: 'planning', sessionId: 'sess-9' });

    const res = await app.request('/api/planning-packages/orchestration/tasks', {}, env);
    const body = await res.json() as any;
    expect(body.total).toBe(1);
    expect(body.tasks[0]).toMatchObject({
      taskId: task.task_id, packageTitle: 'Feature ABC', packageSlug: 'feature-abc',
      repository: 'acme/widgets', repositoryId: repoId, sessionId: 'sess-9',
      sessionUrl: 'https://jules.google.com/session/sess-9', status: 'planning', iterations: 0,
    });
    expect(body.summary.total).toBe(1);
    expect(body.summary.active).toBe(1);
  });

  it('filters by status/repository/query and paginates', async () => {
    const r1 = await seedRepo(env, 'acme', 'alpha');
    const r2 = await seedRepo(env, 'other', 'beta');
    const p1 = await createPackage(env, { repositoryId: r1, slug: 'login-flow', title: 'Login flow' });
    const p2 = await createPackage(env, { repositoryId: r2, slug: 'billing', title: 'Billing' });
    const t1 = await createOrchestrationTask(env, { packageId: p1.id, repositoryId: r1 });
    const t2 = await createOrchestrationTask(env, { packageId: p2.id, repositoryId: r2 });
    await updateTaskStatus(env, t1.task_id, { status: 'planning' });
    await updateTaskStatus(env, t2.task_id, { status: 'accepted' });

    const active = await (await app.request('/api/planning-packages/orchestration/tasks?status=active', {}, env)).json() as any;
    expect(active.tasks.map((t: any) => t.taskId)).toEqual([t1.task_id]);

    const byRepo = await (await app.request('/api/planning-packages/orchestration/tasks?repository=other/beta', {}, env)).json() as any;
    expect(byRepo.tasks.map((t: any) => t.taskId)).toEqual([t2.task_id]);

    const byQuery = await (await app.request('/api/planning-packages/orchestration/tasks?query=login', {}, env)).json() as any;
    expect(byQuery.tasks.map((t: any) => t.packageSlug)).toEqual(['login-flow']);

    const paged = await (await app.request('/api/planning-packages/orchestration/tasks?limit=1&offset=1', {}, env)).json() as any;
    expect(paged.total).toBe(2);
    expect(paged.tasks).toHaveLength(1);
  });

  it('returns task + health, and 404 for unknown', async () => {
    const repoId = await seedRepo(env, 'acme', 'widgets');
    const pkg = await createPackage(env, { repositoryId: repoId, slug: 's', title: 'T' });
    const task = await createOrchestrationTask(env, { packageId: pkg.id, repositoryId: repoId });
    await recordHeartbeat(env, { agentId: 'mac-1', hostname: 'studio', activeSessions: 1 });

    const ok = await app.request(`/api/planning-packages/orchestration/tasks/${task.task_id}`, {}, env);
    const body = await ok.json() as any;
    expect(body.task.taskId).toBe(task.task_id);
    expect(body.health.watcher.state).toBe('online');
    expect(body.health.mode).toBe('hybrid');

    const missing = await app.request('/api/planning-packages/orchestration/tasks/nope', {}, env);
    expect(missing.status).toBe(404);
  });

  it('reports offline/unknown health honestly when no heartbeat', async () => {
    const summary = await (await app.request('/api/planning-packages/orchestration/summary', {}, env)).json() as any;
    expect(summary.summary.health.watcher.state).toBe('unknown');
    expect(summary.summary.health.mode).toBe('unknown');
    expect(summary.summary.health.poller.state).toBe('unknown');
  });

  it('serves events (newest-first) and cached activities (oldest-first)', async () => {
    const repoId = await seedRepo(env, 'acme', 'widgets');
    const pkg = await createPackage(env, { repositoryId: repoId, slug: 's', title: 'T' });
    const task = await createOrchestrationTask(env, { packageId: pkg.id, repositoryId: repoId });
    await updateTaskStatus(env, task.task_id, { sessionId: 'sess-1' });
    await logTaskEvent(env, task.task_id, 'SESSION_STARTED', { sessionId: 'sess-1' });
    await upsertActivities(env, { sessionId: 'sess-1', taskId: task.task_id, activities: [
      { id: 'a1', type: 'agentMessaged', originator: 'agent', createTime: '2026-08-02T00:00:01Z', message: 'hi' },
    ] });

    const events = await (await app.request(`/api/planning-packages/orchestration/tasks/${task.task_id}/events`, {}, env)).json() as any;
    expect(events.events[0]).toMatchObject({ event: 'SESSION_STARTED', payload: { sessionId: 'sess-1' } });

    const acts = await (await app.request(`/api/planning-packages/orchestration/tasks/${task.task_id}/activities`, {}, env)).json() as any;
    expect(acts.activities[0]).toMatchObject({ id: 'a1', type: 'agentMessaged', message: 'hi' });
    expect(acts.syncedAt).toBeTruthy();
  });
});
