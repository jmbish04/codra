import { findJulesSessionBySessionId, type JulesSessionRow } from '@server/db/jules-sessions';
import { setJulesSessionCreatedPr } from '@server/db/jules-interactions';
import { logger } from '@server/core/logger';
import { countAutoReviewsForPr, findActiveJobsForPr, findExistingJobForHead, insertJob, MAX_AUTO_REVIEWS_PER_PR } from '@server/db/jobs';
import { LEGACY_JOB_SCOPE, type RepoConfig } from '@shared/schema';
import type { GitHubClient } from '@server/core/github';

export type ClassifyJulesPrResult =
  | { kind: 'diverted'; session: JulesSessionRow }
  | { kind: 'external'; taskId: string }
  | { kind: 'none' };

// Defense-in-depth against a guessed task id: a launched session is only
// divert-eligible for a window after launch. Generous (7d) so a slow legit
// Jules run is never rejected, but an ancient stale session id can't be reused
// to skip review. The session id itself is an unguessable ~19-digit int, so
// this is belt-and-suspenders on top of the owner/repo + unlinked guards.
//
// ponytail: KNOWN RESIDUAL — this does NOT stop hijacking a *recent, unlinked*
// session (attacker with the task id opens a PR before Jules opens its real
// one). Accepted: the id is never published (D1-only), so an external attacker
// can't obtain it, and divert only skips Codra's review (never merges). The
// airtight fix if the threat model escalates is an SDK check that the session
// actually opened THIS PR (getJulesSession(...).pullRequestUrl) — deferred
// because it adds a webhook SDK call + a PR-open race that wastes reviews.
const DIVERT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
): Promise<ClassifyJulesPrResult> {
  const taskId = detectJulesTaskId({ body: pr.body, headRef: pr.headRef });
  if (!taskId) return { kind: 'none' };

  try {
    const session = await findJulesSessionBySessionId(env, taskId);
    // Divert only a Codra session that belongs to THIS repo and is either not yet
    // linked to a PR or already linked to this same PR (idempotent re-delivery).
    // Owner/repo binding blocks a cross-repo task-id spoof; the created_pr_number
    // check blocks reusing an old completed task id to bypass review.
    // Launch recency: parse the session's updated_at (ISO, set by markJulesLaunched).
    // Fail CLOSED — an unparseable/missing timestamp, or a future/negative age
    // (clock skew), is NOT "recent", so it does not qualify for divert.
    const launchedAt = Date.parse(session?.updated_at ?? '');
    const ageMs = Date.now() - launchedAt;
    const launchedRecently = Number.isFinite(launchedAt) && ageMs >= 0 && ageMs <= DIVERT_MAX_AGE_MS;
    const eligible = session
      && session.category === 'INTERNAL_CODRA'
      && session.owner === pr.owner
      && session.repo === pr.repo
      && (session.created_pr_number == null || session.created_pr_number === pr.prNumber)
      && launchedRecently;
    if (!eligible) {
      logger.info('jules pr not linked to a codra session', {
        owner: pr.owner, repo: pr.repo, prNumber: pr.prNumber, taskId,
        matched: Boolean(session), reason: !session ? 'no-session' : !launchedRecently ? 'stale-session' : 'not-eligible',
      });
      return { kind: 'external', taskId };
    }
    // `eligible` already proved `session` truthy; re-check narrows the type for TS.
    if (!session) return { kind: 'external', taskId };

    await setJulesSessionCreatedPr(env, taskId, { number: pr.prNumber, url: pr.prUrl });
    logger.info('diverted codra jules pr from standard review', { owner: pr.owner, repo: pr.repo, prNumber: pr.prNumber, taskId });
    return { kind: 'diverted', session };
  } catch (err) {
    // A taskId was already detected (recognized Jules PR) — a DB error here must
    // fail toward 'external' (still gated/routed), never 'none' (which would let
    // a recognized Jules PR slip through to a standard paid review).
    logger.warn('classifyAndLinkJulesPr failed; not diverting', { error: err instanceof Error ? err.message : String(err) });
    return { kind: 'external', taskId };
  }
}

/**
 * Enqueue a normal code-review-only job for an external Jules PR (a Jules PR
 * with no eligible Codra session). Guards against duplicate/racing jobs the
 * same way the webhook's own auto-review path does. Never throws — a failure
 * here must not break the caller's webhook response.
 */
export async function enqueueExternalReview(
  env: Pick<Env, 'DB' | 'REVIEW_QUEUE'>,
  gh: Pick<GitHubClient, 'getPullRequest'>,
  input: {
    owner: string;
    repo: string;
    prNumber: number;
    installationId: string;
    configSnapshot: RepoConfig | null;
    deliveryId: string;
    requestId?: string;
  },
): Promise<string | null> {
  try {
    const activeJobs = await findActiveJobsForPr(env, { owner: input.owner, repo: input.repo, prNumber: input.prNumber });
    if (activeJobs.length > 0) return null;

    const pr = await gh.getPullRequest(input.owner, input.repo, input.prNumber);

    const existingJob = await findExistingJobForHead(env, {
      owner: input.owner, repo: input.repo, prNumber: input.prNumber, commitSha: pr.head.sha, trigger: 'auto',
    });
    if (existingJob) return null;

    const autoCount = await countAutoReviewsForPr(env, {
      installationId: input.installationId, owner: input.owner, repo: input.repo, prNumber: input.prNumber,
    });
    if (autoCount >= MAX_AUTO_REVIEWS_PER_PR) return null;

    const job = await insertJob(env, {
      installationId: input.installationId,
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      prTitle: pr.title,
      prAuthor: pr.user.login,
      commitSha: pr.head.sha,
      baseSha: pr.base.sha,
      trigger: 'auto',
      headRef: pr.head.ref,
      baseRef: pr.base.ref,
      configSnapshot: input.configSnapshot,
      scope: LEGACY_JOB_SCOPE,
    });

    await env.REVIEW_QUEUE.send({
      jobId: job.id, deliveryId: input.deliveryId, phase: 'prepare', requestId: input.requestId,
    });
    logger.info('enqueued external jules pr review', { owner: input.owner, repo: input.repo, prNumber: input.prNumber, jobId: job.id });
    return job.id;
  } catch (err) {
    logger.warn('enqueueExternalReview failed', {
      owner: input.owner, repo: input.repo, prNumber: input.prNumber,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
