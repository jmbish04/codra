import type { ParsedReviewComment } from '@shared/schema';
import { sanitizeForPrompt } from '@server/core/prompt-safety';
import { logger } from '@server/core/logger';

export type CoordinatorRun = (system: string, user: string) => Promise<{ keep: number[] }>;
export type SourceFetcher = (path: string, line: number | null) => Promise<string | null>;

const SYSTEM = [
  'You are the coordinator in Codra multi-agent review.',
  'Given findings from specialized reviewers, decide which to KEEP.',
  'Rules: (1) collapse duplicates addressing the same defect, keep the clearest one;',
  '(2) drop speculative or likely false-positive findings;',
  '(3) drop findings contradicted by the provided source context.',
  'Return the tool result with `keep` = the array of 0-based indices to keep.',
].join('\n');

/** Coordinator pass: dedup + reasonableness + (for low-confidence findings)
 *  source-verification via the injected fetcher. Best-effort: any model error
 *  returns the findings unchanged so a review is never lost. */
export async function coordinateFindings(input: {
  comments: ParsedReviewComment[];
  sharedContext: string;
  runModel: CoordinatorRun;
  fetchSource: SourceFetcher;
  lowConfidence?: number;
}): Promise<ParsedReviewComment[]> {
  const { comments, runModel, fetchSource } = input;
  if (comments.length <= 1) return comments;

  const threshold = input.lowConfidence ?? 0.6;
  const sourceBlocks: string[] = [];
  for (let i = 0; i < comments.length; i++) {
    const cm = comments[i];
    if ((cm.confidenceScore ?? 1) < threshold) {
      const src = await fetchSource(cm.path, cm.line ?? null);
      if (src) sourceBlocks.push(`[#${i} ${cm.path}:${cm.line}]\n${sanitizeForPrompt(src)}`);
    }
  }

  const user = [
    sanitizeForPrompt(input.sharedContext),
    'FINDINGS:',
    ...comments.map((cm, i) => `#${i} (${cm.severity}/${cm.category}) ${sanitizeForPrompt(cm.title)} — ${sanitizeForPrompt(cm.body)} @ ${cm.path}:${cm.line}`),
    sourceBlocks.length ? `SOURCE FOR LOW-CONFIDENCE FINDINGS:\n${sourceBlocks.join('\n\n')}` : '',
  ].filter(Boolean).join('\n');

  try {
    const { keep } = await runModel(SYSTEM, user);
    const keepSet = new Set(keep);
    const filtered = comments.filter((_, i) => keepSet.has(i));
    return filtered.length ? filtered : comments; // never nuke everything on a bad response
  } catch (err) {
    logger.error('Coordinator pass failed; passing findings through un-coordinated', err);
    return comments;
  }
}
