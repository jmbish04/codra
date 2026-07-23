import { getDb } from '@server/db/client';
import { jobs } from '@server/db/schemas';
import { and, inArray, lt, sql } from 'drizzle-orm';
import { logger } from '@server/core/logger';

/**
 * A job counts as "stuck" when it has been queued or running longer than this
 * without progress. It is well past the queue lease (JOB_LEASE_SECONDS) and the
 * unleased recovery grace (300s), so anything older is genuinely wedged rather
 * than merely slow.
 */
export const STUCK_JOB_THRESHOLD_SECONDS = 900;

export type JobHealth = {
  healthy: boolean;
  checkedAt: string;
  counts: Record<string, number>;
  stuck: Array<{
    id: string;
    status: string;
    ageSeconds: number;
    lastProgressAt: string | null;
    recoveryCount: number;
  }>;
  reasons: string[];
};

/**
 * Snapshot of the review pipeline's health, derived entirely from the jobs
 * table. Cheap enough to run on every cron tick and behind the /api/health
 * endpoint.
 */
export async function computeJobHealth(env: Pick<Env, 'DB'>): Promise<JobHealth> {
  const db = getDb(env);

  const countRows = await db
    .select({ status: jobs.status, count: sql<number>`count(*)` })
    .from(jobs)
    .groupBy(jobs.status)
    .all();

  const counts: Record<string, number> = {};
  for (const row of countRows) counts[row.status] = Number(row.count);

  // Progress timestamp falls back through the columns that get stamped as a job
  // advances, so a job that never started is measured from creation.
  const progressExpr = sql`COALESCE(heartbeat_at, last_queue_message_at, started_at, created_at)`;
  const stuckRows = await db
    .select({
      id: jobs.id,
      status: jobs.status,
      lastProgressAt: progressExpr,
      ageSeconds: sql<number>`CAST((julianday('now') - julianday(${progressExpr})) * 86400 AS INTEGER)`,
      recoveryCount: jobs.recovery_count,
    })
    .from(jobs)
    .where(and(
      inArray(jobs.status, ['queued', 'running']),
      lt(progressExpr, sql`datetime('now', '-' || ${STUCK_JOB_THRESHOLD_SECONDS} || ' seconds')`),
    ))
    .limit(50)
    .all();

  const stuck = stuckRows.map((row) => ({
    id: row.id,
    status: row.status,
    ageSeconds: Number(row.ageSeconds ?? 0),
    lastProgressAt: (row.lastProgressAt as string | null) ?? null,
    recoveryCount: Number(row.recoveryCount ?? 0),
  }));

  const reasons: string[] = [];
  if (stuck.length > 0) {
    reasons.push(`${stuck.length} job(s) stuck for over ${Math.round(STUCK_JOB_THRESHOLD_SECONDS / 60)} minutes`);
  }

  return {
    healthy: reasons.length === 0,
    checkedAt: new Date().toISOString(),
    counts,
    stuck,
    reasons,
  };
}

/**
 * Runs the health check and, when unhealthy, emits a single loud error log.
 * With Workers observability enabled this is the alarm — it shows up in the
 * dashboard, logpush, and any error-rate alert wired to this service.
 */
export async function soundHealthAlarmIfUnhealthy(env: Pick<Env, 'DB'>): Promise<JobHealth> {
  const health = await computeJobHealth(env);
  if (!health.healthy) {
    logger.error('Codra health alarm: review pipeline is unhealthy', {
      reasons: health.reasons,
      stuckJobIds: health.stuck.map((job) => job.id),
      counts: health.counts,
    });
  }
  return health;
}
