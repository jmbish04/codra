import { getDb } from './client';
import { julesInteractions, julesSessions, julesOrchestrationTasks } from './schemas';
import { and, desc, eq } from 'drizzle-orm';

export type JulesInteractionRow = typeof julesInteractions.$inferSelect;
export type InteractionKind = 'launch' | 'correction' | 'improve' | 'answer' | 'clarify' | 'note';

/** Index an interaction codra had with Jules. Returns the row (id for status updates). */
export async function recordInteraction(env: Pick<Env, 'DB'>, input: {
  sessionId?: string | null; repository?: string | null; prNumber?: number | null;
  direction?: 'outbound' | 'inbound'; kind: InteractionKind; text?: string | null;
  status?: 'started' | 'sent' | 'error'; error?: string | null;
}): Promise<JulesInteractionRow> {
  const db = getDb(env);
  const [row] = await db.insert(julesInteractions).values({
    session_id: input.sessionId ?? null, repository: input.repository ?? null, pr_number: input.prNumber ?? null,
    direction: input.direction ?? 'outbound', kind: input.kind, text: input.text ?? null,
    status: input.status ?? 'started', error: input.error ?? null,
  }).returning();
  return row;
}

export async function updateInteractionStatus(
  env: Pick<Env, 'DB'>, id: string, status: 'started' | 'sent' | 'error', error?: string | null,
): Promise<void> {
  const db = getDb(env);
  await db.update(julesInteractions).set({ status, error: error ?? null }).where(eq(julesInteractions.id, id));
}

export async function listInteractions(
  env: Pick<Env, 'DB'>, q: { sessionId?: string; repository?: string; prNumber?: number; limit?: number },
): Promise<JulesInteractionRow[]> {
  const db = getDb(env);
  const conds = [];
  if (q.sessionId) conds.push(eq(julesInteractions.session_id, q.sessionId));
  if (q.repository) conds.push(eq(julesInteractions.repository, q.repository));
  if (q.prNumber != null) conds.push(eq(julesInteractions.pr_number, q.prNumber));
  return db.select().from(julesInteractions)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(julesInteractions.created_at)).limit(q.limit ?? 100).all();
}

/** Record the PR a launched Jules session opened, so a reviewed PR links back to it. */
export async function setJulesSessionCreatedPr(
  env: Pick<Env, 'DB'>, sessionId: string, pr: { number: number; url: string },
): Promise<void> {
  const db = getDb(env);
  await db.update(julesSessions).set({ created_pr_number: pr.number, created_pr_url: pr.url, updated_at: new Date().toISOString() })
    .where(eq(julesSessions.session_id, sessionId));
}

export type ResolvedSession = { sessionId: string; source: 'jules_session' | 'orchestration' };

/**
 * Find the live Jules session that opened this PR — checking codra-launched
 * sessions (jules_sessions.created_pr_number) first, then orchestration tasks
 * (matched by the canonical PR url). Returns null if the PR isn't Jules-linked.
 */
export async function resolveSessionForPr(
  env: Pick<Env, 'DB'>, owner: string, repo: string, prNumber: number,
): Promise<ResolvedSession | null> {
  const db = getDb(env);
  const bySession = await db.select().from(julesSessions)
    .where(and(eq(julesSessions.owner, owner), eq(julesSessions.repo, repo), eq(julesSessions.created_pr_number, prNumber)))
    .get();
  if (bySession?.session_id) return { sessionId: bySession.session_id, source: 'jules_session' };

  const prUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;
  const byTask = await db.select().from(julesOrchestrationTasks)
    .where(eq(julesOrchestrationTasks.last_pr_url, prUrl)).get();
  if (byTask?.session_id) return { sessionId: byTask.session_id, source: 'orchestration' };

  return null;
}
