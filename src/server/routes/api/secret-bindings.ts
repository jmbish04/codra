import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '@server/env';
import { jsonError } from '@server/core/http';
import { listSecretsStoreSecrets } from '@server/core/secrets-store';
import {
  listStandardSecretBindings,
  upsertStandardSecretBinding,
  deleteStandardSecretBinding,
  listMissingSecretReports,
} from '@server/db/secret-bindings';

/** codra's own Secrets Store — the default store to browse and bind from. */
const DEFAULT_STORE_ID = '8c42fa70938644e0a8a109744467375f';

const upsertSchema = z.object({
  binding_name: z.string().min(1),
  secret_name: z.string().min(1),
  store_id: z.string().min(1),
  description: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export function createSecretBindingsRouter() {
  const app = new Hono<AppEnv>();

  /** GET /api/secret-bindings/available — secrets in the store, with descriptions. */
  app.get('/available', async (c) => {
    const storeId = c.req.query('store_id') || DEFAULT_STORE_ID;
    const secrets = await listSecretsStoreSecrets(c.env, storeId);
    return c.json({ store_id: storeId, secrets });
  });

  /** GET /api/secret-bindings — the standard bindings the user chose. */
  app.get('/', async (c) => {
    const bindings = await listStandardSecretBindings(c.env);
    return c.json({ bindings });
  });

  /** POST /api/secret-bindings — mark a secret as standard (upsert). */
  app.post('/', async (c) => {
    const parsed = await upsertSchema.safeParseAsync(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid binding.', 400);
    const binding = await upsertStandardSecretBinding(c.env, parsed.data);
    return c.json({ binding }, 201);
  });

  app.delete('/:id', async (c) => {
    const ok = await deleteStandardSecretBinding(c.env, c.req.param('id'));
    if (!ok) return jsonError('Binding not found.', 404);
    return c.json({ ok: true });
  });

  /** GET /api/secret-bindings/missing — secrets codra couldn't find in the store. */
  app.get('/missing', async (c) => {
    const includeResolved = c.req.query('all') === '1';
    const reports = await listMissingSecretReports(c.env, { includeResolved });
    return c.json({ reports });
  });

  return app;
}
