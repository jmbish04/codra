import type { ParsedReviewComment } from '@shared/schema';

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
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/**
 * Combines N specialized-reviewer calls for the same file into one review
 * record: concat comments, sum token usage, verdict is 'comment' if any
 * reviewer flagged something, fileSummary joins the non-empty summaries.
 * modelUsed/provider are taken from the first result — every reviewer call
 * for a file goes through the same model selection, so they're identical in
 * practice; "first" is just a deterministic pick.
 */
export function aggregateReviewerResults(results: ReviewerCallResult[]): AggregatedReview {
  if (results.length === 0) {
    throw new Error('aggregateReviewerResults requires at least one result');
  }

  const first = results[0];
  const comments = results.flatMap((r) => r.parsed.comments ?? []);
  const verdict = results.some((r) => r.parsed.verdict === 'comment') ? 'comment' : 'approve';
  const fileSummary = results
    .map((r) => r.parsed.fileSummary)
    .filter((s): s is string => Boolean(s && s.trim().length > 0))
    .join(' ') || null;

  return {
    comments,
    verdict,
    fileSummary,
    overallCorrectness: first.parsed.overallCorrectness ?? null,
    confidenceScore: first.parsed.confidenceScore ?? null,
    modelUsed: first.modelUsed,
    provider: first.provider,
    rawText: results.map((r) => `[${r.reviewer}]\n${r.rawText}`).join('\n\n---\n\n'),
    inputTokens: results.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0),
    outputTokens: results.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0),
    cacheReadTokens: results.reduce((sum, r) => sum + (r.cacheReadTokens ?? 0), 0),
    cacheWriteTokens: results.reduce((sum, r) => sum + (r.cacheWriteTokens ?? 0), 0),
  };
}
