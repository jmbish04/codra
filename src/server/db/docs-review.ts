import { getDb } from './client';
import { docsReviewRules } from './schemas';
import { asc, eq } from 'drizzle-orm';

export type DocsReviewSkill = 'agents-sdk' | 'workers-best-practices' | 'cloudflare-jedi' | 'cloudflare';

export type DocsReviewRuleInput = {
  name: string;
  trigger: string;
  skill: DocsReviewSkill;
  criteria: string;
  enabled?: boolean;
  sort_order?: number;
};

export async function listDocsReviewRules(env: Pick<Env, 'DB'>) {
  const db = getDb(env);
  return db.select().from(docsReviewRules).orderBy(asc(docsReviewRules.sort_order)).all();
}

export async function listEnabledDocsReviewRules(env: Pick<Env, 'DB'>) {
  const db = getDb(env);
  return db.select().from(docsReviewRules).where(eq(docsReviewRules.enabled, true)).all();
}

export async function createDocsReviewRule(env: Pick<Env, 'DB'>, input: DocsReviewRuleInput) {
  const db = getDb(env);
  const [row] = await db.insert(docsReviewRules).values({
    name: input.name,
    trigger: input.trigger,
    skill: input.skill,
    criteria: input.criteria,
    enabled: input.enabled ?? true,
    sort_order: input.sort_order ?? 0,
  }).returning();
  return row;
}

export async function updateDocsReviewRule(env: Pick<Env, 'DB'>, id: string, input: Partial<DocsReviewRuleInput>) {
  const db = getDb(env);
  const [row] = await db.update(docsReviewRules).set({
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
    ...(input.skill !== undefined ? { skill: input.skill } : {}),
    ...(input.criteria !== undefined ? { criteria: input.criteria } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.sort_order !== undefined ? { sort_order: input.sort_order } : {}),
    updated_at: new Date().toISOString(),
  }).where(eq(docsReviewRules.id, id)).returning();
  return row ?? null;
}

export async function deleteDocsReviewRule(env: Pick<Env, 'DB'>, id: string) {
  const db = getDb(env);
  const rows = await db.delete(docsReviewRules).where(eq(docsReviewRules.id, id)).returning({ id: docsReviewRules.id });
  return rows.length > 0;
}
