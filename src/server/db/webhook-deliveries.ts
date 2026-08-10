import { getDb, parseJsonColumn } from './client';
import { repositories, webhookDeliveries } from './schemas';
import { eq, and, desc, sql, gte, inArray } from 'drizzle-orm';

/**
 * Every terminal state a webhook delivery can reach. Finalized once per
 * delivery at the point the handler decides what to do with it.
 */
export type DeliveryOutcome =
  | 'received'                    // recorded, not yet finalized
  | 'rejected_signature'         // bad/missing HMAC signature (401)
  | 'invalid_payload'            // unparseable JSON (400)
  | 'duplicate'                  // delivery_id already seen
  | 'ignored_unsupported_event'  // event not handled
  | 'ignored_no_repository'      // payload had no repository
  | 'ignored_no_installation'    // no installation id
  | 'ignored_repo_disabled'      // repo config disabled
  | 'ignored_auto_cap'           // auto-review cap reached for this PR
  | 'kb_updated'                 // star/watch/fork updated the knowledge base
  | 'job_created'                // a review job was created
  | 'review_cancelled'           // PR closed/merged → an active review was cancelled
  | 'queued'                     // handed to REVIEW_QUEUE for deferred handling
  | 'no_action'                  // valid + supported but produced no job
  | 'jules_pr_diverted'          // diverted Codra Jules PR from standard review
  | 'error';                     // exception during processing (500)

export async function recordWebhookDelivery(
  env: Pick<Env, 'DB'>,
  input: {
    deliveryId: string;
    eventName: string;
    owner: string | null;
    repo: string | null;
    payload: unknown;
  },
) {
  const db = getDb(env);
  let repositoryId: number | null = null;

  if (input.owner && input.repo) {
    const repoRow = await db.select({ id: repositories.id })
      .from(repositories)
      .where(and(eq(repositories.owner, input.owner), eq(repositories.repo, input.repo)))
      .limit(1)
      .get();
    if (repoRow) {
      repositoryId = repoRow.id;
    }
  }

  const result = await db.insert(webhookDeliveries)
    .values({
      delivery_id: input.deliveryId,
      event_name: input.eventName,
      repository_id: repositoryId,
      payload: input.payload,
    })
    .onConflictDoNothing()
    .returning({ id: webhookDeliveries.id });

  return result.length > 0;
}

export async function getWebhookDelivery(
  env: Pick<Env, 'DB'>,
  deliveryId: string,
) {
  const db = getDb(env);
  const row = await db.select({
    delivery_id: webhookDeliveries.delivery_id,
    event_name: webhookDeliveries.event_name,
    payload: webhookDeliveries.payload,
  })
  .from(webhookDeliveries)
  .where(eq(webhookDeliveries.delivery_id, deliveryId))
  .limit(1)
  .get();

  return row ? { ...row, payload: parseJsonColumn(row.payload, null) } : null;
}

/** Delivery counts grouped by outcome (for the dashboard chart), within an optional window/repo. */
export async function webhookOutcomeStats(
  env: Pick<Env, 'DB'>,
  q?: { since?: string; repos?: string[] },
) {
  const db = getDb(env);
  const conds = [];
  if (q?.since) conds.push(gte(webhookDeliveries.received_at, q.since));
  if (q?.repos && q.repos.length) conds.push(inArray(repositories.repo, q.repos));
  const where = conds.length ? and(...conds) : undefined;

  const rows = await db.select({
    outcome: webhookDeliveries.outcome,
    count: sql<number>`count(*)`,
  })
    .from(webhookDeliveries)
    .leftJoin(repositories, eq(webhookDeliveries.repository_id, repositories.id))
    .where(where)
    .groupBy(webhookDeliveries.outcome)
    .all();

  return rows.map((r) => ({ outcome: r.outcome, count: Number(r.count) }));
}

/** Distinct repos that have webhook deliveries, for the repo filter. */
export async function webhookDeliveryRepos(env: Pick<Env, 'DB'>) {
  const db = getDb(env);
  const rows = await db.selectDistinct({ owner: repositories.owner, repo: repositories.repo })
    .from(webhookDeliveries)
    .innerJoin(repositories, eq(webhookDeliveries.repository_id, repositories.id))
    .all();
  return rows.filter((r) => r.owner && r.repo);
}

/**
 * Set the final outcome (and any linked action/PR/job/error) on a delivery.
 * Best-effort: callers wrap this so a recording failure never blocks webhook
 * processing.
 */
