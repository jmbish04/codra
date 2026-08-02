import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { jsonError } from '@server/core/http';
import { getSecretStoreBinding } from '@server/utils/secrets';
import { listActiveTasks } from '@server/db/jules-orchestration';
import { recordHeartbeat } from '@server/db/agent-heartbeats';
import { advanceTaskById } from '@server/services/jules-poller';

/**
 * Machine-to-machine endpoints for the external OpenTUI watcher daemon. Guarded
 * by WORKER_API_KEY (Bearer or X-API-Key), NOT a browser session — the daemon is
 * headless. Mounted before the /api/* session guard.
 *
 * The daemon holds Jules `session.stream()` open on the user's Mac (free,
 * always-on) and calls `jules-event` here the moment Jules emits, so the worker
 * only ever runs a short, event-triggered step — no billed always-awake watcher.
 */
export function createAgentRouter() {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    const expected = await getSecretStoreBinding(c.env, 'WORKER_API_KEY').catch(() => '');
    const provided = c.req.header('X-API-Key') || c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') || '';
    if (!expected || provided !== expected) return jsonError('Unauthorized', 401);
    await next();
  });

  // Active tasks the daemon should be watching (task token + Jules session id).
  app.get('/pending', async (c) => {
    const tasks = await listActiveTasks(c.env);
    return c.json({
      tasks: tasks
        .filter((t) => t.session_id)
        .map((t) => ({ taskId: t.task_id, sessionId: t.session_id, status: t.status })),
    });
  });

  // Liveness ping from the daemon; recorded in D1 so we know the Mac is breathing.
  app.post('/heartbeat', async (c) => {
    const body = await c.req.json().catch(() => null) as
      | { agentId?: string; hostname?: string; version?: string; activeSessions?: number } | null;
    if (!body?.agentId) return jsonError('agentId required.', 400);
    await recordHeartbeat(c.env, {
      agentId: body.agentId, hostname: body.hostname ?? null, version: body.version ?? null,
      activeSessions: typeof body.activeSessions === 'number' ? body.activeSessions : 0,
    });
    return c.json({ ok: true });
  });

  // Real-time trigger: Jules emitted an activity for this task — advance one step.
  app.post('/jules-event', async (c) => {
    const taskId = c.req.query('taskId');
    if (!taskId) return jsonError('taskId query param required.', 400);
    const result = await advanceTaskById(c.env, taskId);
    return c.json(result, result.advanced ? 200 : 202);
  });

  return app;
}
