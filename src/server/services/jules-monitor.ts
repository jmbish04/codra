import { getDb } from '@server/db/client';
import { julesOrchestrationTasks, julesOrchestrationEvents, planningPackages, repositories } from '@server/db/schemas';
import { ACTIVE_STATUSES } from '@server/db/jules-orchestration';
import { listAgents } from '@server/db/agent-heartbeats';
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';

// ---- DTOs (camelCase — match src/client/components/features/jules-monitoring/client.ts) ----

export type JulesMonitorStatus = typeof julesOrchestrationTasks.$inferSelect['status'];

export type JulesMonitorTask = {
  taskId: string; packageId: string; packageTitle: string; packageSlug: string;
  repositoryId: number; repository: string; sessionId: string | null; sessionUrl: string | null;
  status: string; iterations: number; lastPrUrl: string | null; error: string | null;
  createdAt: string; updatedAt: string;
};

export type JulesMonitorEvent = {
  id: string; taskId: string; event: string; summary: string | null;
  payload: Record<string, unknown> | null; createdAt: string;
};

export type JulesMonitorHealth = {
  mode: 'external_watcher' | 'cron' | 'hybrid' | 'unknown';
  watcher: { state: 'online' | 'stale' | 'offline' | 'unknown'; lastSeenAt: string | null; activeSessions: number; hostname: string | null };
  poller: { state: 'healthy' | 'delayed' | 'unknown'; lastRunAt: string | null; nextRunAt: string | null };
};

export type JulesMonitorSummary = {
  total: number; active: number; needsAttention: number; accepted: number;
  counts: Record<string, number>; health: JulesMonitorHealth;
};

const TERMINAL_STATUSES = ['pr_ready', 'accepted', 'stuck', 'failed'] as const;
const WATCHER_ONLINE_MS = 90_000;
const WATCHER_STALE_MS = 600_000;

function sessionUrl(sessionId: string | null): string | null {
  return sessionId ? `https://jules.google.com/session/${sessionId}` : null;
}

type JoinedRow = {
  t: typeof julesOrchestrationTasks.$inferSelect;
  title: string | null; slug: string | null; owner: string | null; repo: string | null;
};

function mapTask(r: JoinedRow): JulesMonitorTask {
  return {
    taskId: r.t.task_id, packageId: r.t.package_id,
    packageTitle: r.title ?? '(unknown package)', packageSlug: r.slug ?? '',
    repositoryId: r.t.repository_id, repository: r.owner && r.repo ? `${r.owner}/${r.repo}` : '',
    sessionId: r.t.session_id, sessionUrl: sessionUrl(r.t.session_id),
    status: r.t.status, iterations: r.t.iterations, lastPrUrl: r.t.last_pr_url, error: r.t.error,
    createdAt: r.t.created_at, updatedAt: r.t.updated_at,
  };
}

function statusFilter(status?: string) {
  if (!status || status === 'all') return undefined;
  if (status === 'active') return inArray(julesOrchestrationTasks.status, [...ACTIVE_STATUSES]);
  if (status === 'terminal') return inArray(julesOrchestrationTasks.status, [...TERMINAL_STATUSES]);
  return eq(julesOrchestrationTasks.status, status);
}

const baseSelect = {
  t: julesOrchestrationTasks,
  title: planningPackages.title, slug: planningPackages.slug,
  owner: repositories.owner, repo: repositories.repo,
};

function fromJoined(db: ReturnType<typeof getDb>) {
  return db.select(baseSelect).from(julesOrchestrationTasks)
    .leftJoin(planningPackages, eq(planningPackages.id, julesOrchestrationTasks.package_id))
    .leftJoin(repositories, eq(repositories.id, julesOrchestrationTasks.repository_id));
}

