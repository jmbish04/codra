import { getDb } from './client';
import { julesActivityCache, julesActivitySync } from './schemas';
import { and, asc, eq, gt } from 'drizzle-orm';

/** camelCase DTO matching client.ts JulesActivity. */
export type JulesActivityDto = {
  id: string;
  name: string;
  type: string;
  originator: string;
  createTime: string;
  description: string | null;
  message: string | null;
  title: string | null;
  reason: string | null;
  plan: { id: string; steps: Array<{ id: string; title: string; description?: string | null; index?: number }> } | null;
  planId: string | null;
  artifacts: Array<Record<string, unknown>>;
};

type RawActivity = Record<string, any>;

/**
 * Normalize an SDK Activity (top-level `type` flattened by the SDK) into cache
 * columns. Defensive — Jules activity shapes vary by type; missing fields are null.
 */
export function normalizeActivity(a: RawActivity): {
  activityId: string; type: string; originator: string | null; name: string | null;
  createTime: string | null; description: string | null; message: string | null; title: string | null;
  reason: string | null; planId: string | null; planJson: string | null; artifactsJson: string | null;
} {
  const plan = a.plan ?? null;
  const artifacts = Array.isArray(a.artifacts) ? a.artifacts : [];
  return {
    activityId: String(a.id ?? a.activityId ?? a.name ?? crypto.randomUUID()),
    type: String(a.type ?? 'unknown'),
    originator: a.originator ?? null,
    name: a.name ?? null,
    createTime: a.createTime ?? a.create_time ?? null,
    description: a.description ?? null,
    message: a.message ?? null,
    title: a.title ?? null,
    reason: a.reason ?? null,
    planId: a.planId ?? plan?.id ?? null,
    planJson: plan ? JSON.stringify(plan) : null,
    artifactsJson: artifacts.length ? JSON.stringify(artifacts) : null,
  };
}

/** Persist a session's activities (dedup by activity_id) and bump synced_at. */
export async function upsertActivities(
  env: Pick<Env, 'DB'>, input: { sessionId: string; taskId: string; activities: RawActivity[] },
): Promise<{ inserted: number }> {
  const db = getDb(env);
  let inserted = 0;
  for (const raw of input.activities ?? []) {
    const n = normalizeActivity(raw);
    const res = await db.insert(julesActivityCache).values({
      session_id: input.sessionId, task_id: input.taskId, activity_id: n.activityId,
      type: n.type, originator: n.originator, name: n.name, create_time: n.createTime,
      description: n.description, message: n.message, title: n.title, reason: n.reason,
      plan_id: n.planId, plan_json: n.planJson, artifacts_json: n.artifactsJson,
    }).onConflictDoNothing().returning({ seq: julesActivityCache.seq });
    if (res.length) inserted++;
  }
  const now = new Date().toISOString();
  await db.insert(julesActivitySync).values({ session_id: input.sessionId, synced_at: now })
    .onConflictDoUpdate({ target: julesActivitySync.session_id, set: { synced_at: now } });
  return { inserted };
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function rowToDto(r: typeof julesActivityCache.$inferSelect): JulesActivityDto {
  return {
    id: r.activity_id,
    name: r.name ?? r.activity_id,
    type: r.type,
    originator: r.originator ?? 'system',
    createTime: r.create_time ?? r.ingested_at,
    description: r.description,
    message: r.message,
    title: r.title,
    reason: r.reason,
    plan: safeParse(r.plan_json, null),
    planId: r.plan_id,
    artifacts: safeParse(r.artifacts_json, [] as Array<Record<string, unknown>>),
  };
}

/** Serve cached activities for a task, oldest-first, paged by the `seq` cursor. */
export async function listCachedActivities(
  env: Pick<Env, 'DB'>, taskId: string, opts: { after?: string; limit?: number } = {},
): Promise<{ activities: JulesActivityDto[]; nextCursor: string | null; syncedAt: string | null }> {
  const db = getDb(env);
  const limit = Math.min(opts.limit ?? 200, 500);
  const afterSeq = opts.after ? Number(opts.after) : 0;
  const conds = [eq(julesActivityCache.task_id, taskId)];
  if (Number.isFinite(afterSeq) && afterSeq > 0) conds.push(gt(julesActivityCache.seq, afterSeq));

  const rows = await db.select().from(julesActivityCache)
    .where(and(...conds)).orderBy(asc(julesActivityCache.seq)).limit(limit + 1).all();

  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? String(page[page.length - 1].seq) : null;

  const sessionId = page[0]?.session_id;
  let syncedAt: string | null = null;
  if (sessionId) {
    const sync = await db.select().from(julesActivitySync).where(eq(julesActivitySync.session_id, sessionId)).get();
    syncedAt = sync?.synced_at ?? null;
  }
  return { activities: page.map(rowToDto), nextCursor, syncedAt };
}
