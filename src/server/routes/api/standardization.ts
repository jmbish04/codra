import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '@server/env';
import { jsonError } from '@server/core/http';
import {
  listStandardizationRules,
  createStandardizationRule,
  updateStandardizationRule,
  deleteStandardizationRule,
} from '@server/db/standardization';

const strategySchema = z.enum(['create_if_missing', 'merge_json', 'merge_mcp_servers', 'overwrite']);

const createSchema = z.object({
  target_path: z.string().min(1),
  source_url: z.string().url(),
  strategy: strategySchema,
  enabled: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

const updateSchema = createSchema.partial();

export function createStandardizationRouter() {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    const rules = await listStandardizationRules(c.env);
    return c.json({ rules });
  });

  app.post('/', async (c) => {
    const parsed = await createSchema.safeParseAsync(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid rule.', 400);
    const rule = await createStandardizationRule(c.env, parsed.data);
    return c.json({ rule }, 201);
  });

  app.patch('/:id', async (c) => {
    const parsed = await updateSchema.safeParseAsync(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid rule.', 400);
    const rule = await updateStandardizationRule(c.env, c.req.param('id'), parsed.data);
    if (!rule) return jsonError('Rule not found.', 404);
    return c.json({ rule });
  });

  app.delete('/:id', async (c) => {
    const ok = await deleteStandardizationRule(c.env, c.req.param('id'));
    if (!ok) return jsonError('Rule not found.', 404);
    return c.json({ ok: true });
  });

  return app;
}
