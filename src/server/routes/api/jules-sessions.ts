import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { listJulesSessions } from '@server/db/jules-sessions';

export function createJulesSessionsRouter() {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    const q = c.req.query();
    const limit = Math.min(Number(q.limit) || 50, 200);
    const offset = Number(q.offset) || 0;
    const sessions = await listJulesSessions(c.env, {
      owner: q.owner || undefined,
      repo: q.repo || undefined,
      limit,
      offset,
    });
    return c.json({ sessions });
  });

  return app;
}
