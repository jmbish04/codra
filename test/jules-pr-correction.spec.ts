import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildCorrectionInstruction, directCorrectionsToJules } from '@server/core/jules-pr-correction';
import { createTestEnv } from './helpers';

describe('jules-pr-correction', () => {
  it('builds an actionable instruction from findings (capped at 30)', () => {
    const comments = Array.from({ length: 35 }, (_, i) => ({ path: `f${i}.ts`, line: i, severity: 'P2', title: `issue ${i}`, body: 'do the fix' }));
    const text = buildCorrectionInstruction(42, comments);
    expect(text).toContain('#42');
    expect(text).toContain('f0.ts:0 — [P2] issue 0: do the fix');
    expect(text).toContain('+5 more');
  });

  it('no-ops when the PR is not linked to any Jules session', async () => {
    const env = createTestEnv();
    const github = { createIssueComment: vi.fn(async () => ({})) };
    const res = await directCorrectionsToJules(env, github, {
      owner: 'o', repo: 'r', prNumber: 99, comments: [{ path: 'a.ts', title: 'x' }],
    });
    expect(res).toEqual({ sent: false });
    expect(github.createIssueComment).not.toHaveBeenCalled();
  });
});
