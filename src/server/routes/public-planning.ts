import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { jsonError } from '@server/core/http';
import { exportPackages } from '@server/db/planning-packages';

const MAX_IDS = 50;
const RATE_PER_MIN = 30;

// Coarse per-IP rate limit via APP_KV. ponytail: single fixed window; swap for a
// sliding window only if abuse shows up.
async function underRateLimit(env: Pick<Env, 'APP_KV'>, ip: string): Promise<boolean> {
  const key = `pp_export_rl:${ip}`;
  const current = Number(await env.APP_KV.get(key)) || 0;
  if (current >= RATE_PER_MIN) return false;
  await env.APP_KV.put(key, String(current + 1), { expirationTtl: 60 });
  return true;
}

/**
 * PUBLIC, unauthenticated, read-only export. The gate is the unguessable uuid
 * package id acting as a bearer capability — you hand these ids (and this curl)
 * to Jules so it can pull every revision and produce the merged super-plan.
 * Only packages whose ids are supplied are returned; unknown ids are silently
 * skipped (no enumeration).
 */
export function createPublicPlanningRouter() {
  const app = new Hono<AppEnv>();

  app.post('/export', async (c) => {
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
    if (!(await underRateLimit(c.env, ip))) return jsonError('Rate limit exceeded. Try again shortly.', 429);

    const body = await c.req.json().catch(() => null) as { planIds?: unknown } | null;
    const planIds = body?.planIds;
    if (!Array.isArray(planIds) || planIds.length === 0 || !planIds.every((x) => typeof x === 'string')) {
      return jsonError('planIds must be a non-empty string array.', 400);
    }
    if (planIds.length > MAX_IDS) return jsonError(`At most ${MAX_IDS} planIds per request.`, 400);

    const packages = await exportPackages(c.env, planIds as string[]);
    return c.json({ packages });
  });

  return app;
}
