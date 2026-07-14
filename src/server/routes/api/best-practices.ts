import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '@server/env';
import { jsonError } from '@server/core/http';
import {
  listBestPractices,
  getBestPractice,
  createBestPractice,
  updateBestPractice,
  deleteBestPractice,
  listInfrastructures,
} from '@server/db/best-practices';

const CreateBestPracticeSchema = z.object({
  name: z.string().min(1),
  infraId: z.string().min(1),
  infraName: z.string().optional(),
  criteria: z.string().min(1),
  instructions: z.string().min(1),
  isActive: z.boolean().optional(),
});

const UpdateBestPracticeSchema = z.object({
  name: z.string().min(1).optional(),
  infraId: z.string().min(1).optional(),
  infraName: z.string().optional(),
  criteria: z.string().min(1).optional(),
  instructions: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export function createBestPracticesRouter() {
  const app = new Hono<AppEnv>();

  // Get all best practices
  app.get('/', async (c) => {
    try {
      const items = await listBestPractices(c.env);
      return c.json({ bestPractices: items });
    } catch (error) {
      return jsonError('Failed to fetch best practices', 500);
    }
  });

  // Get all infrastructures
  app.get('/infrastructures', async (c) => {
    try {
      const items = await listInfrastructures(c.env);
      return c.json({ infrastructures: items });
    } catch (error) {
      return jsonError('Failed to fetch infrastructures', 500);
    }
  });

  // Get a specific best practice
  app.get('/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const item = await getBestPractice(c.env, id);
      if (!item) {
        return jsonError('Best practice not found', 404);
      }
      return c.json({ bestPractice: item });
    } catch (error) {
      return jsonError('Failed to fetch best practice', 500);
    }
  });

  // Create a best practice
  app.post('/', async (c) => {
    try {
      const body = await c.req.json();
      const parsed = CreateBestPracticeSchema.safeParse(body);
      if (!parsed.success) {
        return jsonError('Invalid best practice data format', 400);
      }
      const item = await createBestPractice(c.env, parsed.data);
      return c.json({ bestPractice: item }, 201);
    } catch (error) {
      return jsonError('Failed to create best practice', 500);
    }
  });

  // Update a best practice
  app.patch('/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const body = await c.req.json();
      const parsed = UpdateBestPracticeSchema.safeParse(body);
      if (!parsed.success) {
        return jsonError('Invalid update data format', 400);
      }
      const item = await updateBestPractice(c.env, id, parsed.data);
      if (!item) {
        return jsonError('Best practice not found', 404);
      }
      return c.json({ bestPractice: item });
    } catch (error) {
      return jsonError('Failed to update best practice', 500);
    }
  });

  // Delete a best practice
  app.delete('/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const deleted = await deleteBestPractice(c.env, id);
      return c.json({ success: deleted });
    } catch (error) {
      return jsonError('Failed to delete best practice', 500);
    }
  });

  return app;
}
