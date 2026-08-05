import { getDb } from './client';
import { agentHeartbeats } from './schemas';
import { desc, eq } from 'drizzle-orm';

export type AgentHeartbeatRow = typeof agentHeartbeats.$inferSelect;

/** Upsert a watcher agent's heartbeat (bumps last_seen_at to now). */
export async function recordHeartbeat(
  env: Pick<Env, 'DB'>, input: { agentId: string; hostname?: string | null; version?: string | null; activeSessions?: number },
): Promise<void> {
  const db = getDb(env);
  const now = new Date().toISOString();
  await db.insert(agentHeartbeats)
    .values({
      agent_id: input.agentId, hostname: input.hostname ?? null, version: input.version ?? null,
      active_sessions: input.activeSessions ?? 0, last_seen_at: now,
    })
    .onConflictDoUpdate({
      target: agentHeartbeats.agent_id,
      set: { hostname: input.hostname ?? null, version: input.version ?? null, active_sessions: input.activeSessions ?? 0, last_seen_at: now },
    });
}

export async function listAgents(env: Pick<Env, 'DB'>): Promise<AgentHeartbeatRow[]> {
  const db = getDb(env);
  return db.select().from(agentHeartbeats).orderBy(desc(agentHeartbeats.last_seen_at)).all();
}

export async function getAgent(env: Pick<Env, 'DB'>, agentId: string): Promise<AgentHeartbeatRow | null> {
  const db = getDb(env);
  return (await db.select().from(agentHeartbeats).where(eq(agentHeartbeats.agent_id, agentId)).get()) ?? null;
}

/** True if any agent has beat within `withinMs` (default 90s). Drives fallback + UI. */
export async function isAnyAgentAlive(env: Pick<Env, 'DB'>, withinMs = 90_000, nowMs = Date.now()): Promise<boolean> {
  const agents = await listAgents(env);
  return agents.some((a) => nowMs - Date.parse(a.last_seen_at) <= withinMs);
}
