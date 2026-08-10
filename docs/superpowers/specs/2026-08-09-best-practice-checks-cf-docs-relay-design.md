# Best-Practice Checks + Cloudflare-Docs Relay — Design

Date: 2026-08-09
Status: Approved (design), pending implementation plan

## Problem

Codra reviews GitHub PRs and serves a machine-readable review payload at
`GET /reviews/:id.json` (produced by `getReviewSuggestions`,
`src/server/db/jobs.ts:228`). Downstream coding agents (e.g. Jules) read that
JSON instead of scraping PR comments via the `gh` CLI, which sometimes hangs.

Two gaps:

1. **Best-practice violations are not evaluated as structured checks.** Best
   practices are injected into the per-file review prompt as free-text
   `custom_rules` (`src/server/services/model.ts:379-384`). Nothing reports, per
   practice, whether a changed file passed or violated it, and nothing survives
   into the JSON payload.
2. **Authoritative docs never reach the coding agent.** When a practice is
   violated (e.g. a D1 bulk insert without `db.batch()` chunking), the coding
   agent has no in-payload pointer to the relevant Cloudflare documentation. A
   runtime, token-free CF-docs query already exists (`searchCloudflareDocs`,
   `src/server/services/cloudflare-docs.ts:10`) but is only used to generate
   *new* best practices during docs-review — never relayed into a review's JSON.

## Goals

- Evaluate best practices as **per-file checks scoped to the PR's changed files
  only** — no work for practices whose subject isn't touched by the PR.
- Report each check as `pass` / `violation` and surface the results in
  `/reviews/:id.json`.
- For each violated practice, attach a **static snapshot** of the relevant
  Cloudflare docs (via the token-free utility) into the JSON payload.
- Expose the CF-docs query as an **MCP tool** (`search_cloudflare_docs`) so
  coding agents can also pull docs directly, on demand, with no AI tokens.

## Non-goals (v1)

- No separate repo-wide scan pass. Checks are scoped to changed files; a file's
  own content decides which checks apply (a `.ts` file that writes D1 is checked
  for batching; a PR with no D1-touching files auto-passes the D1 practice).
- No Jules-session-per-check orchestration (too slow: 5–7 min VM spin-up,
  requires razor-sharp instructions, low capability).
- No change to the PR comment **body** — the "review done" comment already links
  to the JSON. (Optional future enhancement.)
- No global cross-PR docs cache. Docs are fetched once per job for violated
  practices and stored as a static snapshot. (Future optimization.)
- No model-based triage. Triage uses the existing keyword `criteria` matcher.

## Architecture

Three phases layered onto the existing live queue/DB pipeline
(`runReviewJob` → `runReviewPhase`, `src/server/core/review.ts`), plus one
standalone MCP tool. The agentic `RepoAgent`/`ReviewAgent` path is **not** used
— it bypasses D1 and isn't wired to the prod webhook.

### Component A — Token-free CF-docs utility (reuse + thin wrapper)

`searchCloudflareDocs(query)` (`src/server/services/cloudflare-docs.ts`) already
does a plain `fetch` JSON-RPC `tools/call` to `https://docs.mcp.cloudflare.com/mcp`
invoking `search_cloudflare_documentation`, returns `''` on any failure, 12s
timeout, 8000-char cap. No AI tokens, no binding.

Add a thin structured wrapper returning a stable record for storage/reuse:

```ts
type CloudflareDocResult = { query: string; source: 'cloudflare-docs'; content: string };
async function fetchCloudflareDocResult(query: string): Promise<CloudflareDocResult>;
```

`content: ''` signals a best-effort miss (still stored, so consumers see the
attempt).

### Component B — `search_cloudflare_docs` MCP tool

Register on `GitHubLikeMCP` (`src/server/agents/orchestrator.ts:60`, pattern
`this.server.tool(name, description, zodShape, handler)`; served at `/mcp` via
`src/server/app.ts:155-163`):

```ts
this.server.tool(
  "search_cloudflare_docs",
  "Search official Cloudflare documentation. Token-free; returns doc text for a query.",
  { query: z.string().describe("What to look up in Cloudflare docs") } as any,
  async ({ query }) => asText(await fetchCloudflareDocResult(query)),
);
```

Coding agents on `/mcp` call it directly — no AI tokens, no `gh`.

### Phase 1 — Per-PR checklist (triage, token-free)

For each **changed file** in the PR, match active best practices by their
`criteria` keywords using the existing `getMatchingBestPractices` /
`matchesCriteria` (`src/server/db/best-practices.ts:181,206`). Result: a per-file
checklist — the set of practices (with their check `instructions`) that apply to
that file. A file matching nothing → empty checklist → auto-pass. This is the
"JSON schema of checks per file."

This matching already runs inside `model.ts` per file at prompt-build time
(`model.ts:379`); Phase 1 makes the matched set explicit and structured so
Phase 2 can report against it and Phase 3 can aggregate it.

### Phase 2 — Per-file review tallies its checklist

Fold structured check-reporting into the existing per-file review
(`model.reviewFile`, called at `review.ts:1315` and `:1357`). The review already
receives the matched practices as `custom_rules`; extend the prompt to instruct
the model to evaluate each assigned practice's check procedure against the file
and return, in addition to its comments:

```ts
bestPracticeChecks?: Array<{
  practice: string;              // best-practice name (matches best_practices.name)
  status: 'pass' | 'violation';
  note?: string;                 // short evidence / reason
}>;
```

No extra model call — same review invocation, richer output. Persist on the
file's `file_reviews` row (new JSON column, see Data model).

### Phase 3 — Final best-practice overview (before marking PR complete)

In `review.ts`, after all files are reviewed and persisted and before the review
is finalized (before `createReview`, `review.ts:1753`):

