import { getDb } from './client';
import { julesSessions } from './schemas';
import { and, desc, eq, isNull, isNotNull } from 'drizzle-orm';

export type JulesSessionState = 'staged' | 'launched' | 'skipped' | 'error';
export type JulesSessionRow = typeof julesSessions.$inferSelect;

export type StageJulesSessionInput = {
  owner: string;
  repo: string;
  triggeringPrNumber: number;
  triggeringJobId?: string | null;
  prompt: string;
  gapSummary: string;
  prCommentId?: number | null;
};

/** Insert a staged session, or update the existing non-terminal one for this PR. */
export async function stageJulesSession(env: Pick<Env, 'DB'>, input: StageJulesSessionInput): Promise<JulesSessionRow> {
  const db = getDb(env);
  const existing = await db.select().from(julesSessions)
    .where(and(
      eq(julesSessions.owner, input.owner),
      eq(julesSessions.repo, input.repo),
      eq(julesSessions.triggering_pr_number, input.triggeringPrNumber),
      eq(julesSessions.state, 'staged'),
    )).limit(1).all();

  if (existing.length > 0) {
    const [row] = await db.update(julesSessions)
      .set({
        prompt: input.prompt,
        gap_summary: input.gapSummary,
        triggering_job_id: input.triggeringJobId ?? existing[0].triggering_job_id,
        pr_comment_id: input.prCommentId ?? existing[0].pr_comment_id,
        updated_at: new Date().toISOString(),
      })
      .where(eq(julesSessions.id, existing[0].id))
      .returning();
    return row;
  }

  const [row] = await db.insert(julesSessions).values({
    owner: input.owner,
    repo: input.repo,
    triggering_pr_number: input.triggeringPrNumber,
    triggering_job_id: input.triggeringJobId ?? null,
    prompt: input.prompt,
    gap_summary: input.gapSummary,
    pr_comment_id: input.prCommentId ?? null,
  }).returning();
  return row;
}

export async function listStagedJulesSessions(
  env: Pick<Env, 'DB'>, q: { owner: string; repo: string; prNumber: number },
): Promise<JulesSessionRow[]> {
  const db = getDb(env);
  return db.select().from(julesSessions)
    .where(and(
      eq(julesSessions.owner, q.owner),
      eq(julesSessions.repo, q.repo),
      eq(julesSessions.triggering_pr_number, q.prNumber),
      eq(julesSessions.state, 'staged'),
    )).all();
}

export async function markJulesLaunched(
  env: Pick<Env, 'DB'>, id: string, v: { sessionId: string; sessionUrl: string; sessionState: string },
): Promise<void> {
  const db = getDb(env);
  await db.update(julesSessions).set({
    state: 'launched',
    session_id: v.sessionId,
    session_url: v.sessionUrl,
    session_state: v.sessionState,
    updated_at: new Date().toISOString(),
  }).where(eq(julesSessions.id, id));
}

export async function markJulesOutcome(
  env: Pick<Env, 'DB'>, id: string, v: { state: 'skipped' | 'error'; errorMsg?: string; prCommentId?: number | null },
): Promise<void> {
  const db = getDb(env);
  await db.update(julesSessions).set({
    state: v.state,
    error_msg: v.errorMsg ?? null,
    ...(v.prCommentId != null ? { pr_comment_id: v.prCommentId } : {}),
    updated_at: new Date().toISOString(),
  }).where(eq(julesSessions.id, id));
}

/** Fetch a single session row by its Codra id. */
export async function getJulesSessionById(
  env: Pick<Env, 'DB'>, id: string,
): Promise<JulesSessionRow | null> {
  const db = getDb(env);
  const row = await db.select().from(julesSessions).where(eq(julesSessions.id, id)).get();
  return row ?? null;
}

/** Refresh the live session state (and url) pulled from Jules. Best-effort. */
export async function updateJulesLiveState(
  env: Pick<Env, 'DB'>, id: string, v: { sessionState: string; sessionUrl?: string | null },
): Promise<void> {
  const db = getDb(env);
  await db.update(julesSessions).set({
    session_state: v.sessionState,
    ...(v.sessionUrl ? { session_url: v.sessionUrl } : {}),
    updated_at: new Date().toISOString(),
  }).where(eq(julesSessions.id, id));
}

/** Launched sessions whose opened PR hasn't been captured yet (for the cron capture). */
export async function listLaunchedSessionsWithoutPr(
  env: Pick<Env, 'DB'>, limit = 10,
): Promise<JulesSessionRow[]> {
  const db = getDb(env);
  return db.select().from(julesSessions)
    .where(and(eq(julesSessions.state, 'launched'), isNotNull(julesSessions.session_id), isNull(julesSessions.created_pr_number)))
    .limit(limit).all();
}

export async function listJulesSessions(
  env: Pick<Env, 'DB'>, q: { owner?: string; repo?: string; limit: number; offset: number },
): Promise<JulesSessionRow[]> {
  const db = getDb(env);
  const conds = [];
  if (q.owner) conds.push(eq(julesSessions.owner, q.owner));
  if (q.repo) conds.push(eq(julesSessions.repo, q.repo));
  const where = conds.length ? and(...conds) : undefined;
  return db.select().from(julesSessions)
    .where(where).orderBy(desc(julesSessions.created_at)).limit(q.limit).offset(q.offset).all();
}
