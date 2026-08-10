import { findJulesSessionBySessionId } from '@server/db/jules-sessions';
import { setJulesSessionCreatedPr } from '@server/db/jules-interactions';
import { logger } from '@server/core/logger';

/**
 * The Jules task id for a PR Jules opened, or null if this isn't a Jules PR.
 * Jules opens PRs as the authenticating user (not a bot), so we detect by
 * content: the body marker `jules.google.com/task/<id>`, falling back to the
 * `jules-…-<id>` branch name. Body and branch share the same trailing integer.
 */
export function detectJulesTaskId(pr: { body: string | null; headRef: string }): string | null {
  const fromBody = pr.body?.match(/jules\.google\.com\/task\/(\d+)/);
  if (fromBody) return fromBody[1];
  const fromBranch = pr.headRef?.match(/^jules-.*-(\d+)$/);
  if (fromBranch) return fromBranch[1];
  return null;
}

/**
 * Recognize a Jules PR and, when it is one of Codra's own launched sessions,
 * link the PR to that session and signal that the standard review should be
 * skipped. Tolerant: any parse/lookup miss returns { diverted: false } and the
 * caller falls through to the normal flow. External (non-Codra) Jules PRs are
 * left to P2 — they are not diverted here.
 */
export async function classifyAndLinkJulesPr(
  env: Pick<Env, 'DB'>,
  pr: { owner: string; repo: string; prNumber: number; prUrl: string; body: string | null; headRef: string },
): Promise<{ diverted: boolean }> {
  try {
    const taskId = detectJulesTaskId({ body: pr.body, headRef: pr.headRef });
    if (!taskId) return { diverted: false };

    const session = await findJulesSessionBySessionId(env, taskId);
    // Divert only a Codra session that belongs to THIS repo and is either not yet
    // linked to a PR or already linked to this same PR (idempotent re-delivery).
    // Owner/repo binding blocks a cross-repo task-id spoof; the created_pr_number
    // check blocks reusing an old completed task id to bypass review.
    const eligible = session
      && session.category === 'INTERNAL_CODRA'
      && session.owner === pr.owner
      && session.repo === pr.repo
      && (session.created_pr_number == null || session.created_pr_number === pr.prNumber);
    if (!eligible) {
      logger.info('jules pr not linked to a codra session', {
        owner: pr.owner, repo: pr.repo, prNumber: pr.prNumber, taskId,
        matched: Boolean(session), reason: !session ? 'no-session' : 'not-eligible',
      });
      return { diverted: false };
    }

    await setJulesSessionCreatedPr(env, taskId, { number: pr.prNumber, url: pr.prUrl });
    logger.info('diverted codra jules pr from standard review', { owner: pr.owner, repo: pr.repo, prNumber: pr.prNumber, taskId });
    return { diverted: true };
  } catch (err) {
    logger.warn('classifyAndLinkJulesPr failed; not diverting', { error: err instanceof Error ? err.message : String(err) });
    return { diverted: false };
  }
}
