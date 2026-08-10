# Best-Practice Checks + Cloudflare-Docs Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evaluate best practices as per-file pass/violation checks scoped to a PR's changed files, surface the results in `/reviews/:id.json`, attach a static Cloudflare-docs snapshot per violated practice, and expose `search_cloudflare_docs` as an MCP tool coding agents can call directly.

**Architecture:** Layer three phases onto the live queue/DB review pipeline (`runReviewJob` → `runReviewPhase`, `src/server/core/review.ts`): (1) reuse keyword triage to assign per-file best-practice checklists; (2) the existing per-file review reports structured `bestPracticeChecks`; (3) a deterministic aggregation pass collates violations and fetches CF docs (token-free) before the review is finalized. All output is additive JSON. The agentic RepoAgent/ReviewAgent path is not touched.

**Tech Stack:** Cloudflare Workers, Hono, Drizzle ORM + D1, Zod, vitest (D1-only node:sqlite shim), MCP (`@modelcontextprotocol/sdk` via `McpAgent`).

## Global Constraints

- CF-docs querying is token-free: plain `fetch`, never an AI call. Best-effort — never throws, never blocks/fails a review; a miss yields `content: ''`.
- Only best practices with `infra_id === 'cloudflare-workers'` query Cloudflare docs.
- All JSON payload changes are ADDITIVE — never remove or rename existing `/reviews/:id.json` keys (`files`, `suggestions`, etc.).
- New DB columns are nullable JSON(TEXT); absent = feature produced nothing (backward compatible).
- D1 has a 100-bound-parameter cap; keep any bulk insert chunked + `db.batch()` (already the codebase rule — `bp-d1-batch-chunking`).
- Tests are D1-only via `test/d1-sqlite.ts` + `createTestEnv` (`test/helpers.ts`). Trusted verification gate: `npm run typecheck` + `npm run build` (app-import specs are flaky).
- Commit after each task. Branch: current worktree branch (off main).

---

### Task 1: Token-free CF-docs utility wrapper + `search_cloudflare_docs` MCP tool

**Files:**
- Modify: `src/server/services/cloudflare-docs.ts` (add wrapper + type)
- Modify: `src/server/agents/orchestrator.ts:63` (register tool inside `GitHubLikeMCP.init`)
- Test: `test/cloudflare-docs.spec.ts` (exists — append)

**Interfaces:**
- Produces: `type CloudflareDocResult = { query: string; source: 'cloudflare-docs'; content: string }` and `async function fetchCloudflareDocResult(query: string): Promise<CloudflareDocResult>` (exported from `src/server/services/cloudflare-docs.ts`). Later tasks call `fetchCloudflareDocResult`.

- [ ] **Step 1: Write the failing test** — append to `test/cloudflare-docs.spec.ts`:

```ts
import { fetchCloudflareDocResult } from '@server/services/cloudflare-docs';

describe('fetchCloudflareDocResult', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('returns a structured record with doc text', async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ result: { content: [{ type: 'text', text: 'D1 batch docs' }] } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as any;
    const r = await fetchCloudflareDocResult('D1 batch');
    expect(r).toEqual({ query: 'D1 batch', source: 'cloudflare-docs', content: 'D1 batch docs' });
  });

  it('returns empty content on failure (never throws)', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as any;
    const r = await fetchCloudflareDocResult('anything');
    expect(r).toEqual({ query: 'anything', source: 'cloudflare-docs', content: '' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cloudflare-docs.spec.ts -t fetchCloudflareDocResult`
Expected: FAIL — `fetchCloudflareDocResult` is not exported.

- [ ] **Step 3: Add the wrapper** — append to `src/server/services/cloudflare-docs.ts`:

```ts
export type CloudflareDocResult = { query: string; source: 'cloudflare-docs'; content: string };

/** Structured, storable form of searchCloudflareDocs. Best-effort; never throws. */
export async function fetchCloudflareDocResult(query: string): Promise<CloudflareDocResult> {
  const content = await searchCloudflareDocs(query);
  return { query, source: 'cloudflare-docs', content };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/cloudflare-docs.spec.ts -t fetchCloudflareDocResult`
Expected: PASS (both cases).

- [ ] **Step 5: Register the MCP tool** — in `src/server/agents/orchestrator.ts`, add the import at the top with the other `@server` imports:

