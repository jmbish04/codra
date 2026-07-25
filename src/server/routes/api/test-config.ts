import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '@server/env';
import { jsonError } from '@server/core/http';
import { getRepoTestConfig, setRepoTestConfig } from '@server/core/test-config';

function parseRepo(v: string | undefined): { owner: string; repo: string } | null {
  if (!v) return null;
  const [owner, repo] = v.split('/');
  return owner && repo ? { owner, repo } : null;
}

const putSchema = z.object({
  baseUrl: z.string().url().nullable().optional().or(z.literal('')),
  apiKey: z.string().optional(),
  frontendPassword: z.string().optional(),
});

export function createTestConfigRouter() {
  const app = new Hono<AppEnv>();

  /** GET /api/test-config?repo=owner/name — masked (never returns secrets). */
  app.get('/', async (c) => {
    const r = parseRepo(c.req.query('repo'));
    if (!r) return jsonError('repo query (owner/name) is required.', 400);
    const config = await getRepoTestConfig(c.env, r.owner, r.repo);
    return c.json({ repo: `${r.owner}/${r.repo}`, config });
  });

  /** PUT /api/test-config?repo=owner/name — set base URL / api key / frontend password. */
  app.put('/', async (c) => {
    const r = parseRepo(c.req.query('repo'));
    if (!r) return jsonError('repo query (owner/name) is required.', 400);
    const parsed = await putSchema.safeParseAsync(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid config.', 400);

    const config = await setRepoTestConfig(c.env, r.owner, r.repo, {
      baseUrl: parsed.data.baseUrl === undefined ? undefined : (parsed.data.baseUrl || null),
      apiKey: parsed.data.apiKey,
      frontendPassword: parsed.data.frontendPassword,
    });
    return c.json({ repo: `${r.owner}/${r.repo}`, config });
  });

  return app;
}
