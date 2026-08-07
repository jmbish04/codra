# Codra Spec 2 — Source-Aware Review Engines — Design

**Date:** 2026-08-07
**Status:** Design approved (decisions locked in Spec 1 brainstorming); implementation in progress on `claude/codra-spec2-engines`.
**Builds on:** Spec 1 (`docs/superpowers/specs/2026-08-07-codra-review-engine-design.md`, shipped in PR #29) — the `ReviewEngine` interface, `selectEngine`, `CircuitBreaker`, and the native review path.

## Goal

Give Codra's reviewers and coordinator **real source access + exec/verification** — the "reproduce the bug / read the whole repo" capability the diff-only native path lacks — via two interchangeable engines behind the existing `ReviewEngine` interface, with graceful degradation:

- **`ComputerEngine`** — runs on Cloudflare using `@cloudflare/computer`: a `Workspace` on a Durable Object with a SQLite virtual filesystem populated from the PR's repo; reviewers/coordinator get read/ls/exec + git tools; a Linux container backend only when a reviewer needs npm/native tooling (<10% of the time). **All on Cloudflare — no Mac dependency.**
- **`OpenCodeEngine`** — an OpenCode server on the user's Mac running a codra-review config that spawns the specialized-reviewer sessions + coordinator. Reached by the Worker via **Workers VPC binding (primary)** with a **cloudflared named Tunnel behind a Cloudflare Access service token (fallback)**.

Selection order (highest available first): **OpenCode → Computer → Native**. The `CircuitBreaker` demotes on connectivity/5xx/timeout (never on 4xx/auth). `review.engine` (`auto|opencode|computer|native`) can pin one; `auto` tries the order and demotes as needed. Everything degrades to the diff-only `NativeEngine` path, which always works.

## Where engines plug in

The live native review runs in `runReviewPhase` → `reviewAndPersistFile` (per-file fan-out inside the metered loop). Spec 2 adds a **delegation branch at the top of the review phase**:

```
runReviewPhase:
  engine = await resolveEngine(env, config)          // breaker-aware, health-checked
  if engine.name !== 'native':
     try:
        result = await engine.reviewPullRequest(ctx)  // whole-PR, returns EngineReviewResult
        persist result.comments as file reviews (engine_used = engine.name, usage from perReviewer)
        breaker.recordSuccess(); enqueue finalize
        return
     catch (retryable connectivity/5xx/timeout):
        breaker.recordFailure(now); log; FALL THROUGH to native loop
     catch (auth/4xx/non-retryable):
        log; FALL THROUGH to native loop (do NOT trip breaker)
  // native metered per-file loop (unchanged Spec 1 path)
```

The coordinator in finalize runs regardless of which engine produced the findings — its inputs are the persisted `parsed_comments`. `EngineReviewResult` already carries `comments` + `perReviewer` usage, so persistence + telemetry are unchanged.

## `resolveEngine` (upgrade of `selectEngine`)

`selectEngine` (Spec 1) always returns `NativeEngine`. Spec 2 replaces it with `resolveEngine(env, config)`:

1. Determine the ordered candidate list from `config.review.engine`: `auto` → `[opencode, computer, native]`; a pinned value → `[<pinned>, native]` (native always the floor unless the pin is `native`).
2. For each non-native candidate: skip if its `CircuitBreaker` is open; else `healthCheck()` (cheap liveness probe, short timeout). First healthy one wins.
3. On a candidate's healthCheck failure → `breaker.recordFailure(now)` and try the next.
4. Fall back to `NativeEngine` (always healthy).

`healthCheck` failures and open breakers are logged to the Analytics datapoint (`breakerState` field, currently `''` in Spec 1).

## `OpenCodeEngine` + `OpenCodeClient`

- **`OpenCodeClient`** encapsulates connectivity: try the **Workers VPC binding** (`env.OPENCODE_VPC`, a private-network service binding) first; on connectivity failure, try the **Tunnel URL** (`env.OPENCODE_TUNNEL_URL`) with Cloudflare Access **service-token** headers (`CF-Access-Client-Id` / `CF-Access-Client-Secret` from Secrets Store bindings `OPENCODE_ACCESS_CLIENT_ID` / `OPENCODE_ACCESS_CLIENT_SECRET`); on failure, throw a retryable error so the breaker trips and the engine demotes.
- **Delegation contract:** `POST /review` with `{ job, pr, config, sharedContext, files: [{ path, patch }] }` (per-path patches, matching the blog's on-disk-patch token optimization). OpenCode streams back **JSONL** — one finding per line conforming to `parsedReviewCommentSchema` (plus a terminal summary line with per-reviewer usage). `OpenCodeEngine.reviewPullRequest` parses the JSONL stream into `EngineReviewResult`.
- **`healthCheck`:** `GET /health` over VPC (or Tunnel), 2s timeout.

## `ComputerEngine`

- Uses `@cloudflare/computer`: instantiate a `Workspace` on a Durable Object; populate the SQLite VFS from the PR repo (GitHub tarball at `pr.head.sha`, or `git clone` via the git tool). Expose read/ls/exec + git tools to the specialized reviewers (same `REVIEWERS`/`buildReviewerSystemPrompt` prompts as native) and to the coordinator's source-verification. Use the isolate backend for file reads/greps; escalate to the container backend only when a reviewer runs npm/native tooling.
- Emits the same `EngineReviewResult`. `healthCheck`: verify the DO/Workspace can be created and the package is bound.
- Requires a `wrangler.jsonc` container + DO binding for `@cloudflare/computer`.

## Config / bindings / secrets

- `wrangler.jsonc`: add the Workers VPC service binding (`OPENCODE_VPC`), a `vars` entry `OPENCODE_TUNNEL_URL`, Secrets Store bindings `OPENCODE_ACCESS_CLIENT_ID`/`OPENCODE_ACCESS_CLIENT_SECRET`, and the `@cloudflare/computer` container + DO binding. Regenerate `worker-configuration.d.ts`.
- No new D1 columns (engine_used already exists from Spec 1). No Postgres (AGENTS.md).
- Breaker state already in KV (`breaker:<name>`), keyed by engine name.

## Ops (user's machine + Cloudflare account — code + docs delivered; user runs)

- **OpenCode on the Mac:** a launchd service (beside the existing `~/codra-jules-watcher`) running the OpenCode server + a codra-review config/plugin defining the reviewer sessions. Setup script + README.
- **cloudflared Tunnel:** named tunnel `codra-opencode` → `http://localhost:<opencode-port>`, protected by a Cloudflare Access application with a **service token** (the Worker presents the token). Config file + steps.
- **Workers VPC:** private-network setup connecting the Worker to the Mac's OpenCode service. Steps (account-gated).
- These infra steps require the user's credentials/machine and are **not** run by the agent — the deliverable is the scripts + a `docs/opencode-setup.md` runbook.

## Testing

- `resolveEngine`: unit tests for candidate ordering (`auto` vs pinned), breaker-open skip, healthCheck-fail demotion, native floor — all with mocked engines + a fake KV breaker.
- `OpenCodeClient`: VPC→Tunnel fallback + breaker trip, with mocked `fetch`/bindings; Access header injection; JSONL parse.
- `ComputerEngine`: mocked `@cloudflare/computer` Workspace — assert repo population + reviewer fan-out + `EngineReviewResult` shape; container-escalation path stubbed.
- Delegation branch in `runReviewPhase`: with a stub engine returning findings, assert persistence with `engine_used` set and native loop skipped; with a throwing engine, assert breaker.recordFailure + native fallback.
- Verify via `npm run typecheck` + `npm test` (D1-only harness; known orchestrator.ts quirk).

## Rollout / safety

- All behind `review.engine` (default `auto`). Until an OpenCode server or the Computer container is actually bound + healthy, `resolveEngine` falls to native — **zero behavior change on merge**. The engines light up only when their infra is provisioned and healthChecks pass.
- Each engine is independently landable; `ComputerEngine` (all-Cloudflare) can ship + be exercised before the Mac/OpenCode infra exists.

## Non-goals

- No change to the findings schema, coordinator, cost model, GitHub posting, or the native path.
- No auto-provisioning of the user's Mac daemon, cloudflared, VPC, or Access — those are documented runbook steps the user performs.
- Not building a bespoke agent runtime — reuse OpenCode and `@cloudflare/computer`.
