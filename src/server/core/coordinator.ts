import type { ParsedReviewComment } from '@shared/schema';
import { sanitizeForPrompt } from '@server/core/prompt-safety';
import { logger } from '@server/core/logger';

export type CoordinatorRun = (system: string, user: string) => Promise<{ keep: number[] }>;
export type SourceFetcher = (path: string, line: number | null) => Promise<string | null>;

/** Half-window (lines) fetched on each side of a finding's line for source verification. */
const SOURCE_WINDOW = 20;

/** Cap on distinct source paths fetched per coordinator pass, so finalize's other
 *  GitHub subrequests (createReview, etc.) don't blow the Workers 50-subrequest limit. */
const MAX_SOURCE_FETCHES = 8;

/**
 * Slices `content` to a window of lines centered on `line` (1-based), or the
 * file head when `line` is null. Extracted for isolated unit testing.
 */
export function windowSourceLines(content: string, line: number | null, halfWindow = SOURCE_WINDOW): string {
  const lines = content.split('\n');
  if (line == null) return lines.slice(0, halfWindow * 2).join('\n');
  const start = Math.max(0, line - 1 - halfWindow);
  const end = Math.min(lines.length, line + halfWindow);
  return lines.slice(start, end).join('\n');
}

/**
 * Parses a coordinator model's raw JSON text into `{ keep }`, tolerant of a
 * missing/non-array field. Extracted for isolated unit testing.
 */
export function parseCoordinatorKeep(rawText: string): { keep: number[] } {
  const parsed = JSON.parse(rawText);
  return { keep: Array.isArray(parsed.keep) ? parsed.keep.map(Number) : [] };
}

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
  const sourceCache = new Map<string, string | null>();
  for (let i = 0; i < comments.length; i++) {
    const cm = comments[i];
    if ((cm.confidenceScore ?? 1) < threshold) {
      let src: string | null;
      if (sourceCache.has(cm.path)) {
        src = sourceCache.get(cm.path)!;
      } else {
        if (sourceCache.size >= MAX_SOURCE_FETCHES) continue;
        src = await fetchSource(cm.path, cm.line ?? null);
        sourceCache.set(cm.path, src);
      }
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
