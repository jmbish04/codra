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
