# Codra Spec 2 — Source-Aware Engines — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Add `ComputerEngine` (@cloudflare/computer on a DO) and `OpenCodeEngine` (Mac via Workers VPC + cloudflared Tunnel) behind the Spec 1 `ReviewEngine` interface, with breaker-aware selection and native fallback, so nothing changes until the infra is provisioned.

**Architecture:** `resolveEngine` (breaker-aware) replaces `selectEngine`; a delegation branch at the top of `runReviewPhase` hands the whole PR to a healthy non-native engine and persists its findings, else falls through to the native metered loop. Spec 2 design: `docs/superpowers/specs/2026-08-07-codra-spec2-source-aware-engines-design.md`.

**Tech Stack:** TypeScript, Cloudflare Workers (Durable Objects, Workers VPC, Containers, KV, Analytics Engine), `@cloudflare/computer`, Drizzle + D1, Vitest, cloudflared, OpenCode.

## Global Constraints

- D1 only; binding `DB` via `getDb(env)`. No Postgres/Hyperdrive. (AGENTS.md)
- Never hardcode base URLs — `env.APP_URL`.
- Findings schema, coordinator, cost model, GitHub posting, native path: unchanged.
- `review.engine` default `auto`; until a non-native engine is provisioned + healthy, `resolveEngine` returns native → zero behavior change.
- Breaker trips only on connectivity/5xx/timeout, never 4xx/auth.
- Agent does NOT run infra provisioning (cloudflared/VPC/Access/Mac daemon/deploy) — those are runbook steps for the user.

---

### Task 1: `resolveEngine` — breaker-aware engine registry + selection

**Files:** Create `src/server/core/engine-registry.ts`; modify `src/server/core/engine-selector.ts` (re-export or replace `selectEngine` → `resolveEngine`); Test `test/engine-resolve.spec.ts`.

**Produces:** `resolveEngine(env, config): Promise<ReviewEngine>` — ordered candidates (`auto`→[opencode,computer,native]; pinned→[pinned,native]); skip a candidate whose `CircuitBreaker` (from `src/server/core/circuit-breaker.ts`, keyed by engine name) is open; else `healthCheck()` with a short timeout; first healthy wins; `NativeEngine` is the always-healthy floor. On healthCheck throw/false → `breaker.recordFailure(nowMs)` and continue. `nowMs` injected (no Date.now in deterministic path — pass from caller).

- [ ] Write `test/engine-resolve.spec.ts`: with all non-native engines' healthCheck=false (or breaker open) → returns native; a healthy `computer` stub with `auto` → returns computer; pinned `opencode` healthy → opencode; pinned `opencode` unhealthy → native; breaker-open candidate skipped without healthCheck call. Use a fake KV + injected engine stubs.
- [ ] Run → fails (module missing).
- [ ] Implement `engine-registry.ts` (a map name→factory) + `resolveEngine`. Engines register lazily; opencode/computer factories construct the real engines from Tasks 2–3 but are only *constructed* when selected.
- [ ] Run → passes; `npm run typecheck`.
- [ ] Commit: `feat(review): breaker-aware resolveEngine with native fallback`.

### Task 2: `OpenCodeClient` — VPC→Tunnel→breaker connectivity

**Files:** Create `src/server/engines/opencode-client.ts`; Test `test/opencode-client.spec.ts`.

**Produces:** `OpenCodeClient` with `health(): Promise<boolean>` and `review(payload): AsyncIterable<string>` (JSONL lines). Tries `env.OPENCODE_VPC` binding fetch first; on connectivity error tries `env.OPENCODE_TUNNEL_URL` with `CF-Access-Client-Id`/`CF-Access-Client-Secret` headers from Secrets Store; on failure throws a retryable error. Auth 4xx is non-retryable (no breaker trip).

- [ ] Write tests (mocked fetch/bindings): VPC success; VPC fail→Tunnel success (asserts Access headers); both fail→retryable throw; 401 from tunnel→non-retryable. JSONL line iteration.
- [ ] Run → fails.
- [ ] Implement.
- [ ] Run → passes; typecheck.
- [ ] Commit: `feat(review): OpenCodeClient VPC→Tunnel connectivity with Access service token`.

### Task 3: `OpenCodeEngine` — delegation + JSONL → EngineReviewResult

**Files:** Create `src/server/engines/opencode-engine.ts`; Test `test/opencode-engine.spec.ts`.

**Produces:** `OpenCodeEngine implements ReviewEngine` (`name:'opencode'`). `reviewPullRequest(ctx)` builds the `{ job, pr, config, sharedContext, files:[{path,patch}] }` payload (patches via `renderFileDiff`), streams JSONL from `OpenCodeClient.review`, parses each line through `parsedReviewCommentSchema`, and returns `EngineReviewResult` (comments + perReviewer usage from the terminal summary line). `healthCheck` → `client.health()`.

