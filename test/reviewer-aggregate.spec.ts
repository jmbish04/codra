import { describe, expect, it } from 'vitest';
import { limitFinalReviewComments } from '@server/core/reviewer-aggregate';
import type { ParsedReviewComment } from '@shared/schema';

const comment = (severity: ParsedReviewComment['severity'], title: string): ParsedReviewComment => ({
  path: 'src/a.ts',
  line: 1,
  position: 1,
  severity,
  category: 'bugs',
  title,
  body: title,
});

describe('limitFinalReviewComments', () => {
  it('omittedCount reflects only max_comments truncation, not min_severity drops', () => {
    const input = [
      comment('P0', 'critical'),
      comment('P1', 'bug'),
      comment('P2', 'perf'),
      comment('P3', 'nit'),
    ];
    const { comments, omittedCount } = limitFinalReviewComments(input, 'P1', 2);
    expect(comments).toHaveLength(2);
    expect(comments.map((c) => c.title)).toEqual(['critical', 'bug']);
    expect(omittedCount).toBe(0);
  });

  it('reports how many severity-qualified comments were cut by max_comments', () => {
    const input = [comment('P0', 'a'), comment('P1', 'b'), comment('P1', 'c')];
    const { comments, omittedCount } = limitFinalReviewComments(input, 'P3', 2);
    expect(comments).toHaveLength(2);
    expect(omittedCount).toBe(1);
  });
});
