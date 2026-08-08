# Codra Review Engine Upgrade — Design

[Return to Index](../../README.md)

**Date:** 2026-08-07
**Status:** Approved for Spec 1 implementation
**Source material:**
- https://blog.cloudflare.com/ai-code-review/ (specialized reviewers, coordinator, caching, circuit breaker, injection defense)
- https://blog.cloudflare.com/agent-development-lifecycle/ (observability, reproducibility, event-driven, atomic/reversible)
- https://blog.cloudflare.com/cloudflare-computer/ (`@cloudflare/computer` — isolate/container agent runtime with a SQLite virtual filesystem)

## Goal

Bring Cloudflare's production AI-code-review methodology into Codra's existing
Cloudflare Workers + D1 pipeline, without regressing the current per-file review,
and lay the seam for source-aware review runtimes (local OpenCode, on-Cloudflare
`@cloudflare/computer`) to slot in later.

## Current state (baseline)

- `src/server/core/review.ts` orchestrates a job through `prepare → review →
  finalize → changelog` phases over Cloudflare Queues, with a DO lease/heartbeat.
- `ModelService` (`src/server/services/model.ts`) reviews **one file at a time**
  with a **single generalist prompt** (`src/server/prompts/file-review.ts`) that
  asks one model to cover bugs + security + performance + quality + docs at once.
- Model choice: `selectModel()` picks by diff line count (`size_overrides`) with
  an ordered `fallbacks` chain. No circuit breaker, no provider-health state.
- `finalize` filters findings by `min_severity`, sorts, caps at `max_comments`.
  **No cross-finding dedup, no false-positive/reasonableness pass, no source
  verification.**
- Diff filter (`filterReviewableFiles`) skips lock files, `*.min.js`, and
  `skip_files` globs. **No `@generated` detection, no migration carve-out.**
- PR title/body/comments are injected into prompts **unsanitized**.
- No prompt caching (`cache_control`). Project context is re-embedded per file.
- Findings schema (`fileReviewModelOutputSchema`) and severity taxonomy
  (`P0/P1/P2/P3/nit` + `reviewCategories`) are already structured JSON — keep them.

## Architecture: one `ReviewEngine` interface, three implementations

A new `ReviewEngine` seam is introduced. Review/finalize phases call the engine
rather than `ModelService` directly. All engines emit the **same**
`fileReviewModelOutputSchema` findings, so persistence, costing, streaming, and
the dashboard are untouched.

```
                 ┌─ engine selector (KV circuit breaker + review.engine) ─┐
webhook→queue→job│  OpenCodeEngine  (local Mac, VPC/Tunnel)   [Spec 2]     │→ findings → persist → GitHub review
                 │  ComputerEngine  (@cloudflare/computer, DO) [Spec 2]     │
                 │  NativeEngine    (in-Worker, diff + blobs)  [Spec 1]     │
                 └─────────────────────────────────────────────────────────┘
```

Selector prefers the highest available engine; the circuit breaker demotes on
connectivity/5xx/timeout only (never on auth/4xx). Order: OpenCode → Computer →
Native. Mac down ⇒ stays on Cloudflare. Everything down ⇒ diff-only Native still
reviews. `review.engine ∈ {auto, opencode, computer, native}` (default `auto`)
can pin an engine.

### `ReviewEngine` interface (both specs implement it)

```ts
interface ReviewEngine {
  readonly name: 'opencode' | 'computer' | 'native';
  // Whole-PR review: engine decides how to fan out reviewers internally.
  reviewPullRequest(ctx: ReviewContext): Promise<EngineReviewResult>;
  // Cheap liveness probe used by the selector/breaker.
  healthCheck(): Promise<boolean>;
}
```

`ReviewContext` carries the shared MR-context block (see C), per-path patches,
resolved `RepoConfig`, and the reviewer/risk-tier plan. `EngineReviewResult`
carries findings (schema-conformant), per-reviewer token/cache usage, and the
coordinator's dedup/verification decisions for telemetry.

---

## Spec 1 — Native engine + observability (infra-free, ships now)

Everything here runs inside the existing Worker with no new external dependency.
`NativeEngine` wraps and upgrades today's `ModelService` behavior.

### D — Prompt-injection defense (security, low effort)

`sanitizeForPrompt(text)` in a new `src/server/core/prompt-safety.ts`: neutralizes
the XML/section boundary tags the pipeline uses to structure prompts, so
attacker-controlled PR text cannot forge structure. Tag set (mirrors the blog):
`<mr_input> <mr_body> <mr_comments> <mr_details> <changed_files>
<existing_inline_findings> <previous_review> <custom_review_instructions>
<project_context> <shared_context>`. Neutralization = escape the angle brackets
of any occurrence of these tags (opening/closing), leaving human-readable text
intact. Applied to: PR title, PR body, PR comments, `custom_rules`, and any
review threads before they enter a prompt (file-review, summary, coordinator).

