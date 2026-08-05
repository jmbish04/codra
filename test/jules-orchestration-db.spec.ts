import { describe, it, expect, beforeEach } from 'vitest';
import {
  createOrchestrationTask, getTaskByToken, getTaskBySession, listActiveTasks,
  updateTaskStatus, incrementTaskIteration, logTaskEvent, globalOrchestrationReport,
  markPrReadyByUrl,
} from '@server/db/jules-orchestration';
import { createTestEnv } from './helpers';

describe('jules-orchestration db', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('creates a task with a uuid token, links a session, and looks it up both ways', async () => {
    const t = await createOrchestrationTask(env, { packageId: 'pkg-1', repositoryId: 7 });
    expect(t.task_id).toMatch(/[0-9a-f-]{36}/);
    expect(t.status).toBe('pending');

    await updateTaskStatus(env, t.task_id, { status: 'planning', sessionId: 'sess-1' });
    expect(await getTaskByToken(env, t.task_id)).toMatchObject({ status: 'planning', session_id: 'sess-1' });
    expect(await getTaskBySession(env, 'sess-1')).toMatchObject({ task_id: t.task_id });
  });

  it('lists only active tasks (terminal ones drop out) and no-ops when none active', async () => {
    const a = await createOrchestrationTask(env, { packageId: 'p', repositoryId: 1 });
    const b = await createOrchestrationTask(env, { packageId: 'p', repositoryId: 1 });
    await updateTaskStatus(env, a.task_id, { status: 'planning' });
    await updateTaskStatus(env, b.task_id, { status: 'accepted' }); // terminal

    const active = await listActiveTasks(env);
    expect(active.map((t) => t.task_id)).toEqual([a.task_id]);

    await updateTaskStatus(env, a.task_id, { status: 'failed' });
    expect(await listActiveTasks(env)).toHaveLength(0);
  });

  it('increments iterations atomically for the circuit breaker', async () => {
    const t = await createOrchestrationTask(env, { packageId: 'p', repositoryId: 1 });
    expect(await incrementTaskIteration(env, t.task_id)).toBe(1);
    expect(await incrementTaskIteration(env, t.task_id)).toBe(2);
    expect(await incrementTaskIteration(env, t.task_id)).toBe(3);
  });

  it('marks pr_ready from a PR webhook only when the url matches a task', async () => {
    const t = await createOrchestrationTask(env, { packageId: 'p', repositoryId: 1 });
    await updateTaskStatus(env, t.task_id, { status: 'executing', lastPrUrl: 'https://github.com/o/r/pull/7' });

    expect(await markPrReadyByUrl(env, 'https://github.com/o/r/pull/999')).toBe(false); // no match
    expect(await markPrReadyByUrl(env, 'https://github.com/o/r/pull/7')).toBe(true);
    expect(await getTaskByToken(env, t.task_id)).toMatchObject({ status: 'pr_ready' });
  });

  it('logs events and produces a cross-repo global report', async () => {
    const t1 = await createOrchestrationTask(env, { packageId: 'p1', repositoryId: 1 });
    const t2 = await createOrchestrationTask(env, { packageId: 'p2', repositoryId: 2 });
    await updateTaskStatus(env, t1.task_id, { status: 'pr_ready' });
    await updateTaskStatus(env, t2.task_id, { status: 'planning' });
    await logTaskEvent(env, t1.task_id, 'PR_CREATED', { url: 'https://github.com/o/r/pull/1' });

    const report = await globalOrchestrationReport(env);
    /**
     * key
     */
    const key = (r: { repository_id: number; status: string }) => `${r.repository_id}:${r.status}`;
    const keys = report.map(key);
    expect(keys).toContain('1:pr_ready');
    expect(keys).toContain('2:planning');
    expect(report.find((r) => r.repository_id === 1)?.total).toBe(1);
  });
});
