# Jules PR Recognition & Cat-3 Divert (P1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognize a Jules-authored PR at webhook time, link it to its originating `jules_sessions` row (set `created_pr_number` immediately), and divert Codra's own docs PRs out of the standard paid AI review.

**Architecture:** A pure `detectJulesTaskId` parses the task id from the PR body/branch. A `classifyAndLinkJulesPr` orchestrator matches that id to a `jules_sessions` row by `session_id`, and for a Codra (`INTERNAL_CODRA`) match sets `created_pr_number`/`created_pr_url` and signals divert. The `pull_request` webhook branch calls it before `extractReviewRequest` and returns early when diverted. Deterministic, no AI cost, no new webhook events.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, Drizzle ORM + D1, vitest with the in-memory `node:sqlite` D1 shim.

## Global Constraints

- Jules opens PRs **as the authenticating user** (`is_bot: false`), not `google-labs-jules[bot]`. Detect by **content** (body/branch), never by author. Verified against a real PR: body contains `PR created automatically by Jules for task [<id>](https://jules.google.com/task/<id>)`; branch is `jules-docs-gaps-<id>` (starts `jules-`, ends `-<id>`); body and branch share the same trailing integer id.
- The `taskId == jules_sessions.session_id` join is **not verifiable offline**. The matcher MUST be tolerant: on any miss or malformed id, log and fall through (treat as non-Codra) — never throw, never block the webhook, never divert.
- Only **Codra** rows (`category === 'INTERNAL_CODRA'`) are diverted. A non-match is left entirely to the existing flow (external-PR routing is P2, not this slice).
- No new webhook events, no GitHub CI reads, no config changes in this slice.
- Idempotent: re-delivery of the same PR event must divert again cleanly and must not error (the row already has `created_pr_number` set).
- Tests use `createTestEnv()` from `test/helpers.ts` (in-memory D1, all `db/migrations/d1/*.sql` applied in `beforeEach`). Spell "jules" never "julius". Verify with `npx tsc --noEmit` + focused `npx vitest`; the repo's app-import specs are flaky, so also confirm `npm run build`.

## File Structure

- **Create** `src/server/core/jules-pr.ts` — `detectJulesTaskId` (pure) + `classifyAndLinkJulesPr` (orchestrator).
- **Modify** `src/server/db/jules-sessions.ts` — add `findJulesSessionBySessionId`.
- **Modify** `src/server/routes/webhook.ts` — call the orchestrator in the `pull_request` branch, return early on divert.
- **Create** `test/jules-pr-recognition.spec.ts` — tests for detection, the query, and the orchestrator.

---

### Task 1: `detectJulesTaskId` — parse the task id from a PR body/branch

**Files:**
- Create: `src/server/core/jules-pr.ts`
- Test: `test/jules-pr-recognition.spec.ts`

**Interfaces:**
- Produces: `detectJulesTaskId(pr: { body: string | null; headRef: string }): string | null` — the trailing-digits task id, or null if the PR isn't a Jules PR.

- [ ] **Step 1: Write the failing test**

Create `test/jules-pr-recognition.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectJulesTaskId } from '@server/core/jules-pr';

describe('detectJulesTaskId', () => {
  it('extracts the id from the Jules PR body', () => {
    const body = 'Closes gaps.\n\n---\n*PR created automatically by Jules for task [6837743215401320221](https://jules.google.com/task/6837743215401320221) started by @jmbish04*';
    expect(detectJulesTaskId({ body, headRef: 'whatever' })).toBe('6837743215401320221');
  });

  it('falls back to the branch name when the body has no marker', () => {
    expect(detectJulesTaskId({ body: 'manual PR', headRef: 'jules-docs-gaps-6837743215401320221' })).toBe('6837743215401320221');
  });

  it('returns null for a non-Jules PR', () => {
    expect(detectJulesTaskId({ body: 'a normal PR', headRef: 'feature/foo' })).toBeNull();
    expect(detectJulesTaskId({ body: null, headRef: 'main' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/jules-pr-recognition.spec.ts`
Expected: FAIL — `detectJulesTaskId` not exported / module missing.

- [ ] **Step 3: Implement the helper**

Create `src/server/core/jules-pr.ts`:

