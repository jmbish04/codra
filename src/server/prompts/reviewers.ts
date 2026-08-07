import type { RepoConfig } from '@shared/schema';

export type ReviewerId = 'security' | 'bugs' | 'performance' | 'correctness' | 'quality' | 'docs';

export interface ReviewerDef {
  id: ReviewerId;
  category: 'security' | 'bugs' | 'performance' | 'correctness' | 'quality';
  look_for: string[];
  ignore: string[];
}

export const REVIEWERS: Record<ReviewerId, ReviewerDef> = {
  security: {
    id: 'security', category: 'security',
    look_for: ['injection (SQLi/XSS/command)', 'auth/authz bypass', 'hardcoded secrets/tokens',
      'insecure randomness', 'SSRF', 'unsafe deserialization', 'sensitive data leaks'],
    ignore: ['style/formatting', 'performance micro-optimizations', 'naming', 'missing docs',
      'test coverage — those belong to other reviewers'],
  },
  bugs: {
    id: 'bugs', category: 'bugs',
    look_for: ['logic errors that produce wrong output', 'null/undefined derefs', 'off-by-one',
      'unhandled promise rejections', 'incorrect error handling'],
    ignore: ['security (security reviewer owns it)', 'performance', 'style', 'docs'],
  },
  performance: {
    id: 'performance', category: 'performance',
    look_for: ['N+1 queries', 'O(n^2)+ hot paths', 'unbounded memory growth', 'blocking I/O in loops',
      'missing pagination/limits'],
    ignore: ['correctness bugs', 'security', 'style', 'docs — not your job'],
  },
  correctness: {
    id: 'correctness', category: 'correctness',
    look_for: ['contract/API misuse', 'race conditions', 'incorrect state transitions',
      'data-loss risks', 'broken invariants'],
    ignore: ['security', 'performance', 'style', 'docs'],
  },
  quality: {
    id: 'quality', category: 'quality',
    look_for: ['dead code', 'duplicated logic worth extracting', 'unclear control flow',
      'maintainability hazards'],
    ignore: ['security/perf/correctness (other reviewers own them)', 'pure whitespace/semicolons'],
  },
  docs: {
    id: 'docs', category: 'quality',
    look_for: ['new/modified EXPORTED function/class/method missing a docstring/JSDoc',
      'complex/non-obvious block (bitwise, regex, recursion, state machine) with no explanatory comment'],
    ignore: ['trivial getters/setters/self-documenting one-liners', 'security/perf/correctness',
      'style nits'],
  },
};

/** Byte-stable per reviewer — no per-file interpolation, so the caching
 *  breakpoint on this prompt hits across every file in the job. */
export function buildReviewerSystemPrompt(reviewer: ReviewerDef, config: RepoConfig['review']): string {
  return [
    `You are the ${reviewer.id.toUpperCase()} reviewer in Codra's multi-agent code review.`,
    `Review ONLY through the ${reviewer.id} lens.`,
    '',
    'DO look for:',
    ...reviewer.look_for.map((x) => `- ${x}`),
    '',
    'IGNORE (another reviewer owns these — do not comment on them):',
    ...reviewer.ignore.map((x) => `- ${x}`),
    '',
    `Return at most ${config.max_comments} findings, most severe first, each with title, body (<160 words), and code_location.`,
    `Tag every finding category="${reviewer.category}". If nothing material, return an empty findings array.`,
    'Severity: P0 critical/security or data loss; P1 production bug; P2 perf/maintainability; P3 nit.',
  ].join('\n');
}