```ts
import { fetchCloudflareDocResult } from '@server/services/cloudflare-docs';
```

Then inside `GitHubLikeMCP.init()` (after the existing `this.server.tool("search_issues", ...)` block near line 111), register:

```ts
this.server.tool(
  "search_cloudflare_docs",
  "Search official Cloudflare documentation. Token-free (no AI); returns documentation text for a query. Use this to pull authoritative docs for a Cloudflare topic or a flagged best-practice violation.",
  { query: z.string().describe("What to look up in the Cloudflare docs") } as any,
  async ({ query }: { query: string }) => asText(await fetchCloudflareDocResult(query)),
);
```

(`asText` and `z` already exist in this file — `orchestrator.ts:36` and `:3`.)

- [ ] **Step 6: Verify build**

Run: `npm run typecheck`
Expected: no new errors in `cloudflare-docs.ts` or `orchestrator.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/server/services/cloudflare-docs.ts src/server/agents/orchestrator.ts test/cloudflare-docs.spec.ts
git commit -m "feat: structured CF-docs wrapper + search_cloudflare_docs MCP tool"
```

---

### Task 2: Model reports `bestPracticeChecks` (schema + parse + prompt)

**Files:**
- Modify: `src/shared/schema.ts:42` (`fileReviewModelOutputSchema`) + add `bestPracticeCheckSchema`
- Modify: `src/server/core/model-output.ts:476` (thread field through `parseFileReviewResponse`) + add `mergeBestPracticeChecks`
- Modify: `src/server/services/model.ts:381-384` (prompt instruction) — and confirm the structured-output schema passed at `model.ts:460` (`REVIEW_SCHEMA`) derives from `fileReviewModelOutputSchema`; if `REVIEW_SCHEMA` is a hand-written JSON schema, add the same field there.
- Test: `test/model-output.spec.ts` (exists — append)

**Interfaces:**
- Produces: `bestPracticeCheckSchema` = `{ practice: string; status: 'pass' | 'violation'; note?: string }`; `parseFileReviewResponse(...)` return object gains `bestPracticeChecks: Array<z.infer<typeof bestPracticeCheckSchema>>` (always an array, `[]` when none); `mergeBestPracticeChecks(lists: Array<Array<{practice;status;note?}>>): Array<{practice;status;note?}>` exported from `model-output.ts` (dedupe by `practice`, `violation` wins over `pass`).
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test** — append to `test/model-output.spec.ts`:

```ts
import { mergeBestPracticeChecks } from '@server/core/model-output';

describe('bestPracticeChecks', () => {
  it('parseFileReviewResponse surfaces bestPracticeChecks', () => {
    const raw = JSON.stringify({
      findings: [],
      overall_correctness: 'patch is correct',
      overall_explanation: 'ok',
      best_practice_checks: [{ practice: 'D1 Bulk Insert Batching', status: 'violation', note: 'no db.batch()' }],
    });
    const out = parseFileReviewResponse(raw, { path: 'a.ts', hunks: [] } as any);
    expect(out.bestPracticeChecks).toEqual([
      { practice: 'D1 Bulk Insert Batching', status: 'violation', note: 'no db.batch()' },
    ]);
  });

  it('mergeBestPracticeChecks dedupes by practice with violation winning', () => {
    const merged = mergeBestPracticeChecks([
      [{ practice: 'X', status: 'pass' }],
      [{ practice: 'X', status: 'violation', note: 'bad' }],
      [{ practice: 'Y', status: 'pass' }],
    ]);
    expect(merged).toEqual([
      { practice: 'X', status: 'violation', note: 'bad' },
      { practice: 'Y', status: 'pass' },
    ]);
  });
});
```

