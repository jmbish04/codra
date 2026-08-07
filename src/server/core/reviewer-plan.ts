import type { RepoConfig } from '@shared/schema';
import type { ReviewerId } from '@server/prompts/reviewers';

const TRIVIAL: ReviewerId[] = ['security', 'correctness'];
const LITE_ADD: ReviewerId[] = ['bugs', 'performance'];
const FULL_ADD: ReviewerId[] = ['quality', 'docs'];

/** Reviewer set scales with PR size, then is intersected with review.focus.
 *  `docs` is always allowed through the focus filter (focus enumerates
 *  categories; docs maps to the 'quality' category). */
export function planReviewers(
  totalLineCount: number,
  _fileCount: number,
  config: RepoConfig['review'],
): ReviewerId[] {
  const t = config.risk_tiers;
  let set: ReviewerId[] = [...TRIVIAL];
  if (totalLineCount > t.trivial_max_lines) set = [...set, ...LITE_ADD];
  if (totalLineCount > t.lite_max_lines) set = [...set, ...FULL_ADD];

  const focus = new Set(config.focus);
  return set.filter((id) => id === 'docs' ? focus.has('quality') : focus.has(id as any));
}

export type FilePlanDecision =
  | { action: 'proceed'; plan: ReviewerId[] }
  | { action: 'defer' };

/**
 * Budget-aware gate for a single file's reviewer fan-out, run before kicking
 * off its model calls. Each reviewer call + a batched DO comment fetch costs
 * roughly `plan.length + 1` subrequests; `+2` leaves a 1-subrequest margin.
 * Cloudflare caps subrequests at 50 per invocation, so a large PR must spread
 * its files' reviewer fan-out across multiple queue invocations rather than
 * front-load them all into one chunk.
 *
 * - If the full plan fits the remaining budget, proceed with it unchanged.
 * - If it doesn't and this invocation has already started other files this
 *   chunk, defer this file to the next invocation (fresh tracker/budget).
 * - If it doesn't fit even as the FIRST file this invocation (only realistic
 *   if earlier steps in the same invocation, e.g. standardization/docs-gap,
 *   already burned most of the budget, or an unusually large plan), degrade
 *   to the trivial-tier subset (security + correctness) so the file still
 *   makes progress instead of stalling the whole job — the full reviewer set
 *   can catch up on the file's next review run.
 */
export function selectFilePlanForBudget(
  plan: ReviewerId[],
  processedThisChunk: number,
  hasRemainingSubrequests: (needed: number) => boolean,
): FilePlanDecision {
  if (plan.length <= 1 || hasRemainingSubrequests(plan.length + 2)) {
    return { action: 'proceed', plan };
  }
  if (processedThisChunk > 0) {
    return { action: 'defer' };
  }
  const trivialSubset = plan.filter((id) => id === 'security' || id === 'correctness');
  return { action: 'proceed', plan: trivialSubset.length > 0 ? trivialSubset : plan.slice(0, 1) };
}
