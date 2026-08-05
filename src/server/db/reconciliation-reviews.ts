import { getDb } from './client';
import { reconciliationReviews } from './schemas';
import { desc, eq, sql } from 'drizzle-orm';

/**
 * countReviewAttempts
 */
export async function countReviewAttempts(env: Pick<Env, 'DB'>, reconciliationKey: string): Promise<number> {
  const db = getDb(env);
  const rows = await db.select({ n: sql<number>`count(*)` }).from(reconciliationReviews)
    .where(eq(reconciliationReviews.reconciliation_key, reconciliationKey)).all();
  return rows[0]?.n ?? 0;
}

/**
 * recordReview
 */
export async function recordReview(
  env: Pick<Env, 'DB'>,
  input: { repositoryId: number; reconciliationKey: string; attempt: number; prNumber?: number | null; verdict: 'approved' | 'rejected'; feedback?: string | null; summary?: string | null },
): Promise<void> {
  const db = getDb(env);
  await db.insert(reconciliationReviews).values({
    repository_id: input.repositoryId, reconciliation_key: input.reconciliationKey, attempt: input.attempt,
    pr_number: input.prNumber ?? null, verdict: input.verdict, feedback: input.feedback ?? null, summary: input.summary ?? null,
  });
}

/**
 * listReviews
 */
export async function listReviews(env: Pick<Env, 'DB'>, reconciliationKey: string) {
  const db = getDb(env);
  return db.select().from(reconciliationReviews)
    .where(eq(reconciliationReviews.reconciliation_key, reconciliationKey))
    .orderBy(desc(reconciliationReviews.created_at)).all();
}
