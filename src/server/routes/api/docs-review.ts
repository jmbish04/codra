import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '@server/env';
import { jsonError } from '@server/core/http';
import {
  listDocsReviewRules,
  createDocsReviewRule,
  updateDocsReviewRule,
  deleteDocsReviewRule,
} from '@server/db/docs-review';

const SKILLS = ['agents-sdk', 'workers-best-practices', 'cloudflare-jedi', 'cloudflare'] as const;

const CreateSchema = z.object({
  name: z.string().min(1),
  trigger: z.string().min(1),
  skill: z.enum(SKILLS),
  criteria: z.string().min(1),
  enabled: z.boolean().optional(),
  use_live_docs: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

const UpdateSchema = CreateSchema.partial();

export function createDocsReviewRouter() {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    const rules = await listDocsReviewRules(c.env);
    return c.json({ rules });
  });

  app.post('/', async (c) => {
    const body = await CreateSchema.safeParseAsync(await c.req.json().catch(() => null));
    if (!body.success) return jsonError('Invalid rule', 400);
    // Validate the trigger compiles as a regex before saving.
    try { new RegExp(body.data.trigger); } catch { return jsonError('Trigger is not a valid regular expression', 400); }
    const rule = await createDocsReviewRule(c.env, body.data);
    return c.json({ rule });
  });

  app.patch('/:id', async (c) => {
    const body = await UpdateSchema.safeParseAsync(await c.req.json().catch(() => null));
    if (!body.success) return jsonError('Invalid rule', 400);
    if (body.data.trigger) {
      try { new RegExp(body.data.trigger); } catch { return jsonError('Trigger is not a valid regular expression', 400); }
    }
    const rule = await updateDocsReviewRule(c.env, c.req.param('id'), body.data);
    if (!rule) return jsonError('Rule not found', 404);
    return c.json({ rule });
  });

  app.delete('/:id', async (c) => {
    const ok = await deleteDocsReviewRule(c.env, c.req.param('id'));
    if (!ok) return jsonError('Rule not found', 404);
    return c.json({ ok: true });
  });

  return app;
}