```ts
import { getDb } from '@server/db/client';
import { findJulesSessionBySessionId } from '@server/db/jules-sessions';
import { setJulesSessionCreatedPr } from '@server/db/jules-interactions';
import { logger } from '@server/core/logger';

/**
 * The Jules task id for a PR Jules opened, or null if this isn't a Jules PR.
 * Jules opens PRs as the authenticating user (not a bot), so we detect by
 * content: the body marker `jules.google.com/task/<id>`, falling back to the
 * `jules-…-<id>` branch name. Body and branch share the same trailing integer.
 */
export function detectJulesTaskId(pr: { body: string | null; headRef: string }): string | null {
  const fromBody = pr.body?.match(/jules\.google\.com\/task\/(\d+)/);
  if (fromBody) return fromBody[1];
  const fromBranch = pr.headRef?.match(/^jules-.*?-(\d+)$/);
  if (fromBranch) return fromBranch[1];
  return null;
}
```

(`getDb`, `findJulesSessionBySessionId`, `setJulesSessionCreatedPr`, `logger` are imported now for Task 3 — leaving them unused for one step is fine; Task 3 adds the function that uses them.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/jules-pr-recognition.spec.ts`
Expected: PASS (3 cases). If tsc complains about unused imports, comment says they're for Task 3 — or add Task 3 in the same session before committing.

- [ ] **Step 5: Commit**

```bash
git add src/server/core/jules-pr.ts test/jules-pr-recognition.spec.ts
git commit -m "feat(jules): detect a Jules PR's task id from body/branch"
```

---

### Task 2: `findJulesSessionBySessionId` query

**Files:**
- Modify: `src/server/db/jules-sessions.ts` (add near `getJulesSessionById`)
- Test: `test/jules-pr-recognition.spec.ts`

**Interfaces:**
- Produces: `findJulesSessionBySessionId(env: Pick<Env,'DB'>, sessionId: string): Promise<JulesSessionRow | null>`.
- Consumes: `julesSessions`, `getDb`, `eq` (already imported in the file).

- [ ] **Step 1: Write the failing test**

Append to `test/jules-pr-recognition.spec.ts`:

```ts
import { stageJulesSession, markJulesLaunched, findJulesSessionBySessionId } from '@server/db/jules-sessions';
import { createTestEnv } from './helpers';

describe('findJulesSessionBySessionId', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('finds a launched session by its session_id, else null', async () => {
    const s = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'p', gapSummary: 'g' });
    await markJulesLaunched(env, s.id, { sessionId: 'sess-123', sessionUrl: 'u', sessionState: 'IN_PROGRESS' });
    const found = await findJulesSessionBySessionId(env, 'sess-123');
    expect(found?.session_id).toBe('sess-123');
    expect(found?.category).toBe('INTERNAL_CODRA');
    expect(await findJulesSessionBySessionId(env, 'nope')).toBeNull();
  });
});
```

Add `beforeEach` to the vitest import at the top of the file if not already imported.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/jules-pr-recognition.spec.ts -t "findJulesSessionBySessionId"`
Expected: FAIL — function not exported.

- [ ] **Step 3: Implement**

In `src/server/db/jules-sessions.ts`, after `getJulesSessionById`, add:

```ts
/** Fetch a session row by the Jules session id it was assigned at launch. */
export async function findJulesSessionBySessionId(
  env: Pick<Env, 'DB'>, sessionId: string,
): Promise<JulesSessionRow | null> {
  const db = getDb(env);
  const row = await db.select().from(julesSessions).where(eq(julesSessions.session_id, sessionId)).get();
  return row ?? null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/jules-pr-recognition.spec.ts -t "findJulesSessionBySessionId"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/jules-sessions.ts test/jules-pr-recognition.spec.ts
git commit -m "feat(jules): add findJulesSessionBySessionId query"
```

---

### Task 3: `classifyAndLinkJulesPr` orchestrator (match + link + divert decision)

**Files:**
- Modify: `src/server/core/jules-pr.ts`
- Test: `test/jules-pr-recognition.spec.ts`

**Interfaces:**
- Produces: `classifyAndLinkJulesPr(env, pr): Promise<{ diverted: boolean }>` where `pr = { owner: string; repo: string; prNumber: number; prUrl: string; body: string | null; headRef: string }`.
- Consumes: `detectJulesTaskId` (Task 1), `findJulesSessionBySessionId` (Task 2), `setJulesSessionCreatedPr` (existing, `src/server/db/jules-interactions.ts`).

