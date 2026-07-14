import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { getStats } from '@server/db/stats';

export function createStatsRouter() {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    const daysParam = c.req.query('days');
    const days = daysParam ? parseInt(daysParam, 10) : 30;
    const stats = await getStats(c.env, days);
    return c.json({ stats });
  });

  app.get('/usage', async (c) => {
    const { syncGatewayUsage, getApiUsageStats } = await import('@server/db/api-usage');
    try {
      await syncGatewayUsage(c.env);
    } catch {}
    const logs = await getApiUsageStats(c.env);
    return c.json({ logs });
  });

  return app;
}
