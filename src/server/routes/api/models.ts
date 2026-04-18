import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { listModelConfigs, updateModelConfig } from '@server/db/model-configs';
import { jsonError } from '@server/core/http';
import { getGlobalConfig, updateGlobalConfig } from '@server/core/config';

export function createModelsRouter() {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    const configs = await listModelConfigs(c.env);
    return c.json({ configs });
  });
  
  app.get('/global', async (c) => {
    const config = await getGlobalConfig(c.env);
    return c.json({ config });
  });

  app.patch('/global', async (c) => {
    const body = await c.req.json();
    await updateGlobalConfig(c.env, body);
    return c.json({ ok: true });
  });

  app.post('/:id', async (c) => {
    const modelId = c.req.param('id');
    const body = await c.req.json();
    
    await updateModelConfig(c.env, {
      modelId,
      rpm: Number(body.rpm),
      tpm: Number(body.tpm),
      rpd: Number(body.rpd),
      provider: body.provider,
    });
    
    return c.json({ ok: true });
  });

  return app;
}