1. Aggregate `bestPracticeChecks` across all file reviews for the job.
2. A practice is **violated at the job level** if any file reported a
   `violation` for it.
3. For each violated practice, resolve a docs query (v1: the practice `name`;
   see Open questions) and call `fetchCloudflareDocResult(query)` once
   (deduped). Only practices with `infra_id === 'cloudflare-workers'` query CF
   docs.
4. Store the job-level result: violated list, per-practice pass/violation tally,
   and the static docs snapshots.

Aggregation is deterministic code (no extra model call).

## Data model / migrations

One Drizzle migration adding two JSON (TEXT) columns:

- `file_reviews.best_practice_checks` — JSON array of `{ practice, status, note }`
  (`src/server/db/schemas/reviews/index.ts`).
- `jobs.best_practice_docs` — JSON of the job-level aggregate:
  `{ violated: string[], checks: Array<{ practice, passed, violated }>, docs: CloudflareDocResult[] }`
  (`src/server/db/schemas/jobs`).

Both nullable; absent = feature produced nothing for that row (backward
compatible).

Persistence: `best_practice_checks` written where file reviews are persisted
(`upsertFileReview`, `src/server/db/file-reviews.ts`) — add an optional field to
its input and column mapping. `best_practice_docs` written by a new
`recordBestPracticeDocs(env, jobId, payload)` helper in `src/server/db/jobs.ts`.

## Schema / code changes

- `src/shared/schema.ts:42` — `fileReviewModelOutputSchema` gains optional
  `bestPracticeChecks`. Add the `bestPracticeCheckSchema` object.
- `src/server/core/model-output.ts:402` — thread `bestPracticeChecks` from model
  output into the parsed file-review result.
- Prompt builder (`buildFileReviewPrompts`, invoked at `model.ts:399`) — when a
  file has assigned practices, instruct the model to run each check procedure and
  emit `bestPracticeChecks`.
- `src/server/core/review.ts` — capture per-file checks into the persistence
  call; add the Phase-3 aggregation + docs fetch + `recordBestPracticeDocs`.
- `src/server/db/jobs.ts:228` (`getReviewSuggestions`) — include per-file
  `bestPracticeChecks` and job-level `bestPractices` in the JSON.
- `src/server/agents/orchestrator.ts` — register `search_cloudflare_docs`.
- `scripts/ops/seed-sql-practices.js` — rewrite `bp-d1-batch-chunking`
  `instructions` as an explicit check procedure (D1 present in this file? →
  Drizzle + migrations required → inserts/updates must chunk + `db.batch()`) so
  the model can report pass/violation.

## JSON payload additions (`/reviews/:id.json`)

Per file (in `files[]`):

```jsonc
"bestPracticeChecks": [
  { "practice": "D1 Bulk Insert Batching", "status": "violation",
    "note": "insert(reviewComments).values(rows) not chunked / no db.batch()" }
]
```

Job level (new top-level key):

```jsonc
"bestPractices": {
  "violated": ["D1 Bulk Insert Batching"],
  "checks": [ { "practice": "D1 Bulk Insert Batching", "passed": 2, "violated": 1 } ],
  "docs": [
    { "query": "D1 Bulk Insert Batching", "source": "cloudflare-docs",
      "content": "…static Cloudflare docs text…" }
  ]
}
```

Existing keys (`files`, `suggestions`, etc.) unchanged — additive only.

## Best-practice authoring convention

Practice `instructions` (PlateJS JSON) are authored as a **check procedure** the
review model can evaluate and report against, not just advice. Convention:
state the trigger condition, the required-state checks, and that the model must
report `pass`/`violation` for the named practice. The seeded
`bp-d1-batch-chunking` practice is rewritten to this form as the reference
example.

## Error handling

- CF-docs fetch is best-effort: failure/timeout → `content: ''`, review still
  completes. Never blocks or fails a review.
- Model omits `bestPracticeChecks` or emits an unknown practice name → treated
  as "no check reported" (no violation, no docs). Safe, non-blocking.
- Malformed stored JSON → treated as absent by `getReviewSuggestions`
  (parse-guarded), payload still serves.

## Testing

D1-only in-memory spec (per repo convention, `test/d1-sqlite.ts`):

- Phase-3 aggregation: given file reviews with mixed pass/violation checks,
  job-level `violated` set and per-practice tallies are correct.
- `getReviewSuggestions` includes per-file `bestPracticeChecks` and job-level
  `bestPractices` when present, and omits/defaults them cleanly when absent.
- `recordBestPracticeDocs` round-trips through the `jobs` column.
- `fetchCloudflareDocResult` + the `search_cloudflare_docs` MCP handler with the
  network `fetch` mocked: returns structured result; `''` on failure.
- Verification gate: `npm run typecheck` + `npm run build` (app-import vitest
  specs are flaky per repo notes).

## Rollout

- Additive columns + additive JSON keys → no consumer breakage.
- Seed the rewritten practice via `scripts/ops/seed-sql-practices.js` →
  generated `.sql` applied through the existing seed mechanism.
- Feature is inert on PRs whose changed files match no active practice.

## Open questions / future

- **Docs query source.** v1 uses the practice `name`. If names prove weak
  queries, add an explicit nullable `docs_query` column to `best_practices`
  (fallback to `name`).
- **Per-finding linkage.** v1 reports checks at practice granularity per file,
  not per individual comment. Per-comment `best_practice_id` tagging is a later
  refinement.
- **PR comment body.** Optionally surface a short violated-practices +
  docs-links block in the review summary. Out of v1.
- **Docs cache.** A cross-PR cache keyed by query (with TTL) would cut repeat
  network calls. Out of v1.
