import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { syncOpenPullRequests } from '@server/services/sync/pr-sync';

export function createWebhooksRouter() {
  const app = new Hono<AppEnv>();

  /**
   * POST /api/webhooks/sync
   * Recover PR reviews that live webhooks never produced. Optional ?repo=owner/name
   * scopes the sync to one repo; default is every enabled repo. Idempotent.
   */
  app.post('/sync', async (c) => {
    const repoParam = c.req.query('repo');
    let repoFilter: { owner: string; repo: string } | undefined;
    if (repoParam) {
      const [owner, repo] = repoParam.split('/');
      if (!owner || !repo) {
        return c.json({ ok: false, error: 'repo must be in owner/name form.' }, 400);
      }
      repoFilter = { owner, repo };
    }

    const summary = await syncOpenPullRequests(c.env, { repoFilter });
    return c.json({ ok: true, ...summary }, 202);
  });

  return app;
}
