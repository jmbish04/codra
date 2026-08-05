import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { createAgentRouter } from '@server/routes/api/agent';
import { recordHeartbeat, isAnyAgentAlive, listAgents } from '@server/db/agent-heartbeats';
import { createOrchestrationTask, updateTaskStatus } from '@server/db/jules-orchestration';
import { createTestEnv } from './helpers';

const KEY = 'test-webhook-secret'; // matches WORKER_API_KEY in createTestEnv
const authed = { 'X-API-Key': KEY, 'content-type': 'application/json' } as const;

describe('agent heartbeat db', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('upserts a heartbeat and reports liveness within a window', async () => {
    await recordHeartbeat(env, { agentId: 'mac-1', hostname: 'studio', version: '1.0.0', activeSessions: 2 });
    const [row] = await listAgents(env);
    expect(row).toMatchObject({ agent_id: 'mac-1', active_sessions: 2, hostname: 'studio' });

    const seen = Date.parse(row.last_seen_at);
    expect(await isAnyAgentAlive(env, 90_000, seen + 10_000)).toBe(true);   // 10s later: alive
    expect(await isAnyAgentAlive(env, 90_000, seen + 200_000)).toBe(false); // 200s later: stale
  });
});

describe('agent router', () => {
  let env: Env;
  const app = new Hono<AppEnv>();
  app.route('/api/agent', createAgentRouter());
  beforeEach(() => { env = createTestEnv(); });

  it('rejects requests without the worker key', async () => {
    const res = await app.request('/api/agent/pending', {}, env);
    expect(res.status).toBe(401);
  });

  it('records a heartbeat and lists pending watchable tasks', async () => {
    const hb = await app.request('/api/agent/heartbeat', {
      method: 'POST', headers: authed, body: JSON.stringify({ agentId: 'mac-1', activeSessions: 1 }),
    }, env);
    expect(hb.status).toBe(200);
    expect(await isAnyAgentAlive(env)).toBe(true);

    const t = await createOrchestrationTask(env, { packageId: 'p', repositoryId: 1 });
    await updateTaskStatus(env, t.task_id, { status: 'planning', sessionId: 'sess-1' });

    const pending = await app.request('/api/agent/pending', { headers: { 'X-API-Key': KEY } }, env);
    const { tasks } = await pending.json() as any;
    expect(tasks).toEqual([{ taskId: t.task_id, sessionId: 'sess-1', status: 'planning' }]);
  });

  it('validates jules-event and no-ops for unknown tasks', async () => {
    const noId = await app.request('/api/agent/jules-event', { method: 'POST', headers: authed }, env);
    expect(noId.status).toBe(400);

    const unknown = await app.request('/api/agent/jules-event?taskId=nope', { method: 'POST', headers: authed }, env);
    expect(unknown.status).toBe(202);
    expect((await unknown.json() as any).advanced).toBe(false);
  });
});
