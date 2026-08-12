# Cat-3 Jules PR Verification & Feedback (P4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:** When a Codra-created docs PR is recognized (Cat-3) and diverted from standard review, verify Jules actually filled the docstrings Codra scoped, and on gaps push feedback to the PR (comment + inline suggestions) and to the Jules session (SDK follow-up).

**Architecture:** Reuse, don't rebuild. The `'diverted'` webhook branch fires a `waitUntil(verifyDivertedJulesPr(...))`. That fn re-runs the existing deterministic docstring analysis on the PR's changed files, scoped to the session's `target_files`; if gaps remain it calls the existing `directCorrectionsToJules` (SDK `correction` + PR comment) plus a `createReview` inline pass. No LLM call in v1 — the deterministic re-check is the verdict (LLM refinement is a fast-follow).

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, Drizzle + D1, vitest node:sqlite shim.

## Global Constraints

- **Reuse existing pieces** (do not reimplement): `directCorrectionsToJules` + `buildCorrectionInstruction` (`core/jules-pr-correction.ts`), `analyzeChangedFiles` + `DocstringAnalysisResult` (`core/docstrings.ts`), `getChangedFileContents` (`core/jules-docs-gap.ts`, currently private — export it), `createReview` + `GitHubReviewComment` (`core/github.ts`).
- Fire-and-forget via `c.executionCtx.waitUntil(...)` from the webhook (same pattern as `launchStagedJulesSessions` at `webhook.ts:244`). No REVIEW_QUEUE message type. Never throw out of the webhook — the whole verify is `.catch()`-wrapped.
- Verification is **deterministic** in v1: re-run `analyzeChangedFiles`, scope to `session.target_files`. Pass = the previously-missing docstrings are now present. No LLM call in v1.
- Scope feedback to `session.target_files` only — never comment on files outside the task.
- Idempotency: a re-delivered `opened`/`synchronize` for the same diverted PR may re-run verify; posting a duplicate correction is low-harm, but guard where cheap (e.g. skip if verification passes; the interaction log records sends).
- Tests: `createTestEnv()`, inject fakes for `gh` + the model/SDK. Spell "jules". Verify `tsc --noEmit` + `npm run build` (app-import specs quarantined).

## File Structure

- **Modify** `src/server/core/jules-pr.ts` — `classifyAndLinkJulesPr` returns the matched session on divert.
- **Modify** `src/server/core/jules-docs-gap.ts` — `export` `getChangedFileContents`.
- **Create** `src/server/core/jules-pr-verify.ts` — `verifyDivertedJulesPr`.
- **Modify** `src/server/routes/webhook.ts` — `waitUntil(verifyDivertedJulesPr(...))` in the `'diverted'` branch.
- **Create** `test/jules-pr-verify.spec.ts`.

---

### Task 1: Return the matched session from `classifyAndLinkJulesPr`

**Files:** Modify `src/server/core/jules-pr.ts`; Test `test/jules-pr-recognition.spec.ts` (update existing).

**Interfaces:** `ClassifyJulesPrResult` diverted variant becomes `{ kind: 'diverted'; session: JulesSessionRow }`.

- [ ] **Step 1:** Change the type (`jules-pr.ts:8-11`):
```ts
import type { JulesSessionRow } from '@server/db/jules-sessions';
export type ClassifyJulesPrResult =
  | { kind: 'diverted'; session: JulesSessionRow }
  | { kind: 'external'; taskId: string }
  | { kind: 'none' };
```
- [ ] **Step 2:** In `classifyAndLinkJulesPr`, change the divert return (the `return { kind: 'diverted' }` line) to `return { kind: 'diverted', session };` (the `session` row is already in scope from `findJulesSessionBySessionId`).
- [ ] **Step 3:** Update the existing test in `test/jules-pr-recognition.spec.ts` that asserts `res.kind === 'diverted'` — also assert `res.kind === 'diverted' && res.session.session_id === '6837743215401320221'`.
- [ ] **Step 4:** Run `npx vitest run test/jules-pr-recognition.spec.ts` + `npx tsc --noEmit`. The webhook call site (`webhook.ts:270`) already only reads `link.kind`, so it still compiles.
- [ ] **Step 5:** Commit: `feat(jules): return matched session from classifyAndLinkJulesPr for P4 verification`.

---

### Task 2: Export `getChangedFileContents`

**Files:** Modify `src/server/core/jules-docs-gap.ts`.

- [ ] **Step 1:** Add `export` to the `getChangedFileContents` declaration (`jules-docs-gap.ts:49`). Also export the `DocsGapGithub` type it needs for its `github` param if not already exported (so the verify module can type the gh arg).
- [ ] **Step 2:** `npx tsc --noEmit` clean (pure visibility change).
- [ ] **Step 3:** Commit: `refactor(jules): export getChangedFileContents for reuse in P4`.

---

### Task 3: `verifyDivertedJulesPr` — deterministic verify + feedback

**Files:** Create `src/server/core/jules-pr-verify.ts`; Test `test/jules-pr-verify.spec.ts`.

**Interfaces:**
- Produces `verifyDivertedJulesPr(env, gh, input): Promise<{ verified: boolean; gaps: string[] }>` where `input = { session: JulesSessionRow; owner: string; repo: string; prNumber: number; headSha: string }`.
- Consumes `getChangedFileContents` (Task 2), `analyzeChangedFiles` (`core/docstrings.ts`), `directCorrectionsToJules` (`core/jules-pr-correction.ts`), `gh.createReview` (`core/github.ts`).

- [ ] **Step 1: Write the failing test** (`test/jules-pr-verify.spec.ts`):
```ts
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
```