(Use the existing `parseFileReviewResponse` import already at the top of `test/model-output.spec.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/model-output.spec.ts -t bestPracticeChecks`
Expected: FAIL — `mergeBestPracticeChecks` undefined / `bestPracticeChecks` missing.

- [ ] **Step 3: Add the schema** — in `src/shared/schema.ts`, after `parsedReviewCommentSchema` (line 40), add:

```ts
export const bestPracticeStatuses = ['pass', 'violation'] as const;
export const bestPracticeCheckSchema = z.object({
  practice: z.string().min(1),
  status: z.enum(bestPracticeStatuses),
  note: z.string().optional(),
});
export type BestPracticeCheck = z.infer<typeof bestPracticeCheckSchema>;
```

Then add the field to `fileReviewModelOutputSchema` (inside the object, after `findings`, around line 59):

```ts
  best_practice_checks: z.array(bestPracticeCheckSchema).optional().default([]),
```

- [ ] **Step 4: Thread it through the parser** — in `src/server/core/model-output.ts`, change the return object of `parseFileReviewResponse` (line 476) to include the field, and add the merge helper below the function:

```ts
  return {
    comments,
    verdict: comments.length > 0 ? 'comment' : verdict,
    fileSummary: fileSummary,
    overallCorrectness: parsed.overall_correctness,
    confidenceScore: parsed.overall_confidence_score,
    bestPracticeChecks: parsed.best_practice_checks ?? [],
  };
}

/** Combine per-reviewer/per-call checks: dedupe by practice, a violation wins. */
export function mergeBestPracticeChecks(
  lists: Array<Array<{ practice: string; status: 'pass' | 'violation'; note?: string }>>,
): Array<{ practice: string; status: 'pass' | 'violation'; note?: string }> {
  const byPractice = new Map<string, { practice: string; status: 'pass' | 'violation'; note?: string }>();
  for (const list of lists) {
    for (const c of list ?? []) {
      const existing = byPractice.get(c.practice);
      if (!existing || (existing.status === 'pass' && c.status === 'violation')) {
        byPractice.set(c.practice, c);
      }
    }
  }
  return [...byPractice.values()];
}
```

- [ ] **Step 5: Add the prompt instruction** — in `src/server/services/model.ts`, where `matchedPractices` is turned into `custom_rules` (line 381-384), append a structured-reporting instruction when practices matched:

```ts
    const customRules = [
      ...params.config.review.custom_rules,
      ...matchedPractices.map(p => `Best Practice [${p.name}]:\n${convertPlateToMarkdown(p.instructions)}`),
    ];

    if (matchedPractices.length > 0) {
      customRules.push(
        `=== Best-Practice Check Reporting ===\n` +
        `Each "Best Practice [name]" above is a CHECK PROCEDURE for this file. ` +
        `Run each one against this file and report the result in the "best_practice_checks" ` +
        `output array as { "practice": "<exact name>", "status": "pass" | "violation", "note": "<short evidence>" }. ` +
        `Report one entry per applicable best practice above. If a practice's trigger condition does not apply to this file, use status "pass".`,
      );
    }
```

- [ ] **Step 6: Ensure the structured-output schema includes the field** — open `src/server/services/model.ts` and find `REVIEW_SCHEMA` (used at `callResolvedModel(..., REVIEW_SCHEMA, ...)`, line 460). If it is derived from `fileReviewModelOutputSchema` (e.g. via `zod-to-json-schema`), no change is needed — Step 3 covers it. If it is a hand-authored JSON schema object, add a `best_practice_checks` array property mirroring `bestPracticeCheckSchema` (items: object with `practice` string, `status` enum `["pass","violation"]`, `note` string; not required). Grep: `grep -n "REVIEW_SCHEMA" src/server/services/model.ts`.

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run test/model-output.spec.ts -t bestPracticeChecks && npm run typecheck`
Expected: PASS; no new type errors.

- [ ] **Step 8: Commit**

```bash
git add src/shared/schema.ts src/server/core/model-output.ts src/server/services/model.ts test/model-output.spec.ts
git commit -m "feat: model reports best_practice_checks per file review"
```

---

### Task 3: DB columns + migration

**Files:**
- Modify: `src/server/db/schemas/reviews/index.ts:5` (`fileReviews` — add column)
- Modify: `src/server/db/schemas/jobs/index.ts` (`jobs` — add column)
- Create: `db/migrations/d1/<generated>.sql` (via drizzle-kit)

**Interfaces:**
- Produces: `fileReviews.best_practice_checks` (text, nullable) and `jobs.best_practice_docs` (text, nullable). Later tasks read/write these as JSON strings.

- [ ] **Step 1: Add the columns** — in `src/server/db/schemas/reviews/index.ts`, add to the `fileReviews` table definition (after `cache_write_tokens`, line 30):

