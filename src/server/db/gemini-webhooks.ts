import { getDb } from './client';
import { antigravityInteractions, geminiWebhookEvents } from './schemas';
import { and, asc, eq, ne, sql } from 'drizzle-orm';

/** Stores a Gemini webhook verbatim. Returns false when it is a redelivery. */
export async function recordGeminiWebhookEvent(
  env: Pick<Env, 'DB'>,
  input: {
    webhookId: string;
    eventType: string;
    interactionId: string | null;
    signatureVerified: boolean;
    payload: unknown;
  },
) {
  const db = getDb(env);
  const result = await db.insert(geminiWebhookEvents)
    .values({
      webhook_id: input.webhookId,
      event_type: input.eventType,
      interaction_id: input.interactionId,
      signature_verified: input.signatureVerified,
      payload: input.payload,
    })
    .onConflictDoNothing()
    .returning({ id: geminiWebhookEvents.id });

  return result.length > 0;
}

export async function recordAntigravityInteractions(
  env: Pick<Env, 'DB'>,
  jobId: string,
  interactions: Array<{ interactionId: string; fileIndex: number }>,
) {
  if (interactions.length === 0) return;
  const db = getDb(env);
  await db.insert(antigravityInteractions)
    .values(interactions.map((interaction) => ({
      interaction_id: interaction.interactionId,
      job_id: jobId,
      file_index: interaction.fileIndex,
    })))
    .onConflictDoNothing();
}

export async function listAntigravityInteractions(env: Pick<Env, 'DB'>, jobId: string) {
  const db = getDb(env);
  return db.select()
    .from(antigravityInteractions)
    .where(eq(antigravityInteractions.job_id, jobId))
    .orderBy(asc(antigravityInteractions.file_index))
    .all();
}

export async function getAntigravityInteraction(env: Pick<Env, 'DB'>, interactionId: string) {
  const db = getDb(env);
  return db.select()
    .from(antigravityInteractions)
    .where(eq(antigravityInteractions.interaction_id, interactionId))
    .limit(1)
    .get();
}

export async function settleAntigravityInteraction(
  env: Pick<Env, 'DB'>,
  interactionId: string,
  result: { status: string; outputText?: string | null; error?: string | null },
) {
  const db = getDb(env);
  await db.update(antigravityInteractions)
    .set({
      status: result.status,
      output_text: result.outputText ?? null,
      error: result.error ?? null,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(antigravityInteractions.interaction_id, interactionId));
}

export async function countOutstandingAntigravityInteractions(env: Pick<Env, 'DB'>, jobId: string) {
  const db = getDb(env);
  const row = await db.select({ count: sql<number>`count(*)` })
    .from(antigravityInteractions)
    .where(and(
      eq(antigravityInteractions.job_id, jobId),
      eq(antigravityInteractions.status, 'in_progress'),
    ))
    .get();
  return Number(row?.count ?? 0);
}

export async function clearAntigravityInteractions(env: Pick<Env, 'DB'>, jobId: string) {
  const db = getDb(env);
  await db.delete(antigravityInteractions).where(eq(antigravityInteractions.job_id, jobId));
}

/** Interactions that never reported back and must be reconciled by a direct GET. */
export async function listStaleAntigravityInteractions(
  env: Pick<Env, 'DB'>,
  jobId: string,
) {
  const db = getDb(env);
  return db.select()
    .from(antigravityInteractions)
    .where(and(
      eq(antigravityInteractions.job_id, jobId),
      ne(antigravityInteractions.status, 'completed'),
      ne(antigravityInteractions.status, 'failed'),
    ))
    .all();
}