- [ ] **Step 1: Write the failing test**

Append to `test/jules-pr-recognition.spec.ts`:

```ts
import { classifyAndLinkJulesPr } from '@server/core/jules-pr';
import { getJulesSessionById } from '@server/db/jules-sessions';

describe('classifyAndLinkJulesPr', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('links a Codra Jules PR and signals divert', async () => {
    const s = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'p', gapSummary: 'g' });
    await markJulesLaunched(env, s.id, { sessionId: 'sess-777', sessionUrl: 'u', sessionState: 'IN_PROGRESS' });

    const res = await classifyAndLinkJulesPr(env, {
      owner: 'o', repo: 'r', prNumber: 42, prUrl: 'https://github.com/o/r/pull/42',
      body: 'x https://jules.google.com/task/sess-777 y', headRef: 'jules-docs-gaps-sess-777',
    });

    expect(res.diverted).toBe(true);
    const after = await getJulesSessionById(env, s.id);
    expect(after?.created_pr_number).toBe(42);
    expect(after?.created_pr_url).toBe('https://github.com/o/r/pull/42');
  });

  it('does not divert a non-Jules PR', async () => {
    const res = await classifyAndLinkJulesPr(env, {
      owner: 'o', repo: 'r', prNumber: 5, prUrl: 'u', body: 'normal', headRef: 'feature/x',
    });
    expect(res.diverted).toBe(false);
  });

  it('does not divert when the task id matches no Codra session (external)', async () => {
    const res = await classifyAndLinkJulesPr(env, {
      owner: 'o', repo: 'r', prNumber: 6, prUrl: 'u',
      body: 'https://jules.google.com/task/unknown-999', headRef: 'jules-x-unknown-999',
    });
    expect(res.diverted).toBe(false);
  });
});
```

Note: the test uses non-numeric ids like `sess-777` in the body to match the stored `session_id`. Update `detectJulesTaskId` if needed to accept the stored id form — see Step 3.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/jules-pr-recognition.spec.ts -t "classifyAndLinkJulesPr"`
Expected: FAIL — function not exported.

- [ ] **Step 3: Implement**

The detector's regex currently captures digits only (`\d+`), but real Jules ids may not be purely numeric and the tests store `sess-777`. Widen the capture to the id token and keep it tolerant. Update `detectJulesTaskId` in `src/server/core/jules-pr.ts`:

```ts
export function detectJulesTaskId(pr: { body: string | null; headRef: string }): string | null {
  const fromBody = pr.body?.match(/jules\.google\.com\/task\/([\w-]+)/);
  if (fromBody) return fromBody[1];
  const fromBranch = pr.headRef?.match(/^jules-.*?-([\w-]+)$/);
  if (fromBranch) return fromBranch[1];
  return null;
}
```

Then add the orchestrator to the same file:

```ts
/**
 * Recognize a Jules PR and, when it is one of Codra's own launched sessions,
 * link the PR to that session and signal that the standard review should be
 * skipped. Tolerant: any parse/lookup miss returns { diverted: false } and the
 * caller falls through to the normal flow. External (non-Codra) Jules PRs are
 * left to P2 — they are not diverted here.
 */
export async function classifyAndLinkJulesPr(
  env: Pick<Env, 'DB'>,
  pr: { owner: string; repo: string; prNumber: number; prUrl: string; body: string | null; headRef: string },
): Promise<{ diverted: boolean }> {
  try {
    const taskId = detectJulesTaskId({ body: pr.body, headRef: pr.headRef });
    if (!taskId) return { diverted: false };

    const session = await findJulesSessionBySessionId(env, taskId);
    if (!session || session.category !== 'INTERNAL_CODRA') {
      // A Jules PR we can't tie to one of our sessions — log for the id-join
      // verification and leave it to the normal flow / P2.
      logger.info('jules pr not linked to a codra session', { owner: pr.owner, repo: pr.repo, prNumber: pr.prNumber, taskId, matched: Boolean(session) });
      return { diverted: false };
    }

    await setJulesSessionCreatedPr(env, taskId, { number: pr.prNumber, url: pr.prUrl });
    logger.info('diverted codra jules pr from standard review', { owner: pr.owner, repo: pr.repo, prNumber: pr.prNumber, taskId });
    return { diverted: true };
  } catch (err) {
    logger.warn('classifyAndLinkJulesPr failed; not diverting', { error: err instanceof Error ? err.message : String(err) });
    return { diverted: false };
  }
}
```

(Remove the `getDb` import from Task 1 if it ended up unused — this file uses the db helpers, not `getDb` directly.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/jules-pr-recognition.spec.ts`
Expected: PASS (all describes). Then `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/core/jules-pr.ts test/jules-pr-recognition.spec.ts
git commit -m "feat(jules): classifyAndLinkJulesPr — link Codra Jules PRs and divert from review"
```

