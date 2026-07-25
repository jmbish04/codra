import { getDb, parseJsonColumn } from './client';
import { dismissedStandards, agentActions } from './schemas';
import { and, eq } from 'drizzle-orm';

/** The set of standard target paths this repo has permanently rejected. */
export async function getDismissedStandards(env: Pick<Env, 'DB'>, owner: string, repo: string): Promise<Set<string>> {
  const db = getDb(env);
  const rows = await db.select({ target_path: dismissedStandards.target_path })
    .from(dismissedStandards)
    .where(and(eq(dismissedStandards.owner, owner), eq(dismissedStandards.repo, repo)))
    .all();
  return new Set(rows.map((r) => r.target_path));
}

/** Permanently exclude these standard files for the repo (idempotent). */
export async function recordDismissedStandards(
  env: Pick<Env, 'DB'>,
  input: { owner: string; repo: string; targetPaths: string[]; closedPrNumber?: number | null },
) {
  if (input.targetPaths.length === 0) return;
  const db = getDb(env);
  await db.insert(dismissedStandards)
    .values(input.targetPaths.map((p) => ({
      owner: input.owner,
      repo: input.repo,
      target_path: p,
      closed_pr_number: input.closedPrNumber ?? null,
    })))
    .onConflictDoNothing();
}

/**
 * The files codra put in a housekeeping PR, from the recorded agent action.
 * Used to know which standard files a closed housekeeping PR contained.
 */
export async function getHousekeepingPrFiles(
  env: Pick<Env, 'DB'>,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<string[]> {
  const db = getDb(env);
  const row = await db.select({ files: agentActions.files })
    .from(agentActions)
    .where(and(
      eq(agentActions.owner, owner),
      eq(agentActions.repo, repo),
      eq(agentActions.pr_number, prNumber),
      eq(agentActions.action_type, 'standardization'),
    ))
    .get();
  return row ? (parseJsonColumn(row.files, [] as string[]) as string[]) : [];
}