export async function finalizeWebhookDelivery(
  env: Pick<Env, 'DB'>,
  deliveryId: string,
  patch: {
    outcome: DeliveryOutcome;
    action?: string;
    prNumber?: number;
    jobId?: string;
    error?: string;
    owner?: string | null;
    repo?: string | null;
  },
) {
  const db = getDb(env);

  // Link the delivery to its repository (recorded null pre-parse) so the
  // dashboard can show and filter by repo.
  let repositoryId: number | undefined;
  if (patch.owner && patch.repo) {
    const repoRow = await db.select({ id: repositories.id })
      .from(repositories)
      .where(and(eq(repositories.owner, patch.owner), eq(repositories.repo, patch.repo)))
      .limit(1)
      .get();
    if (repoRow) repositoryId = repoRow.id;
  }

  await db.update(webhookDeliveries)
    .set({
      outcome: patch.outcome,
      action: patch.action ?? null,
      pr_number: patch.prNumber ?? null,
      job_id: patch.jobId ?? null,
      error: patch.error ?? null,
      ...(repositoryId !== undefined ? { repository_id: repositoryId } : {}),
    })
    .where(eq(webhookDeliveries.delivery_id, deliveryId));
}

/** Raw delivery row by delivery_id (used by tests and internal checks). */
export async function getWebhookDeliveryRow(env: Pick<Env, 'DB'>, deliveryId: string) {
  const db = getDb(env);
  return db.select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.delivery_id, deliveryId))
    .limit(1)
    .get();
}

/** Filterable, paginated list of deliveries for the dashboard. */
export async function listWebhookDeliveries(
  env: Pick<Env, 'DB'>,
  q: { outcome?: string; event?: string; owner?: string; repo?: string; repos?: string[]; since?: string; limit: number; offset: number },
) {
  const db = getDb(env);
  const conds = [];
  if (q.outcome) conds.push(eq(webhookDeliveries.outcome, q.outcome));
  if (q.event) conds.push(eq(webhookDeliveries.event_name, q.event));
  if (q.owner) conds.push(eq(repositories.owner, q.owner));
  if (q.repo) conds.push(eq(repositories.repo, q.repo));
  if (q.repos && q.repos.length) conds.push(inArray(repositories.repo, q.repos));
  if (q.since) conds.push(gte(webhookDeliveries.received_at, q.since));
  const where = conds.length ? and(...conds) : undefined;

  const items = await db.select({
    id: webhookDeliveries.id,
    received_at: webhookDeliveries.received_at,
    event_name: webhookDeliveries.event_name,
    outcome: webhookDeliveries.outcome,
    action: webhookDeliveries.action,
    pr_number: webhookDeliveries.pr_number,
    job_id: webhookDeliveries.job_id,
    error: webhookDeliveries.error,
    owner: repositories.owner,
    repo: repositories.repo,
  })
    .from(webhookDeliveries)
    .leftJoin(repositories, eq(webhookDeliveries.repository_id, repositories.id))
    .where(where)
    .orderBy(desc(webhookDeliveries.received_at))
    .limit(q.limit)
    .offset(q.offset)
    .all();

  const totalRow = await db.select({ c: sql<number>`count(*)` })
    .from(webhookDeliveries)
    .leftJoin(repositories, eq(webhookDeliveries.repository_id, repositories.id))
    .where(where)
    .get();

  return { items, total: totalRow?.c ?? 0 };
}

/** Full delivery (including parsed payload) by primary id, for the detail drawer. */
export async function getWebhookDeliveryById(env: Pick<Env, 'DB'>, id: string) {
  const db = getDb(env);
  const row = await db.select({
    id: webhookDeliveries.id,
    received_at: webhookDeliveries.received_at,
    event_name: webhookDeliveries.event_name,
    outcome: webhookDeliveries.outcome,
    action: webhookDeliveries.action,
    pr_number: webhookDeliveries.pr_number,
    job_id: webhookDeliveries.job_id,
    error: webhookDeliveries.error,
    payload: webhookDeliveries.payload,
    owner: repositories.owner,
    repo: repositories.repo,
  })
    .from(webhookDeliveries)
    .leftJoin(repositories, eq(webhookDeliveries.repository_id, repositories.id))
    .where(eq(webhookDeliveries.id, id))
    .limit(1)
    .get();
  return row ? { ...row, payload: parseJsonColumn(row.payload, null) } : null;
}
