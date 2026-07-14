import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '@server/env';
import { jsonError } from '@server/core/http';

const PromptSchema = z.object({
  name: z.string().min(1),
  content: z.string().min(1),
});

export function createPromptsRouter() {
  const app = new Hono<AppEnv>();

  // Get all prompts
  app.get('/', async (c) => {
    try {
      const value = await c.env.PROMPTS_KV.list();
      const prompts = await Promise.all(
        value.keys.map(async (item) => {
          const content = await c.env.PROMPTS_KV.get(item.name);
          return { name: item.name, content };
        })
      );
      return c.json({ prompts });
    } catch (error) {
      return jsonError('Failed to fetch prompts', 500);
    }
  });

  // Get a specific prompt
  app.get('/:name', async (c) => {
    const name = c.req.param('name');
    const content = await c.env.PROMPTS_KV.get(name);
    
    if (!content) {
      return jsonError('Prompt not found', 404);
    }
    
    return c.json({ name, content });
  });

  // Create or update a prompt
  app.put('/', async (c) => {
    try {
      const body = await c.req.json();
      const parsed = z.array(PromptSchema).safeParse(body);
      
      if (!parsed.success) {
        // If not an array, try parsing as a single object
        const singleParsed = PromptSchema.safeParse(body);
        if (singleParsed.success) {
          await c.env.PROMPTS_KV.put(singleParsed.data.name, singleParsed.data.content);
          return c.json({ message: 'Prompt saved successfully' });
        }
        return jsonError('Invalid prompt data format', 400);
      }

      for (const prompt of parsed.data) {
        await c.env.PROMPTS_KV.put(prompt.name, prompt.content);
      }

      return c.json({ message: 'Prompts saved successfully' });
    } catch (error) {
      return jsonError('Failed to save prompts', 500);
    }
  });

  // Delete a prompt
  app.delete('/:name', async (c) => {
    const name = c.req.param('name');
    await c.env.PROMPTS_KV.delete(name);
    return c.json({ message: 'Prompt deleted' });
  });

  return app;
}
