import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { jsonError } from '@server/core/http';
import {
  createPackage, getPackage, listPackages, updatePackage,
  getRevision, listRevisions, listPackageTasks, updateTask,
} from '@server/db/planning-packages';
import { upsertRevision, type UpsertRevisionInput } from '@server/services/planning-packages';
import { slugifyPackage } from '@server/utils/slug';

export function createPlanningPackagesRouter() {
  const app = new Hono<AppEnv>();

  // List, filterable by repo + status, newest first.
  app.get('/', async (c) => {
    const q = c.req.query();
    const packages = await listPackages(c.env, {
      repositoryId: q.repo ? Number(q.repo) : undefined,
      status: q.status || undefined,
      limit: Math.min(Number(q.limit) || 100, 200),
      offset: Number(q.offset) || 0,
    });
    return c.json({ packages });
  });

  // Create a draft package.
  app.post('/', async (c) => {
    const body = await c.req.json().catch(() => null) as
      | { repositoryId?: number; title?: string; slug?: string; requestPromptJson?: string } | null;
    if (!body || typeof body.repositoryId !== 'number' || !body.title) {
      return jsonError('repositoryId (number) and title are required.', 400);
    }
    try {
      const pkg = await createPackage(c.env, {
        repositoryId: body.repositoryId,
        title: body.title,
        slug: body.slug ? slugifyPackage(body.slug) : slugifyPackage(body.title),
        requestPromptJson: body.requestPromptJson ?? null,
        createdBy: c.get('sessionUser')?.login ?? null,
      });
      return c.json({ package: pkg }, 201);
    } catch (err) {
      // Drizzle wraps the driver error; the UNIQUE-constraint text is on `.cause`.
      const msg = `${String(err)} ${String((err as { cause?: unknown })?.cause ?? '')}`;
      if (/unique constraint/i.test(msg)) return jsonError('A package with that slug already exists for this repo.', 409);
      throw err;
    }
  });

  // Header + revision summaries + live task state.
  app.get('/:id', async (c) => {
    const pkg = await getPackage(c.env, c.req.param('id'));
    if (!pkg) return jsonError('Planning package not found.', 404);
    const [revisions, tasks] = await Promise.all([
      listRevisions(c.env, pkg.id), listPackageTasks(c.env, pkg.id),
    ]);
    return c.json({ package: pkg, revisions, tasks });
  });

  // Autosave / status transitions.
  app.patch('/:id', async (c) => {
    const pkg = await getPackage(c.env, c.req.param('id'));
    if (!pkg) return jsonError('Planning package not found.', 404);
    const body = await c.req.json().catch(() => null) as
      | { title?: string; status?: string; requestPromptJson?: string | null } | null;
    if (!body) return jsonError('Invalid body.', 400);
    await updatePackage(c.env, pkg.id, {
      title: body.title,
      status: body.status,
      requestPromptJson: body.requestPromptJson,
    });
    return c.json({ ok: true });
  });

  // Full fielded revision.
  app.get('/:id/revisions/:num', async (c) => {
    const num = Number(c.req.param('num'));
    if (!Number.isInteger(num)) return jsonError('Invalid revision number.', 400);
    const rev = await getRevision(c.env, c.req.param('id'), num);
    if (!rev) return jsonError('Revision not found.', 404);
    return c.json({ revision: rev });
  });

  // Append a new immutable revision (fielded body → child rows; context → R2).
  app.post('/:id/revisions', async (c) => {
    const pkg = await getPackage(c.env, c.req.param('id'));
    if (!pkg) return jsonError('Planning package not found.', 404);
    const body = await c.req.json().catch(() => null) as (UpsertRevisionInput | null);
    if (!body || !body.source) return jsonError('source is required.', 400);
    const result = await upsertRevision(c.env, pkg.id, {
      ...body,
      createdBy: body.createdBy ?? c.get('sessionUser')?.login ?? null,
    });
    return c.json({ revision: result }, 201);
  });

  // Stream a revision's raw transcript from R2.
  app.get('/:id/context', async (c) => {
    const num = Number(c.req.query('rev'));
    if (!Number.isInteger(num)) return jsonError('rev query param (revision number) is required.', 400);
    const rev = await getRevision(c.env, c.req.param('id'), num);
    if (!rev?.context_r2_key) return jsonError('No transcript for that revision.', 404);
    const obj = await c.env.PLANNING_ARTIFACTS.get(rev.context_r2_key);
    if (!obj) return jsonError('Transcript object missing.', 404);
    return new Response(obj.body, { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
  });

  // Update live task status / assignee / pr — the multi-agent progress signal.
  app.post('/:id/tasks/:taskKey', async (c) => {
    const pkg = await getPackage(c.env, c.req.param('id'));
    if (!pkg) return jsonError('Planning package not found.', 404);
    const body = await c.req.json().catch(() => ({})) as
      { status?: string; assignee?: string | null; prNumber?: number | null; notes?: string | null };
    await updateTask(c.env, pkg.id, c.req.param('taskKey'), body);
    return c.json({ ok: true });
  });

  // Kick the per-package PlanAgent DO: Jules planning → review loop → merge → accept.
  app.post('/:id/orchestrate', async (c) => {
    const pkg = await getPackage(c.env, c.req.param('id'));
    if (!pkg) return jsonError('Planning package not found.', 404);
    await updatePackage(c.env, pkg.id, { status: 'planning' });
    const stub = c.env.PlanAgent.get(c.env.PlanAgent.idFromName(pkg.id));
    const res = await stub.fetch('https://plan-agent/start', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packageId: pkg.id }),
    });
    return c.json({ started: res.ok });
  });

  return app;
}
