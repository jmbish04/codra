import { getDb } from './client';
import { standardSecretBindings, missingSecretReports } from './schemas';
import { asc, desc, eq, and } from 'drizzle-orm';

export type StandardSecretBindingInput = {
  binding_name: string;
  secret_name: string;
  store_id: string;
  description?: string | null;
  enabled?: boolean;
};

export async function listStandardSecretBindings(env: Pick<Env, 'DB'>) {
  const db = getDb(env);
  return db.select().from(standardSecretBindings).orderBy(asc(standardSecretBindings.secret_name)).all();
}

export async function listEnabledStandardSecretBindings(env: Pick<Env, 'DB'>) {
  const db = getDb(env);
  return db.select()
    .from(standardSecretBindings)
    .where(eq(standardSecretBindings.enabled, true))
    .all();
}

export async function upsertStandardSecretBinding(env: Pick<Env, 'DB'>, input: StandardSecretBindingInput) {
  const db = getDb(env);
  // One row per (store_id, secret_name).
  const existing = await db.select({ id: standardSecretBindings.id })
    .from(standardSecretBindings)
    .where(and(eq(standardSecretBindings.store_id, input.store_id), eq(standardSecretBindings.secret_name, input.secret_name)))
    .get();

  if (existing) {
    const [row] = await db.update(standardSecretBindings)
      .set({
        binding_name: input.binding_name,
        description: input.description ?? null,
        enabled: input.enabled ?? true,
        updated_at: new Date().toISOString(),
      })
      .where(eq(standardSecretBindings.id, existing.id))
      .returning();
    return row;
  }

  const [row] = await db.insert(standardSecretBindings)
    .values({
      binding_name: input.binding_name,
      secret_name: input.secret_name,
      store_id: input.store_id,
      description: input.description ?? null,
      enabled: input.enabled ?? true,
    })
    .returning();
  return row;
}

export async function deleteStandardSecretBinding(env: Pick<Env, 'DB'>, id: string) {
  const db = getDb(env);
  const rows = await db.delete(standardSecretBindings)
    .where(eq(standardSecretBindings.id, id))
    .returning({ id: standardSecretBindings.id });
  return rows.length > 0;
}

export async function recordMissingSecret(
  env: Pick<Env, 'DB'>,
  input: { owner: string; repo: string; secretName: string; storeId: string; triggeringPrNumber?: number | null },
) {
  const db = getDb(env);
  const [row] = await db.insert(missingSecretReports)
    .values({
      owner: input.owner,
      repo: input.repo,
      secret_name: input.secretName,
      store_id: input.storeId,
      triggering_pr_number: input.triggeringPrNumber ?? null,
    })
    .returning();
  return row;
}

export async function listMissingSecretReports(env: Pick<Env, 'DB'>, opts?: { includeResolved?: boolean }) {
  const db = getDb(env);
  const q = db.select().from(missingSecretReports).orderBy(desc(missingSecretReports.created_at));
  const rows = opts?.includeResolved
    ? await q.all()
    : await q.where(eq(missingSecretReports.resolved, false)).all();
  return rows;
}
