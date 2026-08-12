import { describe, it, expect, beforeEach, vi } from 'vitest';
import { verifyDivertedJulesPr } from '@server/core/jules-pr-verify';
import { stageJulesSession, markJulesLaunched } from '@server/db/jules-sessions';
import { setJulesSessionCreatedPr } from '@server/db/jules-interactions';
import { createTestEnv } from './helpers';

// a changed .ts file whose exported fn lacks a docstring (still a gap)
const GAP_FILE = { path: 'src/a.ts', content: 'export function foo(x) { return x; }\n' };
// same file, now with a docstring (gap closed)
const OK_FILE = { path: 'src/a.ts', content: '/** does foo */\nexport function foo(x) { return x; }\n' };

function fakeGh(files: { path: string; content: string }[]) {
  return {
    getPullRequestDiff: async () => files.map((f) => `diff --git a/${f.path} b/${f.path}\n+++ b/${f.path}\n`).join(''),
    getRepoFileWithRefOrNull: async (_o: string, _r: string, p: string) => {
      const f = files.find((x) => x.path === p);
      return f ? { content: f.content } : null;
    },
    createReview: vi.fn(async () => ({})),
    createIssueComment: vi.fn(async () => ({ id: 1 })),
  } as any;
}

async function seedSession(env: Env, targetFiles: string[]) {
  const s = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'p', gapSummary: 'g', targetFiles });
  await markJulesLaunched(env, s.id, { sessionId: 'sess-1', sessionUrl: 'u', sessionState: 'IN_PROGRESS' });
  await setJulesSessionCreatedPr(env, 'sess-1', { number: 5, url: 'https://github.com/o/r/pull/5' });
  return { ...s, session_id: 'sess-1', created_pr_number: 5, category: 'INTERNAL_CODRA', target_files: targetFiles } as any;
}

describe('verifyDivertedJulesPr', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('passes (no feedback) when the scoped docstrings are now present', async () => {
    const session = await seedSession(env, ['src/a.ts']);
    const gh = fakeGh([OK_FILE]);
    const res = await verifyDivertedJulesPr(env, gh, { session, owner: 'o', repo: 'r', prNumber: 5, headSha: 'sha' });
    expect(res.verified).toBe(true);
    expect(gh.createReview).not.toHaveBeenCalled();
  });

  it('flags gaps and posts feedback when a scoped file still lacks docstrings', async () => {
    const session = await seedSession(env, ['src/a.ts']);
    const gh = fakeGh([GAP_FILE]);
    const res = await verifyDivertedJulesPr(env, gh, { session, owner: 'o', repo: 'r', prNumber: 5, headSha: 'sha' });
    expect(res.verified).toBe(false);
    expect(res.gaps).toContain('src/a.ts');
    expect(gh.createReview).toHaveBeenCalled();
  });
});
