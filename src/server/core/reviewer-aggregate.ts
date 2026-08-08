import type { ParsedReviewComment } from '@shared/schema';

const SEVERITY_RANKS: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, nit: 4 };

/** Applies min_severity filtering, severity ordering, and max_comments cap for
 *  finalize. `omittedCount` counts only findings dropped by the cap (not by
 *  min_severity), so the PR summary note stays accurate. */
export function limitFinalReviewComments(
  comments: ParsedReviewComment[],
  minSeverity: string,
  maxComments: number,
): { comments: ParsedReviewComment[]; omittedCount: number } {
  const minRank = SEVERITY_RANKS[minSeverity] ?? 4;
  const filtered = comments.filter((c) => (SEVERITY_RANKS[c.severity] ?? 4) <= minRank);
  filtered.sort((a, b) => (SEVERITY_RANKS[a.severity] ?? 4) - (SEVERITY_RANKS[b.severity] ?? 4));
  const omittedCount = Math.max(0, filtered.length - maxComments);
  return { comments: filtered.slice(0, maxComments), omittedCount };
}

/** One specialized reviewer's raw model call result for a single file. */
export type ReviewerCallResult = {
  reviewer: string;
  parsed: {
    comments: ParsedReviewComment[];
    verdict: 'approve' | 'comment';
    fileSummary: string | null;
    overallCorrectness?: string | null;
    confidenceScore?: number | null;
  };
  modelUsed: string;
  provider: string;
  rawText: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export type AggregatedReview = {
  comments: ParsedReviewComment[];
  verdict: 'approve' | 'comment';
  fileSummary: string | null;
  overallCorrectness: string | null;
  confidenceScore: number | null;
  modelUsed: string;
  provider: string;
  rawText: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
};

/** Sums a token field across results, but stays `null` (matching the
 *  single-reviewer path) when NO reviewer reported one, instead of a
 *  misleading `0`. */
function sumOrNull(results: ReviewerCallResult[], pick: (r: ReviewerCallResult) => number | undefined): number | null {
  const values = results.map(pick).filter((v): v is number => typeof v === 'number');
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) : null;
}

/**
 * Combines N specialized-reviewer calls for the same file into one review
 * record: concat comments, sum token usage, verdict is 'comment' if any
 * reviewer flagged something, fileSummary joins the non-empty summaries.
 * modelUsed/provider are taken from the first result — every reviewer call
 * for a file goes through the same model selection, so they're identical in
 * practice; "first" is just a deterministic pick. overallCorrectness prefers
 * a reviewer that actually flagged something ('comment' verdict) over an
 * approving one, since that's the more actionable ("worst") assessment;
 * confidenceScore takes the lowest (least confident) reported value.
 */
export function aggregateReviewerResults(results: ReviewerCallResult[]): AggregatedReview {
  if (results.length === 0) {
    throw new Error('aggregateReviewerResults requires at least one result');
  }

  const first = results[0];
  const worst = results.find((r) => r.parsed.verdict === 'comment') ?? first;
  const comments = results.flatMap((r) => r.parsed.comments ?? []);
  const verdict = results.some((r) => r.parsed.verdict === 'comment') ? 'comment' : 'approve';
  const fileSummary = results
    .map((r) => r.parsed.fileSummary)
    .filter((s): s is string => Boolean(s && s.trim().length > 0))
    .join(' ') || null;
  const confidenceScores = results
    .map((r) => r.parsed.confidenceScore)
    .filter((v): v is number => typeof v === 'number');

  return {
    comments,
    verdict,
    fileSummary,
    overallCorrectness: worst.parsed.overallCorrectness ?? first.parsed.overallCorrectness ?? null,
    confidenceScore: confidenceScores.length > 0 ? Math.min(...confidenceScores) : null,
    modelUsed: first.modelUsed,
    provider: first.provider,
    rawText: results.map((r) => `[${r.reviewer}]\n${r.rawText}`).join('\n\n---\n\n'),
    inputTokens: results.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0),
    outputTokens: results.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0),
    cacheReadTokens: sumOrNull(results, (r) => r.cacheReadTokens),
    cacheWriteTokens: sumOrNull(results, (r) => r.cacheWriteTokens),
  };
}
