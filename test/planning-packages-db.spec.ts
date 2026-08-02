import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '@server/db/client';
import { planningPackages } from '@server/db/schemas';
import { createTestEnv } from './helpers';

describe('planning-packages schema', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('migrates and accepts a package row', async () => {
    const db = getDb(env);
    const [row] = await db.insert(planningPackages)
      .values({ repository_id: 1, slug: 'feature-abc', title: 'Feature ABC' }).returning();
    expect(row.status).toBe('draft');
    expect(row.id).toMatch(/[0-9a-f-]{36}/);
  });
});
