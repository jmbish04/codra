import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '@server/db/client';
import { planningPackages } from '@server/db/schemas';
import {
  createPackage, getPackage, listPackages, updatePackage,
  createRevision, getRevision, listRevisions,
  reconcilePackageTasks, updateTask, listPackageTasks, exportPackages,
  acceptRevision,
} from '@server/db/planning-packages';
import { createTestEnv } from './helpers';

describe('planning-packages schema', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('migrates and accepts a package row', async () => {
    const db = getDb(env);
    const [row] = await db.insert(planningPackages)
      .values({ repository_id: 1, slug: 'feature-abc', title: 'Feature ABC' }).returning();
    expect(row.status).toBe('draft');
    expect(row.id).toMatch(/[0-9a-f-]{36}/);
  });
});

describe('planning-packages helpers', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('creates and lists packages by repo + status', async () => {
    const p = await createPackage(env, { repositoryId: 1, slug: 'abc', title: 'ABC' });
    expect(p.status).toBe('draft');
    await createPackage(env, { repositoryId: 1, slug: 'xyz', title: 'XYZ' });
    const drafts = await listPackages(env, { repositoryId: 1, status: 'draft' });
    expect(drafts).toHaveLength(2);
    expect(await getPackage(env, p.id)).toMatchObject({ slug: 'abc' });
  });

  it('appends immutable revisions with monotonic numbers and full children', async () => {
    const p = await createPackage(env, { repositoryId: 1, slug: 'abc', title: 'ABC' });

    const r1 = await createRevision(env, p.id, {
      source: 'jules', problem: 'P1',
      codeCards: [{ filePath: 'a.ts', language: 'ts', intent: 'add', content: 'export const a = 1;' }],
      tasks: [{ taskKey: 'T1', title: 'do a', phase: 1 }],
      changeItems: [{ kind: 'add', text: 'new file a.ts' }],
    });
    expect(r1.revisionNumber).toBe(1);

    const r2 = await createRevision(env, p.id, { source: 'jules', problem: 'P2 revised' });
    expect(r2.revisionNumber).toBe(2);

    // r1 content untouched by r2 — nothing lost
    const got = await getRevision(env, p.id, 1);
    expect(got?.problem).toBe('P1');
    expect(got?.codeCards[0].content).toBe('export const a = 1;');
    expect(got?.tasks[0].task_key).toBe('T1');
    expect(await listRevisions(env, p.id)).toHaveLength(2);
  });

  it('updates package status and current revision pointer', async () => {
    const p = await createPackage(env, { repositoryId: 1, slug: 'abc', title: 'ABC' });
    const r = await createRevision(env, p.id, { source: 'jules' });
    await updatePackage(env, p.id, { status: 'planning', currentRevisionId: r.id });
    expect(await getPackage(env, p.id)).toMatchObject({ status: 'planning', current_revision_id: r.id });
  });
});

describe('planning-packages task state + export', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('reconciles task state and preserves status across a new revision', async () => {
    const p = await createPackage(env, { repositoryId: 1, slug: 'abc', title: 'ABC' });
    const r1 = await createRevision(env, p.id, { source: 'jules', tasks: [{ taskKey: 'T1', title: 'a' }, { taskKey: 'T2', title: 'b' }] });
    await reconcilePackageTasks(env, p.id, r1.revisionNumber);
    await updateTask(env, p.id, 'T1', { status: 'done', assignee: 'agent-x', prNumber: 42 });

    // new revision adds T3, redefines T1 — live status must survive
    const r2 = await createRevision(env, p.id, { source: 'merge', tasks: [{ taskKey: 'T1', title: 'a2' }, { taskKey: 'T3', title: 'c' }] });
    await reconcilePackageTasks(env, p.id, r2.revisionNumber);

    const tasks = await listPackageTasks(env, p.id);
    const byKey = Object.fromEntries(tasks.map((t) => [t.task_key, t]));
    expect(byKey.T1).toMatchObject({ status: 'done', assignee: 'agent-x', pr_number: 42 });
    expect(byKey.T3).toMatchObject({ status: 'pending' });
    expect(tasks).toHaveLength(3); // T1, T2, T3
  });

  it('accepts a revision: supersedes others, points package, reconciles tasks', async () => {
    const p = await createPackage(env, { repositoryId: 1, slug: 'abc', title: 'ABC' });
    const r1 = await createRevision(env, p.id, { source: 'jules', tasks: [{ taskKey: 'T1', title: 'a' }] });
    const r2 = await createRevision(env, p.id, { source: 'merge', tasks: [{ taskKey: 'T1', title: 'a2' }, { taskKey: 'T2', title: 'b' }] });

    await acceptRevision(env, p.id, r2.id);

    const revs = await listRevisions(env, p.id);
    const byId = Object.fromEntries(revs.map((r) => [r.id, r.status]));
    expect(byId[r1.id]).toBe('superseded');
    expect(byId[r2.id]).toBe('accepted');

    const pkg = await getPackage(env, p.id);
    expect(pkg).toMatchObject({ current_revision_id: r2.id, status: 'in_progress' });

    const tasks = await listPackageTasks(env, p.id);
    expect(tasks.map((t) => t.task_key).sort()).toEqual(['T1', 'T2']);
  });

  it('exports fielded packages by id and skips unknown ids', async () => {
    const p = await createPackage(env, { repositoryId: 1, slug: 'abc', title: 'ABC' });
    await createRevision(env, p.id, { source: 'jules', codeCards: [{ content: 'full code here' }] });
    const out = await exportPackages(env, [p.id, 'does-not-exist']);
    expect(out).toHaveLength(1);
    expect(out[0].package.slug).toBe('abc');
    expect(out[0].revisions[0].codeCards[0].content).toBe('full code here');
  });
});
