import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { createPublicPlanningRouter } from '@server/routes/public-planning';
import { createPackage } from '@server/db/planning-packages';
import { upsertRevision } from '@server/services/planning-packages';
import { createTestEnv } from './helpers';

// Mirror app.ts registration order: public router BEFORE the /api/* guard, so the
// public export bypasses auth while sibling /api/* paths do not.
/**
 * makeApp
 */
function makeApp() {
  const app = new Hono<AppEnv>();
  app.route('/api/public/planning-packages', createPublicPlanningRouter());
  app.use('/api/*', async (c) => c.json({ error: 'Unauthorized' }, 401)); // stub session guard
  return app;
}

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

describe('planning-packages public export', () => {
  let env: Env;
  const app = makeApp();
  beforeEach(() => { env = createTestEnv(); });

  it('bypasses the /api/* guard (public) while siblings stay guarded', async () => {
    const guarded = await app.request('/api/planning-packages', {}, env);
    expect(guarded.status).toBe(401);

    const p = await createPackage(env, { repositoryId: 1, slug: 'abc', title: 'ABC' });
    const res = await app.request('/api/public/planning-packages/export', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ planIds: [p.id] }),
    }, env);
    expect(res.status).toBe(200);
  });

  it('returns fielded revisions and skips unknown ids', async () => {
    const p = await createPackage(env, { repositoryId: 1, slug: 'abc', title: 'ABC' });
    await upsertRevision(env, p.id, { source: 'jules', codeCards: [{ content: 'full code here' }], contextText: 'DUMP' });

    const res = await app.request('/api/public/planning-packages/export', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ planIds: [p.id, 'nope'] }),
    }, env);
    expect(res.status).toBe(200);
    const { packages } = await res.json() as any;
    expect(packages).toHaveLength(1);
    expect(packages[0].package.slug).toBe('abc');
    expect(packages[0].revisions[0].codeCards[0].content).toBe('full code here');
    expect(packages[0].revisions[0].context_r2_key).toMatch(/^planning\//);
  });

  it('rejects a missing or empty planIds array', async () => {
    const bad = await app.request('/api/public/planning-packages/export', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ planIds: [] }),
    }, env);
    expect(bad.status).toBe(400);
  });
});