- [ ] Tests with a stub client emitting canned JSONL → asserts parsed comments + usage; malformed line skipped (best-effort); health passthrough.
- [ ] Implement. Commit: `feat(review): OpenCodeEngine delegation over JSONL`.

### Task 4: `ComputerEngine` — @cloudflare/computer Workspace on a DO

**Files:** Create `src/server/engines/computer-engine.ts` + the DO class; modify `wrangler.jsonc` (container + DO binding for @cloudflare/computer); Test `test/computer-engine.spec.ts`. Add `@cloudflare/computer` to package.json.

**Produces:** `ComputerEngine implements ReviewEngine` (`name:'computer'`). Instantiate a `Workspace` on the DO; populate the SQLite VFS from the repo tarball at `pr.head.sha`; run the specialized reviewers (`REVIEWERS`/`buildReviewerSystemPrompt`) with read/ls/exec+git tools; escalate to the container backend only when a reviewer needs npm/native tooling. Emit `EngineReviewResult`. `healthCheck` verifies the Workspace/DO is constructible.

- [ ] Tests with a mocked `@cloudflare/computer` (assert repo population + reviewer fan-out + result shape; container escalation stubbed).
- [ ] Implement + wrangler binding + `npm run types`. Commit: `feat(review): ComputerEngine via @cloudflare/computer Workspace`.

### Task 5: Wire the delegation branch into `runReviewPhase`

**Files:** Modify `src/server/core/review.ts` (top of the review phase); Test extend `test/review-flow.spec.ts`.

**Produces:** Before the native per-file loop, `resolveEngine`; if non-native, `engine.reviewPullRequest(ctx)` → persist `result.comments` as file reviews (`engine_used=engine.name`, usage from `perReviewer`), `breaker.recordSuccess()`, enqueue finalize, return. On retryable throw → `breaker.recordFailure` + fall through to native; on non-retryable → log + fall through. Coordinator/finalize unchanged. Preserve the subrequest-budget discipline (a delegated engine is one logical call, not per-file fan-out).

- [ ] Test with a stub non-native engine (returning findings) → asserts native loop skipped, engine_used persisted, finalize enqueued; throwing engine → breaker failure + native fallback.
- [ ] Implement. Commit: `feat(review): delegate PR review to a healthy non-native engine, else native`.

### Task 6: Config, bindings, telemetry breakerState

**Files:** `wrangler.jsonc` (VPC binding `OPENCODE_VPC`, `vars.OPENCODE_TUNNEL_URL`, Secrets Store `OPENCODE_ACCESS_CLIENT_ID/SECRET`); regenerate `worker-configuration.d.ts`; `src/server/core/review-telemetry.ts` + emit site (populate `breakerState` from the resolved engine's breaker); `.dev.vars.example` additions.

- [ ] Test: telemetry datapoint carries the real engine name + breakerState. Commit: `feat(review): Spec 2 bindings + breakerState telemetry`.

### Task 7: Ops runbook + Mac daemon + tunnel config (docs/scripts only — user runs)

**Files:** Create `docs/opencode-setup.md`; `scripts/opencode/` (launchd plist template, cloudflared config template, codra-review OpenCode config, an install script that the USER runs). Update `AGENTS.md` + `README.md` pointers.

**Produces:** A runbook: install/run OpenCode on the Mac (launchd beside codra-jules-watcher), create the cloudflared named tunnel + Access service token, set the Worker secrets/vars, provision Workers VPC, and how `review.engine` selects each engine. Explicitly note the agent does not execute these — they need the user's account/machine.

- [ ] Write docs + templated scripts (no secrets, no execution). Commit: `docs: OpenCode + VPC/Tunnel setup runbook and templates`.

---

## Self-Review

Coverage: interface reuse (Spec 1) → resolveEngine (T1) → OpenCodeClient (T2) → OpenCodeEngine (T3) → ComputerEngine (T4) → live wiring (T5) → bindings/telemetry (T6) → ops runbook (T7). Each engine independently landable; native floor preserves zero-behavior-change until infra is live. `ComputerEngine` is exercisable on Cloudflare without the Mac; `OpenCodeEngine` needs the runbook (T7) provisioned to actually route.

Type consistency: all engines implement `ReviewEngine` (`name`, `reviewPullRequest`, `healthCheck`) and return `EngineReviewResult` from Spec 1. `resolveEngine` returns `ReviewEngine`. Breaker keyed by `engine.name`.

Risk: T4 (@cloudflare/computer container) and T5 (review.ts wiring) are the heavy/high-risk tasks — review them hardest; T5 must preserve the Spec 1 native path and subrequest discipline exactly.
