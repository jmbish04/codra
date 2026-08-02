import { getDb } from './client';
import { julesOrchestrationTasks, julesOrchestrationEvents } from './schemas';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';

export type OrchestrationTaskRow = typeof julesOrchestrationTasks.$inferSelect;

/** Statuses the cron poller still advances. Anything else is terminal for polling. */
export const ACTIVE_STATUSES = ['pending', 'planning', 'plan_review', 'awaiting_feedback', 'executing'] as const;

export async function createOrchestrationTask(
  env: Pick<Env, 'DB'>, input: { packageId: string; repositoryId: number },
): Promise<OrchestrationTaskRow> {
  const db = getDb(env);
  const [row] = await db.insert(julesOrchestrationTasks)
    .values({ package_id: input.packageId, repository_id: input.repositoryId, status: 'pending' }).returning();
  return row;
}

export async function getTaskByToken(env: Pick<Env, 'DB'>, taskId: string): Promise<OrchestrationTaskRow | null> {
  const db = getDb(env);
  return (await db.select().from(julesOrchestrationTasks).where(eq(julesOrchestrationTasks.task_id, taskId)).get()) ?? null;
}

export async function getTaskBySession(env: Pick<Env, 'DB'>, sessionId: string): Promise<OrchestrationTaskRow | null> {
  const db = getDb(env);
  return (await db.select().from(julesOrchestrationTasks).where(eq(julesOrchestrationTasks.session_id, sessionId)).get()) ?? null;
}

/** Active tasks the poller should advance. Empty result ⇒ the cron tick no-ops. */
export async function listActiveTasks(env: Pick<Env, 'DB'>, limit = 25): Promise<OrchestrationTaskRow[]> {
  const db = getDb(env);
  return db.select().from(julesOrchestrationTasks)
    .where(inArray(julesOrchestrationTasks.status, [...ACTIVE_STATUSES]))
    .orderBy(julesOrchestrationTasks.updated_at).limit(limit).all();
}

export async function updateTaskStatus(
  env: Pick<Env, 'DB'>, taskId: string,
  patch: { status?: string; sessionId?: string | null; lastPrUrl?: string | null; error?: string | null },
): Promise<void> {
  const db = getDb(env);
  const set: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.sessionId !== undefined) set.session_id = patch.sessionId;
  if (patch.lastPrUrl !== undefined) set.last_pr_url = patch.lastPrUrl;
  if (patch.error !== undefined) set.error = patch.error;
  await db.update(julesOrchestrationTasks).set(set).where(eq(julesOrchestrationTasks.task_id, taskId));
}

/** Atomic increment; returns the new count (drives the circuit breaker). */
export async function incrementTaskIteration(env: Pick<Env, 'DB'>, taskId: string): Promise<number> {
  const db = getDb(env);
  const [row] = await db.update(julesOrchestrationTasks)
    .set({ iterations: sql`${julesOrchestrationTasks.iterations} + 1`, updated_at: new Date().toISOString() })
    .where(eq(julesOrchestrationTasks.task_id, taskId)).returning();
  return row?.iterations ?? 0;
}

export async function logTaskEvent(
  env: Pick<Env, 'DB'>, taskId: string, event: string, payload?: unknown,
): Promise<void> {
  const db = getDb(env);
  await db.insert(julesOrchestrationEvents)
    .values({ task_id: taskId, event, payload: payload != null ? JSON.stringify(payload) : null });
}

/**
 * GitHub pull_request webhook fast-path: if an orchestration task is already
 * linked to this PR url (set by the poller when it saw the PR), mark it pr_ready.
 * Matches only on an exact recorded url, so there are no false positives; the
 * poller remains the primary PR detector.
 */
export async function markPrReadyByUrl(env: Pick<Env, 'DB'>, prUrl: string): Promise<boolean> {
  const db = getDb(env);
  const rows = await db.update(julesOrchestrationTasks)
    .set({ status: 'pr_ready', updated_at: new Date().toISOString() })
    .where(and(eq(julesOrchestrationTasks.last_pr_url, prUrl), ne(julesOrchestrationTasks.status, 'accepted')))
    .returning({ id: julesOrchestrationTasks.task_id });
  return rows.length > 0;
}

export type GlobalReportRow = { repository_id: number; status: string; total: number; latest: string };

/** Cross-repo summary: task counts per repository and status. */
export async function globalOrchestrationReport(env: Pick<Env, 'DB'>): Promise<GlobalReportRow[]> {
  const db = getDb(env);
  const rows = await db.select({
    repository_id: julesOrchestrationTasks.repository_id,
    status: julesOrchestrationTasks.status,
    total: sql<number>`count(*)`,
    latest: sql<string>`max(${julesOrchestrationTasks.updated_at})`,
  }).from(julesOrchestrationTasks)
    .groupBy(julesOrchestrationTasks.repository_id, julesOrchestrationTasks.status)
    .orderBy(desc(sql`max(${julesOrchestrationTasks.updated_at})`)).all();
  return rows as GlobalReportRow[];
}
