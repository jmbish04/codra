import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { getChangelogEntry, listChangelogEntries } from '@server/db/changelog';
import { jsonError } from '@server/core/http';

export function createChangelogRouter() {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 100);
    const offset = Number(c.req.query('offset') ?? 0) || 0;
    return c.json({ entries: await listChangelogEntries(c.env, limit, offset) });
  });

  app.get('/:slug', async (c) => {
    const entry = await getChangelogEntry(c.env, c.req.param('slug'));
    if (!entry) return jsonError('Changelog entry not found.', 404);
    return c.json({ entry });
  });

  return app;
}
