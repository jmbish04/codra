import { Hono } from 'hono';
import { z } from 'zod';
import { jsonError } from '@server/core/http';
import { getUpdatesEmailPreference, syncUpdatesEmail } from '@server/core/updates-email';
import type { AppEnv } from '@server/env';

const emailSchema = z.object({
  email: z.string().trim().email().max(254),
}).strict();

export function createAuthApiRouter() {
  const app = new Hono<AppEnv>();

  app.get('/session', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return c.json({ user: sessionUser });
  });

  app.get('/updates-email', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const preference = await getUpdatesEmailPreference(c.env, sessionUser.githubUserId);
    return c.json({
      status: preference?.status ?? 'pending',
      email: preference?.email ?? null,
      updatedAt: preference?.updatedAt ?? null,
    });
  });

  app.post('/updates-email', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await c.req.json().catch(() => null);
    const parsed = emailSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('Enter a valid email address.', 400);
    }

    const existingPreference = await getUpdatesEmailPreference(c.env, sessionUser.githubUserId);
    if (existingPreference) {
      return c.json({
        status: existingPreference.status,
        email: existingPreference.email,
        updatedAt: existingPreference.updatedAt,
      });
    }

    const synced = await syncUpdatesEmail(c.env, sessionUser.githubUserId, parsed.data.email);
    if (!synced) {
      return jsonError('Could not save updates email right now.', 502);
    }

    const preference = await getUpdatesEmailPreference(c.env, sessionUser.githubUserId);

    return c.json({
      status: preference?.status ?? 'pending',
      email: preference?.email ?? null,
      updatedAt: preference?.updatedAt ?? null,
    });
  });

  return app;
}
