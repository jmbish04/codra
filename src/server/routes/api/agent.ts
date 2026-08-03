import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { jsonError } from '@server/core/http';
import { getSecretStoreBinding } from '@server/utils/secrets';
import { listActiveTasks } from '@server/db/jules-orchestration';
import { recordHeartbeat } from '@server/db/agent-heartbeats';
import { advanceTaskById } from '@server/services/jules-poller';
import { listQueuedFleetJobs, claimFleetJob, completeFleetJob } from '@server/db/fleet-jobs';
import { reviewReconciliation } from '@server/services/merge-review';

/**
 * Machine-to-machine endpoints for the external OpenTUI watcher daemon. Guarded
 * by WORKER_API_KEY (Bearer or X-API-Key), NOT a browser session — the daemon is
 * headless. Mounted before the /api/* session guard.
 *
 * The daemon holds Jules `session.stream()` open on the user's Mac (free,
 * always-on) and calls `jules-event` here the moment Jules emits, so the worker
 * only ever runs a short, event-triggered step — no billed always-awake watcher.
 */
/** Constant-time string compare — avoids leaking the key via response timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export function createAgentRouter() {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    const expected = await getSecretStoreBinding(c.env, 'WORKER_API_KEY').catch(() => '');
    const provided = c.req.header('X-API-Key') || c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') || '';
    if (!expected || !timingSafeEqual(provided, expected)) return jsonError('Unauthorized', 401);
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

  // Off-Worker runner (daemon/Action) picks up jules-fleet / jules-merge CLI jobs.
  app.get('/fleet-jobs', async (c) => {
    return c.json({ jobs: await listQueuedFleetJobs(c.env) });
  });

  app.post('/fleet-jobs/:jobId/claim', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { runner?: string };
    const claimed = await claimFleetJob(c.env, c.req.param('jobId'), body.runner ?? 'runner');
    return c.json({ claimed }, claimed ? 200 : 409);
  });

  app.post('/fleet-jobs/:jobId/result', async (c) => {
    const body = await c.req.json().catch(() => null) as { status?: 'completed' | 'failed'; result?: unknown; error?: string } | null;
    if (body?.status !== 'completed' && body?.status !== 'failed') return jsonError('status must be completed|failed.', 400);
    await completeFleetJob(c.env, c.req.param('jobId'), { status: body.status, result: body.result, error: body.error ?? null });
    return c.json({ ok: true });
  });

  // Merge gate: the runner calls this BEFORE `jules-merge merge`. codra (Kimi)
  // reviews the staged reconciliation; the runner merges only if approved.
  // Circuit-broken per reconciliationKey so a rejected reconciliation never loops.
  app.post('/merge-review', async (c) => {
    const body = await c.req.json().catch(() => null) as
      | { repositoryId?: number; repository?: string; reconciliationKey?: string; summary?: string; prNumber?: number } | null;
    if (!body || typeof body.repositoryId !== 'number' || !body.repository || !body.reconciliationKey || !body.summary) {
      return jsonError('repositoryId, repository, reconciliationKey, summary are required.', 400);
    }
    const result = await reviewReconciliation(c.env, {
      repositoryId: body.repositoryId, repository: body.repository,
      reconciliationKey: body.reconciliationKey, summary: body.summary, prNumber: body.prNumber ?? null,
    });
    return c.json(result);
  });

  return app;
}
