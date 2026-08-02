import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { createPlanningPackagesRouter } from '@server/routes/api/planning-packages';
import { createTestEnv } from './helpers';

// Mount the router in a bare app with a stub session — avoids importing
// @server/app (quarantined: pulls Workers-runtime-only modules under node).
function makeApp() {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('sessionUser', { githubUserId: 42, login: 'tester', name: null, avatarUrl: null, email: null, signedInAt: '' });
    await next();
  });
  app.route('/api/planning-packages', createPlanningPackagesRouter());
  return app;
}

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

describe('planning-packages API router', () => {
  let env: Env;
  const app = makeApp();
  beforeEach(() => { env = createTestEnv(); });

  it('rejects a create missing required fields', async () => {
    const res = await app.request('/api/planning-packages', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ title: 'no repo' }),
    }, env);
    expect(res.status).toBe(400);
  });

  it('creates, lists, appends a revision, streams context, and updates a task', async () => {
    // create
    const created = await app.request('/api/planning-packages', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ repositoryId: 1, title: 'Feature ABC' }),
    }, env);
    expect(created.status).toBe(201);
    const { package: pkg } = await created.json() as any;
    expect(pkg.slug).toBe('feature-abc');
    expect(pkg.created_by).toBe('tester');

    // list filtered by repo + status
    const listed = await app.request('/api/planning-packages?repo=1&status=draft', {}, env);
    expect((await listed.json() as any).packages).toHaveLength(1);

    // append a revision with context + a task
    const rev = await app.request(`/api/planning-packages/${pkg.id}/revisions`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({
        source: 'coding_agent', problem: 'P1',
        codeCards: [{ content: 'export const a = 1;' }],
        tasks: [{ taskKey: 'T1', title: 'do a' }],
        contextText: 'RAW DUMP', coverageNote: 'full',
      }),
    }, env);
    expect(rev.status).toBe(201);

    // full fielded revision
    const full = await app.request(`/api/planning-packages/${pkg.id}/revisions/1`, {}, env);
    expect((await full.json() as any).revision.codeCards[0].content).toBe('export const a = 1;');

    // transcript streamed from R2
    const ctx = await app.request(`/api/planning-packages/${pkg.id}/context?rev=1`, {}, env);
    expect(ctx.status).toBe(200);
    expect(await ctx.text()).toBe('RAW DUMP');

    // update live task state
    const upd = await app.request(`/api/planning-packages/${pkg.id}/tasks/T1`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ status: 'done', assignee: 'agent-x', prNumber: 42 }),
    }, env);
    expect(upd.status).toBe(200);

    const detail = await app.request(`/api/planning-packages/${pkg.id}`, {}, env);
    const body = await detail.json() as any;
    expect(body.tasks.find((t: any) => t.task_key === 'T1')).toMatchObject({ status: 'done', assignee: 'agent-x', pr_number: 42 });
  });

  it('409s on duplicate slug within a repo', async () => {
    await app.request('/api/planning-packages', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ repositoryId: 1, title: 'Dup', slug: 'dup' }),
    }, env);
    const again = await app.request('/api/planning-packages', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ repositoryId: 1, title: 'Dup', slug: 'dup' }),
    }, env);
    expect(again.status).toBe(409);
  });
});
