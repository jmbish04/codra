import { getDb } from './client';
import { standardizationRules } from './schemas';
import { asc, eq } from 'drizzle-orm';

export type StandardizationStrategy = 'create_if_missing' | 'merge_json' | 'merge_mcp_servers' | 'overwrite';

export type StandardizationRuleInput = {
  target_path: string;
  source_url: string;
  strategy: StandardizationStrategy;
  enabled?: boolean;
  sort_order?: number;
};

export async function listStandardizationRules(env: Pick<Env, 'DB'>) {
  const db = getDb(env);
  return db.select().from(standardizationRules).orderBy(asc(standardizationRules.sort_order)).all();
}

export async function listEnabledStandardizationRules(env: Pick<Env, 'DB'>) {
  const db = getDb(env);
  return db.select()
    .from(standardizationRules)
    .where(eq(standardizationRules.enabled, true))
    .orderBy(asc(standardizationRules.sort_order))
    .all();
}

export async function createStandardizationRule(env: Pick<Env, 'DB'>, input: StandardizationRuleInput) {
  const db = getDb(env);
  const [row] = await db.insert(standardizationRules)
    .values({
      target_path: input.target_path,
      source_url: input.source_url,
      strategy: input.strategy,
      enabled: input.enabled ?? true,
      sort_order: input.sort_order ?? 0,
    })
    .returning();
  return row;
}

export async function updateStandardizationRule(
  env: Pick<Env, 'DB'>,
  id: string,
  input: Partial<StandardizationRuleInput>,
) {
  const db = getDb(env);
  const [row] = await db.update(standardizationRules)
    .set({
      ...(input.target_path !== undefined ? { target_path: input.target_path } : {}),
      ...(input.source_url !== undefined ? { source_url: input.source_url } : {}),
      ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.sort_order !== undefined ? { sort_order: input.sort_order } : {}),
      updated_at: new Date().toISOString(),
    })
    .where(eq(standardizationRules.id, id))
    .returning();
  return row ?? null;
}

export async function deleteStandardizationRule(env: Pick<Env, 'DB'>, id: string) {
  const db = getDb(env);
  const rows = await db.delete(standardizationRules)
    .where(eq(standardizationRules.id, id))
    .returning({ id: standardizationRules.id });
  return rows.length > 0;
}
