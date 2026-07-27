import { Hono } from 'hono';
import { getDb } from '@server/db/client';
import { feedback_bugs, feedback_features } from '@server/db/schemas/feedback';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '@server/env';
import { jsonError } from '@server/core/http';

export function createFeedbackRouter() {
  const app = new Hono<AppEnv>();

  // Bugs CRUD
  app.get('/bugs', async (c) => {
    const db = getDb(c.env);
    const bugs = await db.select().from(feedback_bugs).orderBy(desc(feedback_bugs.created_at));
    return c.json({ ok: true, bugs });
  });

  app.post('/bugs', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = z.object({
      title: z.string().min(1),
      description: z.string().min(1),
      reporter: z.string().optional(),
    }).safeParse(body);
    if (!parsed.success) return jsonError('Invalid body', 400);

    const db = getDb(c.env);
    const result = await db.insert(feedback_bugs).values({
      title: parsed.data.title,
      description: parsed.data.description,
      reporter: parsed.data.reporter,
    }).returning();
    return c.json({ ok: true, bug: result[0] }, 201 as any);
  });

  app.patch('/bugs/:id', async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return jsonError('Invalid ID', 400);

    const body = await c.req.json().catch(() => ({}));
    const parsed = z.object({
      status: z.enum(['open', 'in_progress', 'resolved']),
    }).safeParse(body);
    if (!parsed.success) return jsonError('Invalid body', 400);

    const db = getDb(c.env);
    const result = await db.update(feedback_bugs)
      .set({ status: parsed.data.status, updated_at: new Date().toISOString() })
      .where(eq(feedback_bugs.id, id))
      .returning();
      
    if (result.length === 0) return jsonError('Not found', 404);
    return c.json({ ok: true, bug: result[0] });
  });

  // Features CRUD
  app.get('/features', async (c) => {
    const db = getDb(c.env);
    const features = await db.select().from(feedback_features).orderBy(desc(feedback_features.votes), desc(feedback_features.created_at));
    return c.json({ ok: true, features });
  });

  app.post('/features', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = z.object({
      title: z.string().min(1),
      description: z.string().min(1),
      reporter: z.string().optional(),
    }).safeParse(body);
    if (!parsed.success) return jsonError('Invalid body', 400);

    const db = getDb(c.env);
    const result = await db.insert(feedback_features).values({
      title: parsed.data.title,
      description: parsed.data.description,
      reporter: parsed.data.reporter,
    }).returning();
    return c.json({ ok: true, feature: result[0] }, 201 as any);
  });

  app.patch('/features/:id', async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return jsonError('Invalid ID', 400);

    const body = await c.req.json().catch(() => ({}));
    const parsed = z.object({
      status: z.enum(['open', 'in_progress', 'shipped']).optional(),
      votes: z.number().int().optional(),
    }).safeParse(body);
    if (!parsed.success) return jsonError('Invalid body', 400);

    const db = getDb(c.env);
    const result = await db.update(feedback_features)
      .set({ 
        ...(parsed.data.status !== undefined && { status: parsed.data.status }),
        ...(parsed.data.votes !== undefined && { votes: parsed.data.votes }),
        updated_at: new Date().toISOString() 
      })
      .where(eq(feedback_features.id, id))
      .returning();
      
    if (result.length === 0) return jsonError('Not found', 404);
    return c.json({ ok: true, feature: result[0] });
  });

  return app;
}
