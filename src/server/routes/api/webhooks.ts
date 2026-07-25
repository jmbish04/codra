import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { syncOpenPullRequests } from '@server/services/sync/pr-sync';
import { listWebhookDeliveries, getWebhookDeliveryById } from '@server/db/webhook-deliveries';
import { jsonError } from '@server/core/http';

export function createWebhooksRouter() {
  const app = new Hono<AppEnv>();

  /**
   * GET /api/webhooks
   * Filterable, paginated list of webhook deliveries with their outcomes.
   */
  app.get('/', async (c) => {
    const q = c.req.query();
    const limit = Math.min(Number(q.limit) || 50, 200);
    const offset = Number(q.offset) || 0;
    const result = await listWebhookDeliveries(c.env, {
      outcome: q.outcome || undefined,
      event: q.event || undefined,
      owner: q.owner || undefined,
      repo: q.repo || undefined,
      limit,
      offset,
    });
    return c.json(result);
  });

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

  /**
   * GET /api/webhooks/:id
   * Full delivery including parsed payload, for the detail drawer.
   */
  app.get('/:id', async (c) => {
    const row = await getWebhookDeliveryById(c.env, c.req.param('id'));
    if (!row) return jsonError('Delivery not found.', 404);
    return c.json({ delivery: row });
  });

  return app;
}
