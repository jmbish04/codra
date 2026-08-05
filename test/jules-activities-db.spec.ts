import { describe, it, expect, beforeEach } from 'vitest';
import { upsertActivities, listCachedActivities, normalizeActivity } from '@server/db/jules-activities';
import { createTestEnv } from './helpers';

describe('jules activity cache', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('normalizes a flattened SDK activity', () => {
    const n = normalizeActivity({
      id: 'a1', type: 'planGenerated', originator: 'agent', createTime: '2026-08-02T00:00:00Z',
      plan: { id: 'p1', steps: [{ id: 's1', title: 'do' }] },
    });
    expect(n).toMatchObject({ activityId: 'a1', type: 'planGenerated', planId: 'p1' });
    expect(JSON.parse(n.planJson!).steps[0].title).toBe('do');
  });

  it('caches with dedup and serves oldest-first with a cursor + syncedAt', async () => {
    await upsertActivities(env, { sessionId: 's1', taskId: 't1', activities: [
      { id: 'a1', type: 'agentMessaged', originator: 'agent', createTime: '2026-08-02T00:00:01Z', message: 'hi' },
      { id: 'a2', type: 'progressUpdated', originator: 'agent', createTime: '2026-08-02T00:00:02Z', title: 'working' },
    ] });
    // re-ingest a1 + a new a3 → a1 deduped, a3 added
    const second = await upsertActivities(env, { sessionId: 's1', taskId: 't1', activities: [
      { id: 'a1', type: 'agentMessaged', message: 'hi' },
      { id: 'a3', type: 'sessionCompleted', createTime: '2026-08-02T00:00:03Z' },
    ] });
    expect(second.inserted).toBe(1); // only a3

    const first = await listCachedActivities(env, 't1', { limit: 2 });
    expect(first.activities.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(first.nextCursor).not.toBeNull();
    expect(first.syncedAt).toBeTruthy();

    const rest = await listCachedActivities(env, 't1', { after: first.nextCursor!, limit: 2 });
    expect(rest.activities.map((a) => a.id)).toEqual(['a3']);
    expect(rest.nextCursor).toBeNull();

    // full mapping shape
    expect(first.activities[0]).toMatchObject({ id: 'a1', type: 'agentMessaged', originator: 'agent', message: 'hi', artifacts: [] });
  });

  it('returns empty for an unknown task', async () => {
    const res = await listCachedActivities(env, 'nope');
    expect(res).toEqual({ activities: [], nextCursor: null, syncedAt: null });
  });
});
