import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { getJulesSessionById, listJulesSessions, updateJulesLiveState } from '@server/db/jules-sessions';
import { getSecretStoreBinding } from '@server/utils/secrets';
import { getJulesSession } from '@server/services/jules';
import { jsonError } from '@server/core/http';
import { logger } from '@server/core/logger';

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

  // Realtime status: query Jules live for a single launched session, persist the
  // refreshed state, and return it. The frontend polls this so the operations
  // page reflects the agent's current progress without waiting for a webhook.
  app.get('/:id/live', async (c) => {
    const row = await getJulesSessionById(c.env, c.req.param('id'));
    if (!row) return jsonError('Jules session not found.', 404);
    if (!row.session_id) {
      // Nothing launched yet (staged/skipped/error) — no live status to fetch.
      return c.json({ id: row.id, state: row.state, sessionState: row.session_state, sessionUrl: row.session_url, pullRequestUrl: null, live: false });
    }

    let apiKey = '';
    try { apiKey = await getSecretStoreBinding(c.env, 'JULES_API_KEY'); } catch { apiKey = ''; }
    if (!apiKey) return jsonError('JULES_API_KEY not configured.', 503);

    try {
      const live = await getJulesSession(apiKey, row.session_id);
      await updateJulesLiveState(c.env, row.id, { sessionState: live.state, sessionUrl: live.url })
        .catch((err) => logger.warn(`Failed to persist live Jules state for ${row.id}`, err));
      return c.json({
        id: row.id,
        state: row.state,
        sessionState: live.state,
        sessionUrl: live.url,
        pullRequestUrl: live.pullRequestUrl,
        live: true,
      });
    } catch (err) {
      // Log the detail server-side; return a generic message so a downstream
      // error (which may embed URLs/response bodies) is never leaked to clients.
      logger.error(`Failed to fetch live Jules status for ${row.id}`, err instanceof Error ? err : new Error(String(err)));
      return jsonError('Failed to fetch live Jules status.', 502);
    }
  });

  return app;
}