**Test:** feed a body containing `</shared_context>` + a forged reviewer
instruction; assert the tag is escaped and the injected instruction does not
appear as a live tag boundary in the assembled prompt.

### F — Diff filter: `@generated` + migration carve-out (noise, low effort)

In `src/server/core/diff.ts`:
- Add generated-marker detection: a file whose added content contains
  `@generated` or `@codegen` (first N lines) is skipped **unless** it matches a
  migration path.
- Migration carve-out: paths under `**/migrations/**`, `db/migrations/**`, or
  `**/*.sql` inside a migrations dir are **always reviewed**, even if marked
  generated (matches the blog's explicit exception).

**Test:** a `@generated` TS file is filtered out; a `@generated` migration under
`db/migrations/d1/` is retained.

### A — Specialized reviewers with explicit IGNORE lists (core lever)

Replace the single generalist system prompt with scoped reviewer definitions in
`src/server/prompts/reviewers.ts`. Each reviewer has: an `id` (reuses
`reviewCategories`: `security | bugs | performance | correctness | quality`, plus
`docs`), a tightly scoped **DO look for** list, and — critically — an explicit
**IGNORE / not your job** list so it stays in lane and defers overlapping
concerns to the owning reviewer. Each emits the existing
`fileReviewModelOutputSchema`, tagging `category` with its own id.

**Risk-tier scaling (G, folded in):** reviewer set scales with PR size, then is
intersected with `review.focus`:
- **trivial** (≤10 changed lines): `security`, `correctness` (2)
- **lite** (≤100 lines): + `bugs`, `performance` (4)
- **full** (>100 lines or >`max_files`/2 files): + `quality`, `docs` (5)

Reviewers run per file across the tier's set. Concurrency respects the existing
`TokenTracker` subrequest budget (≤50, safe-margin 22); when the budget is tight,
the batch path or sequential fallback already in `review.ts` applies. Reviewer
prompts are byte-stable (no per-file interpolation in the system prompt — see C).

**Test:** a trivial diff plans exactly `{security, correctness}`; a 500-line diff
with `focus: [security]` plans exactly `{security}` (tier ∩ focus).

### C — Prompt caching + shared context (cost)

- **Shared MR-context block:** build once per job — sanitized PR title/desc,
  sanitized project context, sanitized `custom_rules`, declared stack — as a
  single `sharedContext` string on `ReviewContext`. Reviewers reference it
  instead of each re-embedding project context per file.
- **`cache_control`:** convert the Anthropic `system` field to block form and set
  `cache_control: { type: 'ephemeral' }` on (1) the stable reviewer system prompt
  and (2) the shared-context prefix. Provider-equivalent handling for OpenAI/
  Google/Workers-AI where supported; a no-op where not. Base prompts kept
  byte-identical across runs to maximize hit rate.
- **Usage:** extend `AnthropicResponse.usage` with `cache_creation_input_tokens`
  / `cache_read_input_tokens`; thread them through `ModelResponse`,
  `TokenTracker` (new `cacheRead`/`cacheWrite` counters), and cost metering.

**Test:** assembled Anthropic body has `system` as an array with a
`cache_control` breakpoint on the reviewer prompt and on the shared-context
block; cache token fields are recorded when present in the response.

### B — Coordinator (signal/noise)

New finalize sub-step in `src/server/core/coordinator.ts`, run after all
reviewers finish, before the severity/`max_comments` cap. One coordinator-model
call (config `review.coordinator` model override; defaults to the job's main
model) that:
1. **Dedups** findings addressing the same defect across reviewers/files.
2. **Re-categorizes** misplaced findings to the correct `category`.
3. **Reasonableness filter:** drops speculative / likely-false-positive findings.
4. **Source verification (Spec 1 scope):** for low-`confidenceScore` findings,
   fetches the referenced file via the **GitHub contents API** (no sandbox) and
   confirms the finding against real surrounding source; unconfirmed → dropped.

Output = pruned, deduped comment set; existing `min_severity` + `max_comments`
logic in `runFinalizePhase` then applies unchanged. Coordinator is best-effort:
on model/API failure it logs and passes findings through un-coordinated (never
fails the review). Coordinator input is itself sanitized (D).

**Test:** two reviewers reporting the same line/defect collapse to one;
a finding whose referenced source (stubbed contents API) contradicts it is
dropped; coordinator model error ⇒ original findings pass through.

### Circuit breaker (resilience, shared with Spec 2)

`src/server/core/circuit-breaker.ts`, provider/engine health in KV
(`breaker:<name>` → `{ state: closed|open|half-open, failures, openedAt }`).
Closed→Open after 5 consecutive retryable failures (429/503/timeout/
connectivity); Open→Half-open after a 60s cooldown; a single Half-open success ⇒
Closed, a Half-open failure ⇒ Open (reset cooldown). **Auth/4xx never trip it.**
Thresholds are module constants (not yet config-surfaced — YAGNI until tuning
demands it).
Used by the engine selector (Spec 2) and by `ModelService` fallback selection so a
sick provider is skipped fast instead of retried every file. In Spec 1 the only
engine is Native, so the breaker guards provider health and pre-wires engine
selection.

### Observability (ADLC + ai-code-review)

- **Analytics Engine** binding `REVIEW_ANALYTICS`: one datapoint per completed
  review — blobs `{repo, engine, reviewers, verdict, breakerState}`, doubles
  `{findings, findingsBySeverity…, inputTokens, outputTokens, cacheReadTokens,
  cacheWriteTokens, cacheHitRate, costUsd, durationMs}`. Fire-and-forget.
- **JSONL step traces:** each reviewer + coordinator step logs one self-contained
  JSON line (`{jobId, phase, reviewer, model, tokens, cache, durationMs, findings}`)
  to Workers Logs — replayable for evals.
- **Heartbeat:** a 30s "reviewing… (model thinking)" heartbeat on the check-run/
  log during long reviews, extending the existing lease heartbeat, to prevent
  false "hung job" reports.

### Config & data changes (Spec 1)

- `reviewConfigSchema`: add `engine: z.enum(['auto','opencode','computer',
  'native']).default('auto')`, `coordinator: z.string().nullable().default(null)`
  (model id override), optional `risk_tiers` override of the line thresholds.
- Migration: add `engine_used`, `cache_read_tokens`, `cache_write_tokens` columns
  to the file-review / cost rows (nullable; back-compatible).
- `wrangler.jsonc`: add the Analytics Engine dataset binding.
- No new secret. No Postgres/Hyperdrive (per AGENTS.md). D1 only.

### Testing strategy (Spec 1)

Deterministic unit tests with a **stub model service** (existing
`createTestEnv()` + in-memory D1 harness): sanitize, diff-filter carve-out,
reviewer-plan (tier ∩ focus), cache-control payload shape, coordinator
dedup/verify/passthrough, breaker state transitions. One end-to-end review-job
test through `NativeEngine` with a fake model asserting engine selection, findings
persistence, and an Analytics datapoint emitted. Verify via `npm run typecheck`
+ `npm test` (note: app-import specs have a known pre-existing orchestrator.ts
vitest quirk — rely on typecheck + targeted specs, per project memory).

### Atomicity / rollout (ADLC)

Each lettered change is an independently landable, reversible commit behind
config defaults that preserve current behavior until flipped:
`D → F → C → A → B → observability`. `review.engine` defaults to `auto`, which in
Spec 1 resolves to `native` (only engine present), so no behavior change until an
operator opts in.

---

## Spec 2 — Source-aware brains (follow-up; needs Mac + CF account setup)

Separate spec/plan/build. Sketched here to show the seam Spec 1 leaves.

- **`ComputerEngine`** — `@cloudflare/computer` `Workspace` on a Durable Object:
  populate the SQLite virtual filesystem from the PR's repo (GitHub tarball / git),
  expose read/ls/exec + git tools to the specialized reviewers and the coordinator
  so verification reads real source and can reproduce/run checks; container backend
  only when a reviewer needs npm/native tools (<10% target). All on Cloudflare — no
  Mac dependency. Same `ReviewEngine` interface + findings schema.
- **`OpenCodeEngine`** — OpenCode server on the Mac (launchd, beside the existing
  jules-watcher daemon) running a codra-review config that spawns the specialized
  reviewer sessions + coordinator. Reached by the Worker via **Workers VPC binding
  (primary)** with a **cloudflared named Tunnel behind a Cloudflare Access service
  token (fallback)**. `OpenCodeClient`: VPC → Tunnel → breaker → demote to
  `ComputerEngine`/`NativeEngine`. Delegation contract: Worker POSTs per-path
  patches + shared context; OpenCode streams JSONL findings in the same schema
  (matches the blog's on-disk-patch token optimization).
- Selector + circuit breaker from Spec 1 already handle demotion across all three.

## Non-goals

- No change to the findings schema, severity taxonomy, GitHub review posting,
  cost model, or dashboard contracts.
- No Postgres/Hyperdrive/external RDBMS (D1 only, per AGENTS.md).
- No speculative building of Spec 2 engines before Spec 1 ships and is verified.
