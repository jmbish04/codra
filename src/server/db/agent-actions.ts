import { getDb, parseJsonColumn } from './client';
import { agentActions } from './schemas';
import { desc, eq, and } from 'drizzle-orm';

export type AgentActionInput = {
  owner: string;
  repo: string;
  actionType: string;
  summary: string;
  files?: string[];
  prNumber?: number | null;
  prUrl?: string | null;
  triggeringPrNumber?: number | null;
  triggeringJobId?: string | null;
};

export async function recordAgentAction(env: Pick<Env, 'DB'>, input: AgentActionInput) {
  const db = getDb(env);
  const [row] = await db.insert(agentActions)
    .values({
      owner: input.owner,
      repo: input.repo,
      action_type: input.actionType,
      summary: input.summary,
      files: input.files ?? [],
      pr_number: input.prNumber ?? null,
      pr_url: input.prUrl ?? null,
      triggering_pr_number: input.triggeringPrNumber ?? null,
      triggering_job_id: input.triggeringJobId ?? null,
    })
    .returning();
  return row;
}

export async function listAgentActions(
  env: Pick<Env, 'DB'>,
  q: { owner?: string; repo?: string; limit: number; offset: number },
) {
  const db = getDb(env);
  const conds = [];
  if (q.owner) conds.push(eq(agentActions.owner, q.owner));
  if (q.repo) conds.push(eq(agentActions.repo, q.repo));
  const where = conds.length ? and(...conds) : undefined;

  const rows = await db.select()
    .from(agentActions)
    .where(where)
    .orderBy(desc(agentActions.created_at))
    .limit(q.limit)
    .offset(q.offset)
    .all();

  return rows.map((r) => ({ ...r, files: parseJsonColumn(r.files, [] as string[]) }));
}
