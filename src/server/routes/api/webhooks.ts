import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { syncOpenPullRequests } from '@server/services/sync/pr-sync';
import {
  listWebhookDeliveries,
  getWebhookDeliveryById,
  webhookOutcomeStats,
  webhookDeliveryRepos,
} from '@server/db/webhook-deliveries';
import { jsonError } from '@server/core/http';

function reposParam(v: string | undefined): string[] | undefined {
  if (!v) return undefined;
  const list = v.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

export function createWebhooksRouter() {
  const app = new Hono<AppEnv>();

  /** GET /api/webhooks — filterable, paginated delivery list. */
  app.get('/', async (c) => {
    const q = c.req.query();
    const limit = Math.min(Number(q.limit) || 50, 200);
    const offset = Number(q.offset) || 0;
    const result = await listWebhookDeliveries(c.env, {
      outcome: q.outcome || undefined,
      event: q.event || undefined,
      repos: reposParam(q.repos),
      since: q.since || undefined,
      limit,
      offset,
    });
    return c.json(result);
  });

  /** GET /api/webhooks/stats — delivery counts by outcome. */
  app.get('/stats', async (c) => {
    const q = c.req.query();
    const stats = await webhookOutcomeStats(c.env, { since: q.since || undefined, repos: reposParam(q.repos) });
    return c.json({ stats });
  });

  /** GET /api/webhooks/repos — distinct repos with deliveries (for the filter). */
  app.get('/repos', async (c) => {
    const repos = await webhookDeliveryRepos(c.env);
    return c.json({ repos });
  });

  /**
   * POST /api/webhooks/sync — recover missing reviews. Streams NDJSON progress
   * events as it scans each repo, then a final summary line.
   */
  app.post('/sync', async (c) => {
    const repoParam = c.req.query('repo');
    let repoFilter: { owner: string; repo: string } | undefined;
    if (repoParam) {
      const [owner, repo] = repoParam.split('/');
      if (!owner || !repo) return jsonError('repo must be in owner/name form.', 400);
      repoFilter = { owner, repo };
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const write = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        try {
          const summary = await syncOpenPullRequests(c.env, {
            repoFilter,
            onProgress: (e) => write(e),
          });
          write({ type: 'summary', ...summary });
        } catch (err) {
          write({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  });

  /** GET /api/webhooks/:id — full delivery incl. parsed payload. */
  app.get('/:id', async (c) => {
    const row = await getWebhookDeliveryById(c.env, c.req.param('id'));
    if (!row) return jsonError('Delivery not found.', 404);
    return c.json({ delivery: row });
  });

  return app;
}
