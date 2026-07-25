import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { listAgentActions } from '@server/db/agent-actions';

export function createActionsRouter() {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    const q = c.req.query();
    const limit = Math.min(Number(q.limit) || 50, 200);
    const offset = Number(q.offset) || 0;
    const actions = await listAgentActions(c.env, {
      owner: q.owner || undefined,
      repo: q.repo || undefined,
      limit,
      offset,
    });
    return c.json({ actions });
  });

  return app;
}