```ts
  // JSON: BestPracticeCheck[] — per-file best-practice pass/violation results.
  best_practice_checks: text('best_practice_checks'),
```

In `src/server/db/schemas/jobs/index.ts`, add to the `jobs` table definition (near the other nullable columns):

```ts
  // JSON: { violated: string[], checks: {practice,passed,violated}[], docs: CloudflareDocResult[] }
  best_practice_docs: text('best_practice_docs'),
```

Confirm `text` is imported in `jobs/index.ts` (it is used already).

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `db/migrations/d1/NNNN_*.sql` file with two `ALTER TABLE ... ADD` statements.

- [ ] **Step 3: Verify the migration content**

Run: `grep -rl "best_practice_checks\|best_practice_docs" db/migrations/d1/`
Expected: the new migration file lists both `ADD` columns.

- [ ] **Step 4: Verify the test shim applies it** — the D1 shim (`test/d1-sqlite.ts`) applies every migration; run any existing D1 spec to confirm migrations still load:

Run: `npx vitest run test/planning-packages-db.spec.ts`
Expected: PASS (migrations apply cleanly, including the new one).

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schemas/reviews/index.ts src/server/db/schemas/jobs/index.ts db/migrations/d1/
git commit -m "feat: add best_practice_checks + best_practice_docs columns"
```

---

### Task 4: Persist per-file `bestPracticeChecks`

**Files:**
- Modify: `src/server/db/file-reviews.ts` (`upsertFileReview` input + column mapping)
- Modify: `src/server/core/review.ts:1315-1341` (single-call capture), `:1413-1426` (fan-out aggregate), `:1429` (pass to upsert)
- Test: `test/file-reviews-db.spec.ts` (exists — append)

**Interfaces:**
- Consumes: `parseFileReviewResponse(...).bestPracticeChecks`, `mergeBestPracticeChecks` (Task 2).
- Produces: `upsertFileReview` accepts optional `bestPracticeChecks?: BestPracticeCheck[]` and persists it as JSON in `file_reviews.best_practice_checks`.

- [ ] **Step 1: Write the failing test** — append to `test/file-reviews-db.spec.ts` (reuse its existing `seedJob`, `baseReview`, `getDb`, `fileReviews` imports; add `import { eq } from 'drizzle-orm'` and `fileReviews` to the schema import if not present):

```ts
it('upsertFileReview persists best_practice_checks as JSON', async () => {
  await upsertFileReview(env, 'job-1', {
    filePath: 'bp.ts', parsedComments: [], ...baseReview,
    bestPracticeChecks: [{ practice: 'D1 Bulk Insert Batching', status: 'violation', note: 'no batch' }],
  });
  const db = getDb(env);
  const [row] = await db.select().from(fileReviews).where(eq(fileReviews.file_path, 'bp.ts'));
  expect(JSON.parse(row.best_practice_checks!)).toEqual([
    { practice: 'D1 Bulk Insert Batching', status: 'violation', note: 'no batch' },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/file-reviews-db.spec.ts -t "best_practice_checks"`
Expected: FAIL — `bestPracticeChecks` not accepted / column stays null.

- [ ] **Step 3: Extend `upsertFileReview`** — in `src/server/db/file-reviews.ts`, add to the `input` type of `upsertFileReview` (near `cacheWriteTokens`):

```ts
    bestPracticeChecks?: Array<{ practice: string; status: 'pass' | 'violation'; note?: string }> | null;
```

In BOTH the UPDATE `.set({...})` and the INSERT `.values({...})` blocks of `upsertFileReview`, add:

```ts
      best_practice_checks: input.bestPracticeChecks ? JSON.stringify(input.bestPracticeChecks) : null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/file-reviews-db.spec.ts -t "best_practice_checks"`
Expected: PASS.

- [ ] **Step 5: Wire the review pipeline** — in `src/server/core/review.ts`:

Declare a holder near the other `let` declarations (around line 1310):

```ts
    let bestPracticeChecks: Array<{ practice: string; status: 'pass' | 'violation'; note?: string }> = [];
```

In the single-call path (after line 1331 `confidenceScore = response.parsed.confidenceScore;`):

```ts
      bestPracticeChecks = response.parsed.bestPracticeChecks ?? [];
```

In the fan-out path (after line 1421 `confidenceScore = aggregate.confidenceScore;`):

```ts
      bestPracticeChecks = mergeBestPracticeChecks(results.map(r => r.parsed?.bestPracticeChecks ?? []));
```

Add `bestPracticeChecks` to the `upsertFileReview` call at line 1429 (alongside `overallCorrectness`):

```ts
      bestPracticeChecks,
```

Add the import at the top of `review.ts`:

```ts
import { mergeBestPracticeChecks } from '@server/core/model-output';
```

Note: `results` items are `ReviewerCallResult`; confirm each carries `.parsed.bestPracticeChecks` (it does, via `parseFileReviewResponse` from Task 2). If `aggregateReviewerResults` strips `parsed`, thread `bestPracticeChecks` through it the same way `comments` is combined.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run test/file-reviews-db.spec.ts && npm run typecheck`
Expected: PASS; no new type errors.

- [ ] **Step 7: Commit**

```bash
git add src/server/db/file-reviews.ts src/server/core/review.ts test/file-reviews-db.spec.ts
git commit -m "feat: persist per-file best_practice_checks"
```

---

### Task 5: Phase-3 aggregation + CF-docs fetch

**Files:**
- Create: `src/server/core/best-practice-docs.ts` (aggregation + docs fetch)
- Modify: `src/server/db/jobs.ts` (add `recordBestPracticeDocs`)
- Modify: `src/server/core/review.ts` (invoke before finalize, near line 1728, before `createReview` at 1753)
- Test: `test/best-practice-docs.spec.ts` (create)

**Interfaces:**
- Consumes: `fetchCloudflareDocResult` (Task 1), `file_reviews.best_practice_checks` (Task 3), `listBestPractices` (`src/server/db/best-practices.ts`).
- Produces:
  - `recordBestPracticeDocs(env, jobId, payload: BestPracticeDocsPayload): Promise<void>` in `src/server/db/jobs.ts`.
  - `type BestPracticeDocsPayload = { violated: string[]; checks: Array<{ practice: string; passed: number; violated: number }>; docs: CloudflareDocResult[] }`.
  - `aggregateBestPracticeDocs(env, jobId): Promise<BestPracticeDocsPayload>` in `src/server/core/best-practice-docs.ts` — reads persisted checks, tallies, fetches docs for violated `cloudflare-workers` practices, writes via `recordBestPracticeDocs`, returns the payload.

- [ ] **Step 1: Write the failing test** — create `test/best-practice-docs.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getDb } from '@server/db/client';
import { jobs, repositories, fileReviews } from '@server/db/schemas';
import { createBestPractice } from '@server/db/best-practices';
import { aggregateBestPracticeDocs } from '@server/core/best-practice-docs';
import { createTestEnv } from './helpers';

async function seed(env: Env) {
  const db = getDb(env);
  const [repo] = await db.insert(repositories).values({ installation_id: 1, owner: 'o', repo: 'r' }).returning();
  await db.insert(jobs).values({ id: 'job-1', repository_id: repo.id, pr_number: 1, status: 'running', commit_sha: 'aa', base_sha: 'bb', trigger: 'manual' } as any);
  await createBestPractice(env, { name: 'D1 Bulk Insert Batching', infraId: 'cloudflare-workers', criteria: 'd1', instructions: '[]' });
  await db.insert(fileReviews).values([
    { job_id: 'job-1', file_path: 'a.ts', file_status: 'done', model_used: 'm', best_practice_checks: JSON.stringify([{ practice: 'D1 Bulk Insert Batching', status: 'violation', note: 'x' }]) },
    { job_id: 'job-1', file_path: 'b.ts', file_status: 'done', model_used: 'm', best_practice_checks: JSON.stringify([{ practice: 'D1 Bulk Insert Batching', status: 'pass' }]) },
  ] as any);
}

describe('aggregateBestPracticeDocs', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ result: { content: [{ type: 'text', text: 'D1 docs body' }] } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as any;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  it('tallies violations and attaches CF docs', async () => {
    const env = createTestEnv();
    await seed(env);
    const payload = await aggregateBestPracticeDocs(env, 'job-1');
    expect(payload.violated).toEqual(['D1 Bulk Insert Batching']);
    expect(payload.checks).toEqual([{ practice: 'D1 Bulk Insert Batching', passed: 1, violated: 1 }]);
    expect(payload.docs).toEqual([{ query: 'D1 Bulk Insert Batching', source: 'cloudflare-docs', content: 'D1 docs body' }]);
    // persisted on the job row
    const db = getDb(env);
    const { eq } = await import('drizzle-orm');
    const [job] = await db.select().from(jobs).where(eq(jobs.id, 'job-1'));
    expect(JSON.parse(job.best_practice_docs!).violated).toEqual(['D1 Bulk Insert Batching']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/best-practice-docs.spec.ts`
Expected: FAIL — module `best-practice-docs` not found.

- [ ] **Step 3: Add `recordBestPracticeDocs`** — in `src/server/db/jobs.ts`, add:

```ts
export type BestPracticeDocsPayload = {
  violated: string[];
  checks: Array<{ practice: string; passed: number; violated: number }>;
  docs: Array<{ query: string; source: 'cloudflare-docs'; content: string }>;
};

export async function recordBestPracticeDocs(env: Pick<Env, 'DB'>, jobId: string, payload: BestPracticeDocsPayload) {
  const db = getDb(env);
  await db.update(jobs).set({ best_practice_docs: JSON.stringify(payload) }).where(eq(jobs.id, jobId));
}
```

(`getDb`, `jobs`, `eq` are already imported in `jobs.ts`.)

- [ ] **Step 4: Add the aggregator** — create `src/server/core/best-practice-docs.ts`:

```ts
import { getDb, parseJsonColumn } from '@server/db/client';
import { fileReviews } from '@server/db/schemas';
import { eq } from 'drizzle-orm';
import { listBestPractices } from '@server/db/best-practices';
import { recordBestPracticeDocs, type BestPracticeDocsPayload } from '@server/db/jobs';
import { fetchCloudflareDocResult } from '@server/services/cloudflare-docs';

type Check = { practice: string; status: 'pass' | 'violation'; note?: string };

/**
 * Read all persisted per-file best_practice_checks for a job, tally pass/violation
 * per practice, fetch a static Cloudflare-docs snapshot for each violated
 * cloudflare-workers practice, and persist the aggregate on the job row.
 * Best-effort and non-blocking: any docs miss yields content: ''.
 */
export async function aggregateBestPracticeDocs(env: Pick<Env, 'DB'>, jobId: string): Promise<BestPracticeDocsPayload> {
  const db = getDb(env);
  const rows = await db.select({ checks: fileReviews.best_practice_checks })
    .from(fileReviews).where(eq(fileReviews.job_id, jobId)).all();

  const tally = new Map<string, { passed: number; violated: number }>();
  for (const row of rows) {
    const checks = parseJsonColumn<Check[]>(row.checks, []);
    for (const c of checks) {
      const t = tally.get(c.practice) ?? { passed: 0, violated: 0 };
      if (c.status === 'violation') t.violated++; else t.passed++;
      tally.set(c.practice, t);
    }
  }

  const checks = [...tally.entries()].map(([practice, t]) => ({ practice, ...t }));
  const violated = checks.filter(c => c.violated > 0).map(c => c.practice);

  // Gate CF-docs queries to cloudflare-workers practices.
  const practices = await listBestPractices(env);
  const cfViolated = violated.filter(name =>
    practices.some(p => p.name === name && p.infraId === 'cloudflare-workers'));

  const docs = [];
  for (const name of cfViolated) {
    docs.push(await fetchCloudflareDocResult(name));
  }

  const payload: BestPracticeDocsPayload = { violated, checks, docs };
  await recordBestPracticeDocs(env, jobId, payload);
  return payload;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/best-practice-docs.spec.ts`
Expected: PASS.

- [ ] **Step 6: Invoke before finalize** — in `src/server/core/review.ts`, immediately before the review overview is built / `createReview` is called (before line 1728-1753), add:

```ts
    // Phase 3: collate best-practice checks across the PR's files and attach a
    // static Cloudflare-docs snapshot for each violated practice. Best-effort.
    try {
      await aggregateBestPracticeDocs(env, job.id);
    } catch (err) {
      logger.warn('best-practice docs aggregation failed', { jobId: job.id, error: err instanceof Error ? err.message : String(err) });
    }
```

Add the import at the top of `review.ts`:

```ts
import { aggregateBestPracticeDocs } from '@server/core/best-practice-docs';
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add src/server/core/best-practice-docs.ts src/server/db/jobs.ts src/server/core/review.ts test/best-practice-docs.spec.ts
git commit -m "feat: aggregate best-practice violations + attach CF docs to job"
```

---

### Task 6: Surface in `/reviews/:id.json`

**Files:**
- Modify: `src/server/db/jobs.ts:228` (`getReviewSuggestions`)
- Test: `test/api.spec.ts` or a new `test/review-suggestions.spec.ts` (create)

**Interfaces:**
- Consumes: `jobs.best_practice_docs`, `fileReviews.best_practice_checks` (Task 3), `parseJsonColumn`.
- Produces: `/reviews/:id.json` gains `files[].bestPracticeChecks: BestPracticeCheck[]` and top-level `bestPractices: BestPracticeDocsPayload | null`.

- [ ] **Step 1: Write the failing test** — create `test/review-suggestions.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getDb } from '@server/db/client';
import { jobs, repositories, fileReviews } from '@server/db/schemas';
import { getReviewSuggestions } from '@server/db/jobs';
import { createTestEnv } from './helpers';

const JOB = '11111111-1111-1111-1111-111111111111';

it('includes bestPracticeChecks per file and job-level bestPractices', async () => {
  const env = createTestEnv();
  const db = getDb(env);
  const [repo] = await db.insert(repositories).values({ installation_id: 1, owner: 'o', repo: 'r' }).returning();
  await db.insert(jobs).values({ id: JOB, repository_id: repo.id, pr_number: 1, status: 'done', commit_sha: 'aa', base_sha: 'bb', trigger: 'manual',
    best_practice_docs: JSON.stringify({ violated: ['D1 Bulk Insert Batching'], checks: [{ practice: 'D1 Bulk Insert Batching', passed: 0, violated: 1 }], docs: [{ query: 'D1 Bulk Insert Batching', source: 'cloudflare-docs', content: 'body' }] }) } as any);
  await db.insert(fileReviews).values({ job_id: JOB, file_path: 'a.ts', file_status: 'done', model_used: 'm',
    best_practice_checks: JSON.stringify([{ practice: 'D1 Bulk Insert Batching', status: 'violation', note: 'x' }]) } as any);

  const out = await getReviewSuggestions(env, JOB);
  expect(out!.files[0].bestPracticeChecks).toEqual([{ practice: 'D1 Bulk Insert Batching', status: 'violation', note: 'x' }]);
  expect(out!.bestPractices!.violated).toEqual(['D1 Bulk Insert Batching']);
  expect(out!.bestPractices!.docs[0].content).toBe('body');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/review-suggestions.spec.ts`
Expected: FAIL — fields missing.

- [ ] **Step 3: Extend `getReviewSuggestions`** — in `src/server/db/jobs.ts`:

Add `best_practice_docs: jobs.best_practice_docs` to the `jobRow` select (around line 241), and `bestPracticeChecks: fileReviews.best_practice_checks` to the `fileRows` select (around line 273).

Import `parseJsonColumn` if not already: `import { getDb, parseJsonColumn } from './client';` (confirm the existing import line).

In the `files` map (line 287), add:

```ts
      bestPracticeChecks: parseJsonColumn<Array<{ practice: string; status: 'pass' | 'violation'; note?: string }>>(fr.bestPracticeChecks, []),
```

In the returned object (line 303), add:

```ts
    bestPractices: parseJsonColumn<{ violated: string[]; checks: Array<{ practice: string; passed: number; violated: number }>; docs: Array<{ query: string; source: 'cloudflare-docs'; content: string }> } | null>(jobRow.best_practice_docs, null as any),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/review-suggestions.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/db/jobs.ts test/review-suggestions.spec.ts
git commit -m "feat: expose bestPracticeChecks + bestPractices in /reviews/:id.json"
```

---

### Task 7: Author `bp-d1-batch-chunking` as a check procedure

**Files:**
- Modify: `scripts/ops/seed-sql-practices.js` (rewrite `rule3Instructions`)
- Regenerate: `scripts/ops/seed-sql-practices.sql`

**Interfaces:**
- Consumes: nothing new. The practice `name` stays `"D1 Bulk Insert Batching"` (the docs-query key and the check name the model reports).

- [ ] **Step 1: Rewrite the instructions** — in `scripts/ops/seed-sql-practices.js`, replace the body paragraphs of `rule3Instructions` so it reads as an explicit check procedure (keep the `h3` title `"D1 Bulk Insert Batching (Required Integration Pattern)"`):

```js
const rule3Instructions = [
  { type: 'h3', children: [{ text: 'D1 Bulk Insert Batching (Required Integration Pattern)' }] },
  { type: 'p', children: [{ text: 'CHECK PROCEDURE — evaluate this file and report pass or violation for the practice "D1 Bulk Insert Batching".' }] },
  { type: 'p', children: [{ text: 'Trigger: this file reads/writes Cloudflare D1 (Drizzle db.insert/db.update, SQL, or a migration). If it does not, status = pass.' }] },
  { type: 'p', children: [{ text: 'When triggered, it is a VIOLATION if any of these fail:' }] },
  { type: 'ul', children: [
    { type: 'li', children: [{ text: 'Bulk/multi-row inserts must be chunked by ' }, { text: 'Math.floor(100 / COLUMNS_PER_ROW)', code: true }, { text: ' (D1 caps a query at 100 bound parameters).' }] },
    { type: 'li', children: [{ text: 'Chunks must be flushed in a single ' }, { text: 'db.batch()', code: true }, { text: ' call, not a sequential loop of awaited db.insert() calls.' }] },
    { type: 'li', children: [{ text: 'Database access uses Drizzle ORM + migrations (no raw SQL in standard worker code).' }] },
  ] },
  { type: 'p', children: [{ text: 'Report: { practice: "D1 Bulk Insert Batching", status: "pass" | "violation", note: "<what you found>" }.' }] },
];
```

- [ ] **Step 2: Regenerate the SQL**

Run: `node scripts/ops/seed-sql-practices.js`
Expected: `Successfully generated SQL seed file ...`; `grep -c "bp-d1-batch-chunking" scripts/ops/seed-sql-practices.sql` → `1`.

- [ ] **Step 3: Commit**

```bash
git add scripts/ops/seed-sql-practices.js scripts/ops/seed-sql-practices.sql
git commit -m "feat: author D1 batch best practice as a check procedure"
```

---

### Final verification

- [ ] **Step 1: Full targeted test run**

Run: `npx vitest run test/cloudflare-docs.spec.ts test/model-output.spec.ts test/file-reviews-db.spec.ts test/best-practice-docs.spec.ts test/review-suggestions.spec.ts`
Expected: all PASS.

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: no NEW errors beyond the pre-existing missing-dep errors (`@xyflow/react`, `libsodium-wrappers` — declared but not installed in this worktree; run `pnpm install` to clear if needed).

- [ ] **Step 3: Final commit if anything outstanding**

```bash
git status
```

## Self-Review (completed while writing)

- **Spec coverage:** Component A → Task 1; Component B (MCP tool) → Task 1; Phase 1 triage → reuses `getMatchingBestPractices` inside Task 2's prompt path (no new code, matching already runs); Phase 2 → Tasks 2 & 4; Phase 3 → Task 5; JSON output → Task 6; migrations → Task 3; authoring convention → Task 7. All covered.
- **Placeholder scan:** every code step has concrete code; the one discovery step (Task 2 Step 6, `REVIEW_SCHEMA`) gives the exact grep + the exact field to add in each branch.
- **Type consistency:** `bestPracticeCheckSchema` shape `{practice,status,note?}` is used verbatim in model-output return, `mergeBestPracticeChecks`, `upsertFileReview` input, the aggregator, and the JSON. `BestPracticeDocsPayload` defined once in `jobs.ts` and imported by the aggregator and referenced by the JSON shape. `fetchCloudflareDocResult`/`CloudflareDocResult` defined in Task 1 and consumed in Tasks 5 & 6.
- **Known integration risk (flagged, not a placeholder):** Task 4 Step 5 depends on `ReviewerCallResult.parsed.bestPracticeChecks` surviving `aggregateReviewerResults`; the step names the fix if it doesn't.
