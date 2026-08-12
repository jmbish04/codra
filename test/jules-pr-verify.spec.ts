import { describe, it, expect, beforeEach, vi } from 'vitest';
import { verifyDivertedJulesPr } from '@server/core/jules-pr-verify';
import { stageJulesSession, markJulesLaunched } from '@server/db/jules-sessions';
import { setJulesSessionCreatedPr, listInteractions } from '@server/db/jules-interactions';
import { createTestEnv } from './helpers';

// Stub the Jules SDK outbound so directCorrectionsToJules' send succeeds
// deterministically (no network); everything else is the real code path.
vi.mock('@server/services/jules', async (importActual) => ({
  ...(await importActual<typeof import('@server/services/jules')>()),
  sendJulesMessage: vi.fn(async () => {}),
}));

// a changed .ts file whose exported fn (line 1) lacks a docstring (still a gap)
const GAP_FILE = { path: 'src/a.ts', content: 'export function foo(x) { return x; }\n' };
// same file, now with a docstring (gap closed)
const OK_FILE = { path: 'src/a.ts', content: '/** does foo */\nexport function foo(x) { return x; }\n' };

function fakeGh(files: { path: string; content: string }[]) {
  return {
    // Emit a real unified diff so each content line is an added line (1..N),
    // making the function's declaration line commentable inline.
    getPullRequestDiff: async () => files.map((f) => {
      const lines = f.content.replace(/\n$/, '').split('\n');
      const hunk = lines.map((l) => `+${l}`).join('\n');
      return `diff --git a/${f.path} b/${f.path}\n--- /dev/null\n+++ b/${f.path}\n@@ -0,0 +1,${lines.length} @@\n${hunk}\n`;
    }).join(''),
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

async function correctionCount(env: Env) {
  const rows = await listInteractions(env, { sessionId: 'sess-1', prNumber: 5 });
  return rows.filter((r) => r.kind === 'correction').length;
}

describe('verifyDivertedJulesPr', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv({ JULES_API_KEY: { get: async () => 'K' } } as any); });

  it('passes (no feedback) when the scoped docstrings are now present', async () => {
    const session = await seedSession(env, ['src/a.ts']);
    const gh = fakeGh([OK_FILE]);
    const res = await verifyDivertedJulesPr(env, gh, { session, owner: 'o', repo: 'r', prNumber: 5, headSha: 'sha1' });
    expect(res.verified).toBe(true);
    expect(gh.createReview).not.toHaveBeenCalled();
    expect(gh.createIssueComment).not.toHaveBeenCalled();
    expect(await correctionCount(env)).toBe(0);
  });

  it('does not check files outside the session target_files (no out-of-scope spam)', async () => {
    const session = await seedSession(env, ['src/OTHER.ts']);
    const gh = fakeGh([GAP_FILE]);
    const res = await verifyDivertedJulesPr(env, gh, { session, owner: 'o', repo: 'r', prNumber: 5, headSha: 'sha1' });
    expect(res.verified).toBe(true);
    expect(gh.createReview).not.toHaveBeenCalled();
    expect(await correctionCount(env)).toBe(0);
  });

  it('flags gaps: inline review on the in-diff function line + a Jules correction', async () => {
    const session = await seedSession(env, ['src/a.ts']);
    const gh = fakeGh([GAP_FILE]);
    const res = await verifyDivertedJulesPr(env, gh, { session, owner: 'o', repo: 'r', prNumber: 5, headSha: 'sha1' });
    expect(res.verified).toBe(false);
    expect(res.gaps).toContain('src/a.ts');
    expect(gh.createReview).toHaveBeenCalledTimes(1);
    const reviewInput = gh.createReview.mock.calls[0][3];
    expect(reviewInput.comments).toEqual([
      expect.objectContaining({ path: 'src/a.ts', line: 1, side: 'RIGHT' }),
    ]);
    expect(await correctionCount(env)).toBe(1);
  });

  it('is idempotent — re-running for the same head commit does not re-send', async () => {
    const session = await seedSession(env, ['src/a.ts']);
    const gh = fakeGh([GAP_FILE]);
    const ctx = { session, owner: 'o', repo: 'r', prNumber: 5, headSha: 'sha1' } as const;
    await verifyDivertedJulesPr(env, gh, ctx);
    await verifyDivertedJulesPr(env, gh, ctx);
    expect(gh.createReview).toHaveBeenCalledTimes(1); // second run deduped
    expect(await correctionCount(env)).toBe(1);
  });

  it('quality flag OFF (default): no model call even when docstrings are present', async () => {
    const session = await seedSession(env, ['src/a.ts']);
    const gh = fakeGh([OK_FILE]);
    const model = { callModel: vi.fn(async () => { throw new Error('should not be called'); }) };
    const res = await verifyDivertedJulesPr(env, gh, { session, owner: 'o', repo: 'r', prNumber: 5, headSha: 'sha1' }, model);
    expect(res.verified).toBe(true);
    expect(model.callModel).not.toHaveBeenCalled();
    expect(await correctionCount(env)).toBe(0);
  });

  it('quality flag ON + model returns issues: verified false, one correction recorded', async () => {
    const session = await seedSession(env, ['src/a.ts']);
    const gh = fakeGh([OK_FILE]);
    const model = { callModel: vi.fn(async () => ({ rawText: JSON.stringify({ issues: [{ path: 'src/a.ts', note: 'wrong description' }] }) })) };
    const res = await verifyDivertedJulesPr(env, gh, { session, owner: 'o', repo: 'r', prNumber: 5, headSha: 'sha1', qualityCheckEnabled: true }, model);
    expect(res.verified).toBe(false);
    expect(res.gaps).toEqual(['src/a.ts']);
    expect(await correctionCount(env)).toBe(1);
  });

  it('quality flag ON + model returns empty issues: verified true, no correction', async () => {
    const session = await seedSession(env, ['src/a.ts']);
    const gh = fakeGh([OK_FILE]);
    const model = { callModel: vi.fn(async () => ({ rawText: JSON.stringify({ issues: [] }) })) };
    const res = await verifyDivertedJulesPr(env, gh, { session, owner: 'o', repo: 'r', prNumber: 5, headSha: 'sha1', qualityCheckEnabled: true }, model);
    expect(res.verified).toBe(true);
    expect(await correctionCount(env)).toBe(0);
  });

  it('quality flag ON + model throws: fail-open verified true, no correction', async () => {
    const session = await seedSession(env, ['src/a.ts']);
    const gh = fakeGh([OK_FILE]);
    const model = { callModel: vi.fn(async () => { throw new Error('model unavailable'); }) };
    const res = await verifyDivertedJulesPr(env, gh, { session, owner: 'o', repo: 'r', prNumber: 5, headSha: 'sha1', qualityCheckEnabled: true }, model);
    expect(res.verified).toBe(true);
    expect(await correctionCount(env)).toBe(0);
  });
});