- [ ] **Step 2:** Run — FAIL (module missing).

- [ ] **Step 3: Implement** `src/server/core/jules-pr-verify.ts`:
```ts
import type { JulesSessionRow } from '@server/db/jules-sessions';
import { getChangedFileContents, type DocsGapGithub } from '@server/core/jules-docs-gap';
import { analyzeChangedFiles } from '@server/core/docstrings';
import { directCorrectionsToJules } from '@server/core/jules-pr-correction';
import { logger } from '@server/core/logger';
import type { GitHubReviewComment } from '@server/core/github';

type VerifyGithub = DocsGapGithub & {
  createReview(owner: string, repo: string, pull: number, input: { commitSha: string; event: 'COMMENT'; body: string; comments: GitHubReviewComment[] }): Promise<unknown>;
  createIssueComment(owner: string, repo: string, issue: number, body: string): Promise<{ id: number }>;
};

/**
 * Verify a diverted Codra docs PR: re-run the docstring analysis on the PR's
 * changed files, scoped to the session's target files. If any scoped file still
 * has missing docstrings, Jules did not finish — push inline suggestions to the
 * PR and a correction to the Jules session. Deterministic; no LLM in v1.
 * Best-effort: never throws.
 */
export async function verifyDivertedJulesPr(
  env: Env,
  gh: VerifyGithub,
  input: { session: JulesSessionRow; owner: string; repo: string; prNumber: number; headSha: string },
): Promise<{ verified: boolean; gaps: string[] }> {
  try {
    const scoped = new Set(input.session.target_files ?? []);
    const files = await getChangedFileContents(gh, input.owner, input.repo, input.prNumber, input.headSha);
    const relevant = scoped.size ? files.filter((f) => scoped.has(f.path)) : files;
    const results = analyzeChangedFiles(relevant).filter((r) => r.functionsMissingDocstrings.length > 0);

    if (results.length === 0) {
      logger.info('jules pr verification passed', { owner: input.owner, repo: input.repo, prNumber: input.prNumber });
      return { verified: true, gaps: [] };
    }

    const comments: GitHubReviewComment[] = results.map((r) => ({
      path: r.fileName,
      body: `Codra tasked Jules to add docstrings here, but these still have none: ${r.functionsMissingDocstrings.join(', ')}. Please add them.`,
    }));
    await gh.createReview(input.owner, input.repo, input.prNumber, {
      commitSha: input.headSha, event: 'COMMENT',
      body: 'Codra verification found unfinished docstrings from the assigned Jules task.',
      comments,
    }).catch((err) => logger.warn('verify createReview failed', { error: err instanceof Error ? err.message : String(err) }));

    // SDK follow-up + PR conversation comment (existing composed helper).
    await directCorrectionsToJules(env, gh, {
      owner: input.owner, repo: input.repo, prNumber: input.prNumber,
      comments: results.map((r) => ({ path: r.fileName, title: 'Missing docstrings', body: `Add docstrings to: ${r.functionsMissingDocstrings.join(', ')}` })),
    }).catch((err) => logger.warn('verify directCorrectionsToJules failed', { error: err instanceof Error ? err.message : String(err) }));

    return { verified: false, gaps: results.map((r) => r.fileName) };
  } catch (err) {
    logger.warn('verifyDivertedJulesPr failed', { error: err instanceof Error ? err.message : String(err) });
    return { verified: false, gaps: [] };
  }
}
```
(Adjust the `directCorrectionsToJules` call to its real signature — confirm `CorrectionComment` fields `{ path; line?; severity?; title?; body? }` and the `input` shape from `jules-pr-correction.ts`.)

- [ ] **Step 4:** Run `npx vitest run test/jules-pr-verify.spec.ts` — PASS both. `npx tsc --noEmit` clean.
- [ ] **Step 5:** Commit: `feat(jules): verifyDivertedJulesPr — deterministic Cat-3 docstring verification + feedback`.

---

### Task 4: Wire the verify into the divert branch

**Files:** Modify `src/server/routes/webhook.ts`.

- [ ] **Step 1:** In the `if (link.kind === 'diverted')` branch (`webhook.ts:270`), before `return finish(...)`, add:
```ts
          const gh = new GitHubClient(c.env, installationId);
          const { verifyDivertedJulesPr } = await import('@server/core/jules-pr-verify');
          c.executionCtx.waitUntil(
            verifyDivertedJulesPr(c.env, gh, {
              session: link.session,
              owner: payload.repository.owner.login,
              repo: payload.repository.name,
              prNumber: prPayload.pull_request.number,
              headSha: prPayload.pull_request.head.sha,
            }).catch((err) => console.error('Jules PR verification failed:', err)),
          );
```
Keep the existing `return finish(202, ..., 'jules_pr_diverted', ...)`.
- [ ] **Step 2:** `npx tsc --noEmit` clean; `npm run build` exit 0; `npx vitest run` no new failures.
- [ ] **Step 3:** Commit: `feat(jules): run Cat-3 verification on diverted Jules PRs (P4 wiring)`.

## Self-review notes
- Deterministic-only v1 (no LLM): the docstring re-check answers "did Jules add the scoped docstrings" — the concrete Cat-3 completion question. LLM quality-judgement is a fast-follow.
- Reuses `directCorrectionsToJules` (which resolves the session via `resolveSessionForPr` — now populated because P1 set `created_pr_number` at divert time; nice synergy) + adds inline `createReview`.
- Never throws (outer try/catch + per-call `.catch`), runs in `waitUntil` — verification failure never affects the webhook 202.
- Scoped to `session.target_files` — no comments outside the assigned task.
