# Architecture

[Return to Index](./README.md)

Codra is a self-hosted AI code review tool built natively for Cloudflare Workers.

## Stack Overview
- **Worker**: Cloudflare Workers, Hono, Wrangler
- **Dashboard**: React, Vite, Tailwind CSS, Radix UI, Recharts
- **Data**: Cloudflare D1 (SQLite), Cloudflare KV
- **Queues**: Cloudflare Queues with DLQ workflows
- **Models**: Integration with OpenAI, OpenRouter, Anthropic, Google, and Cloudflare providers.

Codra processes GitHub webhooks securely, queues jobs, and executes LLM-driven reviews against pull request diffs, posting results inline to GitHub.

## Review engine

The review pipeline delegates PR analysis to pluggable `ReviewEngine` implementations, each capable of orchestrating multiple specialized reviewers. All engines conform to the `ReviewEngine` interface (`src/server/core/review-engine.ts`):

```ts
interface ReviewEngine {
  readonly name: 'opencode' | 'computer' | 'native';
  reviewPullRequest(ctx: ReviewContext): Promise<EngineReviewResult>;
  healthCheck(): Promise<boolean>;
}
```

**Spec 1 (shipped):** `NativeEngine` executes reviews in-Worker with no external dependencies. It inherits the existing diff-based review loop and upgrades it with specialized reviewers, prompt caching, and coordinator deduplication.

**Spec 2 (planned):** OpenCode (local Mac via VPC + Tunnel) and ComputerEngine (@cloudflare/computer) delegate review to source-aware runtimes. See `docs/superpowers/specs/2026-08-07-codra-review-engine-design.md` for the full design.

### Engine selection

`selectEngine()` in `src/server/core/engine-selector.ts` chooses an engine based on `config.review.engine` (defaults to `auto`). In Spec 1, only NativeEngine is available; Spec 2 introduces a KV-backed circuit breaker that demotes failed engines after 5 consecutive connectivity/429/503/timeout failures with a 60-second cooldown. The selector picks the highest available engine in order: OpenCode → Computer → Native. Native is always available and always works on diffs.

### Specialized reviewers & risk tiers

Six reviewers analyze each file:

- **Security**: injection, auth bypasses, hardcoded secrets, SSRF, unsafe deserialization, sensitive data leaks
- **Bugs**: logic errors, null/undefined dereferences, off-by-one, unhandled rejections, incorrect error handling
- **Performance**: N+1 queries, O(n²)+ hot paths, unbounded memory growth, blocking I/O, missing pagination
- **Correctness**: contract misuse, race conditions, state transitions, data-loss risks, broken invariants
- **Quality**: dead code, duplicated logic, unclear control flow, maintainability hazards
- **Docs**: missing JSDoc on exported items, complex blocks without explanatory comments

Each reviewer has an explicit IGNORE list to avoid overlap. Reviewer set scales with PR size via risk tiers (`config.review.risk_tiers`):

- **Trivial tier** (up to `trivial_max_lines`, default 10): security + correctness only
- **Lite tier** (up to `lite_max_lines`, default 100): add bugs + performance
- **Full tier** (above lite): add quality + docs

The active reviewer set is intersected with `config.review.focus` (which categories to check). The `docs` reviewer maps to the `quality` category, so it passes the focus filter whenever `focus` includes `quality` (which it does by default).

### Coordinator pass

After all reviewers report findings, `coordinateFindings()` in `src/server/core/coordinator.ts` runs a single-call dedup + reasonableness + source-verification pass:

1. **Dedup**: collapse findings addressing the same defect, keep the clearest
2. **Drop false positives**: remove speculative or likely-wrong findings
3. **Source verify**: for low-confidence findings (score < 0.6), fetch source context (±20 lines) and verify the finding against actual code

The coordinator is best-effort: any model error returns findings unchanged so reviews are never lost. Uses `config.review.coordinator` (model override) if provided.

### Prompt caching & shared context

All reviewer calls within a job share a constant `sharedContext` block (PR title, body, custom rules, project context) that is sent to Anthropic with `cache_control: ephemeral`. This amortizes the caching overhead across all reviewers in the PR. Built by `buildSharedContext()` in `src/server/core/shared-context.ts`.

Prompts are sanitized against injection attacks via `sanitizeForPrompt()` in `src/server/core/prompt-safety.ts`, which escapes XML tag boundaries in PR text, comments, custom rules, and other user inputs.

### Native engine implementation details

Within the existing metered review loop (`src/server/core/review.ts`), the native engine:

1. Plans reviewers per-file based on PR size and risk tiers
2. Fans out the planned reviewers for each file, staying within subrequest budget (`selectFilePlanForBudget()` in `src/server/core/reviewer-plan.ts`)
3. Batches Durable Object comment streaming to one fetch per file
4. Runs the coordinator pass on all findings once the file batch completes
5. Is subrequest-budget-aware to avoid spilling into multiple queue chunks

Token usage (input, output, cache read, cache write) is tracked per reviewer and persisted for cost accounting. Cost is calculated per-file and emitted to Analytics Engine.

### Config knobs

- `review.engine`: `auto|opencode|computer|native` (default `auto` → native in Spec 1). Pins engine selection.
- `review.coordinator`: model ID override for the coordinator pass (e.g., `claude-opus-4`). Defaults to the same model as file reviews.
- `review.risk_tiers`: object with `trivial_max_lines` (default 10) and `lite_max_lines` (default 100). Sets the thresholds for reviewer fan-out.

Auto reviews (no explicit `@mention`) are capped at 3 per PR and only trigger on human (non-bot) pushes. Explicit `@mention` reviews bypass the cap. Both are tracked via `extractReviewRequest()` guards and counted with `countAutoReviewsForPr()`.

### Observability

Review metrics are emitted to Analytics Engine (`REVIEW_ANALYTICS.writeDataPoint()`), per review:

- Engine used, verdict, circuit breaker state
- Finding counts by severity (P0, P1)
- Total input/output tokens, cache read/write tokens, cache hit rate
- Cost in USD, duration in ms

Individual reviewer steps are logged as JSON lines (`logReviewStep()`) to Workers Logs, including phase, model, timing, findings, and token usage.