---

### Task 4: Wire the divert into the `pull_request` webhook branch

**Files:**
- Modify: `src/server/routes/webhook.ts` (inside the `if (eventName === 'pull_request')` block, after the `closed` handler, before `loadRepoConfig` at ~196)
- Test: covered by Task 3's orchestrator tests; add a manual-verification note (webhook handler integration tests are heavy in this repo).

**Interfaces:**
- Consumes: `classifyAndLinkJulesPr` (Task 3). `prUrl` and `prPayload` are already in scope in that block.

- [ ] **Step 1: Add the divert block**

In `src/server/routes/webhook.ts`, inside `if (eventName === 'pull_request') { ... }`, immediately AFTER the `if (prPayload.action === 'closed') { … return finish(...); }` block closes and BEFORE the block's closing brace, add:

```ts
        // Jules opens PRs as the authenticating user (not a bot), so the isBotSender
        // gate does not catch them. Recognize Codra's own Jules docs PRs and divert
        // them out of the paid standard review; link the PR to its session.
        if (prPayload.action !== 'closed') {
          const { classifyAndLinkJulesPr } = await import('@server/core/jules-pr');
          const link = await classifyAndLinkJulesPr(c.env, {
            owner: payload.repository.owner.login,
            repo: payload.repository.name,
            prNumber: prPayload.pull_request.number,
            prUrl,
            body: prPayload.pull_request.body,
            headRef: prPayload.pull_request.head?.ref ?? '',
          }).catch(() => ({ diverted: false }));
          if (link.diverted) {
            return finish(
              202,
              { ok: true, message: 'jules_pr_diverted' },
              'jules_pr_diverted',
              { prNumber: prPayload.pull_request.number },
            );
          }
        }
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit` (clean) and `npm run build` (exit 0). Confirm `finish`, `prUrl`, and `prPayload.pull_request.head` resolve (the `closed` branch already reads `head?.ref`, so the type carries it).

- [ ] **Step 3: Run the full focused + related suites**

Run: `npx vitest run test/jules-pr-recognition.spec.ts` (green) and `npx vitest run` (only the pre-existing-unrelated failures, if any, may show — no NEW failures).

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/webhook.ts
git commit -m "feat(jules): divert recognized Codra Jules PRs from standard review in the webhook"
```

- [ ] **Step 5: Manual verification note (record in the PR)**

The `taskId == session_id` join is unverified offline. After deploy, on the next real launched Jules PR, check the logs for `diverted codra jules pr from standard review` (matched) vs `jules pr not linked to a codra session` (miss). If misses show a real Codra PR, the id forms differ and `detectJulesTaskId`/the match key need adjusting — the tolerant design means the only symptom is "not diverted" (falls back to today's behavior), never a crash.

---

## Self-review notes (author)

- **Spec coverage (P1):** detection by content → Task 1; match-by-session-id → Task 2; link + divert-decision (tolerant, Codra-only) → Task 3; webhook divert before `extractReviewRequest` → Task 4. External-PR routing (`EXTERNAL_*`, CI signal) is explicitly **P2**, not here.
- **Divert placement:** inside the existing `pull_request` block, after the `closed` early-return, before `loadRepoConfig`/`extractReviewRequest` — so a diverted PR never reaches job creation. Non-diverted PRs fall through unchanged.
- **Tolerance:** every failure path in `classifyAndLinkJulesPr` returns `{ diverted: false }`; the webhook also `.catch(() => ({ diverted: false }))`. A recognition bug can only ever cost a divert (fall back to today's behavior), never a crash or a blocked webhook.
- **Type consistency:** `detectJulesTaskId`, `findJulesSessionBySessionId`, `classifyAndLinkJulesPr`, and the `{ diverted }` shape are named identically across their definitions and call sites above.
