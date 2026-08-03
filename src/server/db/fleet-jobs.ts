import { getDb } from './client';
import { fleetJobs, repositories } from './schemas';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

export type FleetJobRow = typeof fleetJobs.$inferSelect;
export type FleetJobKind = 'init' | 'analyze' | 'dispatch' | 'merge';

export async function createFleetJob(
  env: Pick<Env, 'DB'>, input: { repositoryId: number; kind: FleetJobKind; params?: unknown; createdBy?: string | null },
): Promise<FleetJobRow> {
  const db = getDb(env);
  const [row] = await db.insert(fleetJobs).values({
    repository_id: input.repositoryId, kind: input.kind,
    params_json: input.params != null ? JSON.stringify(input.params) : null,
    created_by: input.createdBy ?? null,
  }).returning();
  return row;
}

/** Queued jobs the off-Worker runner should pick up, joined to owner/repo for the CLI. */
export async function listQueuedFleetJobs(
  env: Pick<Env, 'DB'>, limit = 10,
): Promise<Array<{ jobId: string; kind: string; repositoryId: number; repository: string; params: unknown }>> {
  const db = getDb(env);
  const rows = await db.select({
    job_id: fleetJobs.job_id, kind: fleetJobs.kind, params_json: fleetJobs.params_json,
    repository_id: fleetJobs.repository_id, owner: repositories.owner, repo: repositories.repo,
  }).from(fleetJobs)
    .leftJoin(repositories, eq(repositories.id, fleetJobs.repository_id))
    .where(eq(fleetJobs.status, 'queued'))
    .orderBy(asc(fleetJobs.created_at)).limit(limit).all();
  return rows.map((r) => ({
    jobId: r.job_id, kind: r.kind, repositoryId: r.repository_id,
    repository: r.owner && r.repo ? `${r.owner}/${r.repo}` : '',
    params: r.params_json ? JSON.parse(r.params_json) : null,
  }));
}

/** Atomically claim a queued job (queued → running). Returns false if already taken. */
export async function claimFleetJob(env: Pick<Env, 'DB'>, jobId: string, claimedBy: string): Promise<boolean> {
  const db = getDb(env);
  const rows = await db.update(fleetJobs)
    .set({ status: 'running', claimed_by: claimedBy, updated_at: new Date().toISOString() })
    .where(and(eq(fleetJobs.job_id, jobId), eq(fleetJobs.status, 'queued'))).returning({ id: fleetJobs.job_id });
  return rows.length > 0;
}

export async function completeFleetJob(
  env: Pick<Env, 'DB'>, jobId: string, input: { status: 'completed' | 'failed'; result?: unknown; error?: string | null },
): Promise<void> {
  const db = getDb(env);
  await db.update(fleetJobs).set({
    status: input.status,
    result_json: input.result != null ? JSON.stringify(input.result) : null,
    error: input.error ?? null, updated_at: new Date().toISOString(),
  }).where(eq(fleetJobs.job_id, jobId));
}

export async function getFleetJob(env: Pick<Env, 'DB'>, jobId: string): Promise<FleetJobRow | null> {
  const db = getDb(env);
  return (await db.select().from(fleetJobs).where(eq(fleetJobs.job_id, jobId)).get()) ?? null;
}

export async function listFleetJobs(
  env: Pick<Env, 'DB'>, q: { repositoryId?: number; status?: string; limit?: number } = {},
): Promise<FleetJobRow[]> {
  const db = getDb(env);
  const conds = [];
  if (q.repositoryId != null) conds.push(eq(fleetJobs.repository_id, q.repositoryId));
  if (q.status) conds.push(eq(fleetJobs.status, q.status));
  return db.select().from(fleetJobs)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(fleetJobs.created_at)).limit(q.limit ?? 100).all();
}