export async function listMonitorTasks(
  env: Pick<Env, 'DB'>, params: { status?: string; repository?: string; query?: string; limit?: number; offset?: number },
): Promise<{ tasks: JulesMonitorTask[]; total: number }> {
  const db = getDb(env);
  const conds = [statusFilter(params.status)];
  if (params.repository) conds.push(sql`(${repositories.owner} || '/' || ${repositories.repo}) = ${params.repository}`);
  if (params.query) {
    const q = `%${params.query}%`;
    conds.push(or(like(planningPackages.title, q), like(planningPackages.slug, q), like(repositories.owner, q), like(repositories.repo, q)));
  }
  const where = and(...conds.filter(Boolean) as any[]);

  const rows = await fromJoined(db).where(where)
    .orderBy(desc(julesOrchestrationTasks.updated_at))
    .limit(Math.min(params.limit ?? 100, 200)).offset(params.offset ?? 0).all();

  const countRows = await db.select({ n: sql<number>`count(*)` }).from(julesOrchestrationTasks)
    .leftJoin(planningPackages, eq(planningPackages.id, julesOrchestrationTasks.package_id))
    .leftJoin(repositories, eq(repositories.id, julesOrchestrationTasks.repository_id))
    .where(where).all();

  return { tasks: (rows as JoinedRow[]).map(mapTask), total: countRows[0]?.n ?? 0 };
}

export async function getMonitorTask(env: Pick<Env, 'DB'>, taskId: string): Promise<JulesMonitorTask | null> {
  const db = getDb(env);
  const row = await fromJoined(db).where(eq(julesOrchestrationTasks.task_id, taskId)).get();
  return row ? mapTask(row as JoinedRow) : null;
}

export async function listMonitorEvents(env: Pick<Env, 'DB'>, taskId: string): Promise<JulesMonitorEvent[]> {
  const db = getDb(env);
  const rows = await db.select().from(julesOrchestrationEvents)
    .where(eq(julesOrchestrationEvents.task_id, taskId)).orderBy(desc(julesOrchestrationEvents.created_at)).all();
  const parsePayload = (raw: string | null): Record<string, unknown> | null => {
    if (!raw) return null;
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
  };
  return rows.map((e) => ({
    id: e.id, taskId: e.task_id, event: e.event, summary: null,
    payload: parsePayload(e.payload), createdAt: e.created_at,
  }));
}

export async function deriveHealth(env: Pick<Env, 'DB'>, nowMs = Date.now()): Promise<JulesMonitorHealth> {
  const agents = await listAgents(env);
  const latest = agents[0] ?? null;
  let watcherState: JulesMonitorHealth['watcher']['state'] = 'unknown';
  if (latest) {
    const age = nowMs - Date.parse(latest.last_seen_at);
    watcherState = age <= WATCHER_ONLINE_MS ? 'online' : age <= WATCHER_STALE_MS ? 'stale' : 'offline';
  }
  // The cron trigger is configured but its last-run isn't tracked — report honestly.
  const poller: JulesMonitorHealth['poller'] = { state: 'unknown', lastRunAt: null, nextRunAt: null };
  const mode: JulesMonitorHealth['mode'] = watcherState === 'online' ? 'hybrid' : latest ? 'cron' : 'unknown';
  return {
    mode,
    watcher: {
      state: watcherState,
      lastSeenAt: latest?.last_seen_at ?? null,
      activeSessions: latest?.active_sessions ?? 0,
      hostname: latest?.hostname ?? null,
    },
    poller,
  };
}

export async function buildSummary(env: Pick<Env, 'DB'>): Promise<JulesMonitorSummary> {
  const db = getDb(env);
  const rows = await db.select({ status: julesOrchestrationTasks.status, n: sql<number>`count(*)` })
    .from(julesOrchestrationTasks).groupBy(julesOrchestrationTasks.status).all();
  const counts: Record<string, number> = {};
  let total = 0;
  for (const r of rows) { counts[r.status] = r.n; total += r.n; }
  const active = (ACTIVE_STATUSES as readonly string[]).reduce((s, st) => s + (counts[st] ?? 0), 0);
  const needsAttention = (counts.stuck ?? 0) + (counts.failed ?? 0);
  return { total, active, needsAttention, accepted: counts.accepted ?? 0, counts, health: await deriveHealth(env) };
}
