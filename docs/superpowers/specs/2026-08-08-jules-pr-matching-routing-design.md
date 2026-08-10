# Jules PR Recognition, Matching & Cost-Aware Routing — Design

- **Date:** 2026-08-08
- **Branch:** `claude/jules-pr-matching-routing-745082`
- **Status:** Approved design, pre-implementation
- **Related migration:** `0029` (next after `0028_loud_puff_adder.sql`)

## Problem

Codra stages Jules sessions (docstring/docs-gap fill) at review time and launches
them on PR merge. Jules eventually opens a PR whose body reads:

> `PR created automatically by Jules for task [6837743215401320221](https://jules.google.com/task/6837743215401320221)`

Two failures today:

1. **No recognition / routing.** When that PR arrives, Codra either does nothing
   useful (Jules is a bot, so `isBotSender` drops it before any review job) or
   would blindly run a full AI review — which costs money and is wrong for a
   docstring task Codra itself commissioned.
2. **Runaway duplicate sessions.** The same docs-gap task is re-launched over and
   over (observed: PRs #27, #28, #34, #35, #36 — all "close documentation gaps").
   Nothing checks whether an equivalent Jules session is already outstanding
   before spawning another. This is the Jules-session form of the prior
   "$700 blocking-loop" incident and will exhaust Workers execution and
   AI-budget limits.

## Goals

- Recognize Jules-authored PRs at webhook time and match them to the originating
  `jules_sessions` row, filling `created_pr_number` immediately (not on a delayed
  cron poll).
- Classify each Jules PR into an explicit category and route deterministically,
  **without** triggering a paid AI review unless the category and repo config
  justify it.
- Stop the runaway duplicate sessions before spawning new ones.
- Persist the full Codra↔Jules interaction ledger (both directions) so Codra can
  audit what it asked Jules to do and what Jules did.

## Non-goals

- Detecting *human-vs-CI* origin from the Jules SDK. Proven impossible in
  `@google/jules-sdk@0.2.0` (see SDK Ground Truth). We proxy it via GitHub CI
  presence instead.
- Reworking the existing standard review flow for non-Jules PRs.
- A full mention-command grammar (`@codra-app` remains a single-action trigger).

## SDK Ground Truth (`@google/jules-sdk@0.2.0`)

Verified against both the installed `dist/*.d.ts` and the pinned upstream source.
Recorded here so no one re-adds hallucinated fields later.

- **`SessionResource` fields:** `name, id, prompt, sourceContext, source?, title,
  requirePlanApproval?, automationMode?, createTime, updateTime, state, url,
  outputs, activities?, outcome, generatedFiles?, archived`.
- **No `origin` / `creator` on the session.** `Origin = 'user' | 'agent' |
  'system'` is the **activity** originator (`Activity.originator`), documented as
  "the entity an activity originates from." It does **not** encode WEB_UI-vs-API.
- **`automationMode = 'AUTOMATION_MODE_UNSPECIFIED' | 'AUTO_CREATE_PR'`** — auto-PR
  vs interactive. CI jobs, API scripts, and Codra all use `AUTO_CREATE_PR`, so it
  does **not** separate manual from CI. Stored for telemetry only.
- **`SourceContext`** = `{ source, githubRepoContext?: { startingBranch },
  workingBranch?, environmentVariablesEnabled? }`. No PR number, no trigger
  labels, no CI metadata.
- **`PlanStep = { title, description? }`** — **no `files`.** Targeted files are not
  in the plan; only available post-completion via `generatedFiles()`, or from
  Codra's own prompt.
- **Usable:** `client.sessions({ filter })` lists/iterates sessions (AIP-160
  filter, `for await`, `.all()`, `limit`). Currently unused by Codra; available
  as a secondary reconcile.
- **Currently called:** `sources.get`, `session({...})` create, `session(id).info()`,
  `.ask()`, `.snapshot({activities:true})`, `.send()`.

**Consequence:** Session ownership and category are decided from **Codra's own D1**
(deterministic) and **GitHub CI status** (deterministic), never from Jules session
metadata.

## Category model

Explicit `category` enum column on `jules_sessions`. Values:

| Value | Meaning | How stamped |
|-------|---------|-------------|
| `INTERNAL_CODRA` | Session Codra created (docs-gap/docstring, or future kinds) | Stamped at stage/launch time. |
| `EXTERNAL_CI` | Non-Codra Jules PR in a repo that **has** CI configured | Stamped at webhook match time when no Codra row matches **and** the PR/repo has ≥1 check/workflow. |
| `EXTERNAL_MANUAL` | Non-Codra Jules PR in a repo with **no** CI | Stamped at webhook match time when no Codra row matches **and** the repo has no CI. |

`EXTERNAL_MANUAL`/`EXTERNAL_CI` reflect **CI presence**, not a claim about who (human
or robot) started the Jules session — the SDK can't tell us that. This is a
deliberate, documented proxy.

## Pieces & sequencing

Ship order: **P0 + P3 → P1 + P2 → P4 → P5.** Stop the bleeding, then build pipes.

### P0 — Session ledger completeness (foundation)

**Migration `0029`** adds to `jules_sessions`:

- `category` (text, NOT NULL) — enum above. Required on insert.
- `kind` (text, NOT NULL, default `'docs'`) — Cat 3 subcategory. Only `docs`
  today; the column exists so P4 routing and dedup can disambiguate when future
  internal kinds are added (per the "could be more in the future" requirement).
- `target_files` (json, default `[]`) — files Codra scoped the task to. Codra
  already computes these in the docs-gap analysis (`core/jules-docs-gap.ts`);
  persist them at stage time instead of leaving them buried in `prompt` text.
- `automation_mode` (text, nullable) — telemetry from `SessionResource.automationMode`.

**Inbound interaction capture.** `jules_interactions` already supports
`direction:'inbound'` and `note`/`clarify` kinds but only outbound rows are ever
written. The poller (`services/jules-poller.ts`) already reads snapshots and the
latest agent message — persist those as `direction:'inbound'` rows so the ledger
is complete in both directions.

### P3 — Dedup before launch (stops the runaway)

Before staging or launching a docs session, query D1 for an **outstanding**
equivalent:

```
SELECT ... FROM jules_sessions
WHERE owner = ? AND repo = ?
  AND category = 'INTERNAL_CODRA'
  AND kind = 'docs'                     -- task kind (docs-gap/docstrings)
  AND state IN ('staged','launched')
  AND created_pr_number IS NULL         -- no PR filed yet ⇒ still outstanding
```

- **Found** → do **not** create a new session. Send the delta to the existing
  session via `sendJulesMessage(session_id, ...)`, log it in `jules_interactions`
  (kind `improve`), and skip the new row.
- **Not found** → proceed with the normal stage/launch.

D1 is the source of truth. `client.sessions({ filter })` may be used as a periodic
reconcile to catch sessions that closed out-of-band, but is not required for the
primary dedup check. A hard cap on concurrent outstanding Codra sessions per repo
backstops the loop (idempotency, not a blocking retry loop — see Loop Prevention).

### P1 — Webhook match & route

**Correction (verified against a real Jules PR):** Jules opens PRs as the
**authenticating user** (e.g. `jmbish04`, `is_bot: false`), *not* as
`google-labs-jules[bot]`. So the `isBotSender` gate (`review.ts:254`, on
`payload.sender`) does **not** divert them — a Jules docs PR opened today flows
straight into the standard paid AI review. P1's diversion is therefore a real
cost saver, not just bookkeeping.

Hook in the `pull_request` branch of `routes/webhook.ts` near the existing
`markPrReadyByUrl` fast-path (147–151), i.e. **before** `extractReviewRequest`
queues a job:

1. **Detect a Jules PR** by content, not author:
   - `payload.pull_request.body` matches `jules\.google\.com/task/(\d+)`, **or**
   - `payload.pull_request.head.ref` (branch) starts with `jules-` and ends
     `-(\d+)`.
   Extract `taskId` (the trailing digits; body and branch agree on it).
2. **Match** `taskId` against `jules_sessions.session_id` via a new
   `findJulesSessionBySessionId(env, sessionId)` query. **Tolerant:** on any miss
   or malformed id, log and treat as external — never throw, never block the
   webhook.
   - **Match → `INTERNAL_CODRA` (Cat 3).** Immediately set `created_pr_number` /
     `created_pr_url` on that row (fills the async-poller gap; also promptly drops
     the session out of the "outstanding fold sink" set). **Divert:** do not let
     the standard review job be created for this PR (return before/around
     `extractReviewRequest`). Route to **P4** (deferred slice).
   - **No match → external.** Insert a lightweight `jules_sessions` row
     (`category` = `EXTERNAL_CI` or `EXTERNAL_MANUAL` per CI presence). Route to
     **P2**. In the P1-only slice, external PRs are recorded and left to the
     normal flow (no behavior change yet); P2 adds the cost-aware routing.

The `taskId == session_id` join is the one assumption not verifiable offline
(both are the same big integer in the example, and our `session_url` is
`.../session/<id>`); the tolerant matcher above degrades safely if it turns out
otherwise, and we confirm on the next real launched Jules PR.

### P2 — Cost-aware routing

**Reconciled with #36's toggle model.** #36 replaced the blanket
`enabled === false` gate with a three-column per-repo toggle set on
`repo_configs` (`enabled` = Code Review, `docstring_enabled`, `toolbox_enabled`),
surfaced as `RepoCheckFlags` and turned into a `jobs.scope`
`{codeReview, docstring, toolbox}`. P2 follows that exact pattern rather than the
old JSON `external_jules` block:

- Add an `external_jules_enabled` **column** to `repo_configs` (migration,
  `integer boolean NOT NULL DEFAULT 0` = off), threaded through
  `db/repo-configs.ts`, `CachedConfig`/`loadRepoConfig` (`core/config.ts`), and
  `RepoCheckFlags` (`review.ts`), mirroring `docstring_enabled`.
- Routing an external Jules PR to review = creating a normal
  `scope = { codeReview: true }` job for it (bypassing the content-diversion from
  P1), gated by `external_jules_enabled` AND the CI signal below.
- `@codra-app review` continues to force a review regardless (already wired
  through the mention grammar).

Routing decision table for a matched Jules PR:

| Category | Condition | Action |
|----------|-----------|--------|
| `INTERNAL_CODRA` | always | P4 specialized verification (not standard review) |
| external | `external_jules_enabled` off | label + no-op |
| external | opted-in, **no CI** configured | trigger AI review on open |
| external | opted-in, CI present, checks **passing** | no-op (wait) |
| external | opted-in, CI present, checks **failing** | trigger AI review |
| any | user posts `@codra-app review` | trigger review (always, overrides toggles) |

**New webhook events required:** `check_run`, `check_suite`, `workflow_run`, `status`.
Currently none are handled (`shared/github.ts` union + `routes/webhook.ts` dispatch).
Add them to the supported union and dispatch. Add a `getCombinedStatus` /
check-runs read to `core/github.ts` (Codra writes its own check-run today but never
reads incoming CI).

**CI-presence detection (avoid the open-time race).** Check runs may not be posted
at the instant a PR opens, so "no checks on the PR right now" ≠ "repo has no CI."
Determine CI presence from the **repo's configuration**, not the instantaneous PR
check list: repo has ≥1 enabled Actions workflow (`GET /repos/{o}/{r}/actions/workflows`)
**or** a required status check on the base branch's protection. Only when that says
"no CI configured" do we review an external PR on open; otherwise we defer to the
failure webhook.

The failing-CI path is edge-triggered: on PR open with CI present we defer; the
`check_run`/`workflow_run` `completed` + `conclusion: failure` webhook is what later
triggers the review, so we never poll and never pay for a passing build.

### P4 — Cat 3 verification + dual feedback loop

For a matched `INTERNAL_CODRA` PR:

1. Load the session's `prompt`, `gap_summary`, `target_files` from D1
   (+ `getJulesSnapshot` for activities if needed). Fetch the PR diff.
2. **One** LLM pass: did Jules complete the docstring task on the target files?
   Any gaps, ignored instructions, or stuck/partial work?
3. **Complete** → approve + label. Cheap. Done. (No full review.)
4. **Gaps** → generate follow-up instructions, delivered **two ways** (both
   required, because Jules ignores `codra-github-manager` bot comments and only
   acts on the authenticating user's messages):
   - **GitHub:** `createIssueComment` (PR conversation) + inline `createReview`
     suggestions on the specific file/line where relevant.
   - **Jules SDK:** `sendJulesMessage(session_id, instructions)` — the reliable
     path to Jules.
   - Log both as `jules_interactions` (kind `correction`).

### P5 — Settings UI (last, optional)

Surface `review.jules.enabled` and the new `review.external_jules` toggles on the
repos settings page. The PATCH API (`routes/api/repos.ts`) already accepts `review`
patches; only the form control is missing today.

## Loop prevention & idempotency

- **Webhook idempotency:** delivery IDs are already deduped; the match/route path
  must be idempotent — re-delivery of the same `pull_request.opened` must not
  double-insert a session row or re-trigger review (guard on
  `created_pr_number` already set / existing external row).
- **No blocking loops in a Durable Object.** All matching/routing runs in the
  webhook handler + queue consumer against D1, consistent with the prior
  "$700 incident" lesson. Dedup + a per-repo outstanding-session cap prevent
  runaway launches. No long-lived agent loop, no heavy DO storage.
- **Cost-aware default:** external review defaults OFF; CI-present PRs defer to the
  failure webhook rather than eagerly reviewing.

## Data & config changes summary

- **D1 migration `0029`:** `jules_sessions.category` (req), `.kind` (req, default
  `'docs'`), `.target_files` (json), `.automation_mode` (nullable). Generate via
  `npm run db:generate`; apply via
  `npm run migrate:local` (local/preview) then `npm run migrate` (remote).
  *(Note: there is no `migrate:db` script.)*
- **Schema:** `reviewConfigSchema.external_jules { enabled, require_failing_checks }`.
- **Webhook events:** add `check_run`, `workflow_run`/`check_suite`, `status`.
- **GitHub client:** add combined-status / check-runs read.
- **jules_interactions:** begin writing `direction:'inbound'` rows from the poller.

## Testing

Per the repo's D1-only `node:sqlite` in-memory harness:

- P3 dedup: outstanding-session query returns the existing row → asserts no new
  session created, one outbound `improve` interaction logged.
- P1 match: PR body parse extracts `taskId`; matched row gets `created_pr_number`
  set and `category=INTERNAL_CODRA`; unmatched inserts external row with correct
  category by CI presence.
- P2 routing: table-driven test over the decision table (enabled/CI-present/
  conclusion permutations) asserting review-triggered vs no-op.
- P4: given a stored task + a diff missing a target file's docstring, asserts a
  `correction` interaction + a GitHub comment + an SDK send.
- Idempotency: replaying the same `opened` delivery is a no-op.

App-import specs may hit the known pre-existing `orchestrator.ts` vitest quirk;
verify via typecheck + build where that occurs.

## P0+P3 review hardening (resolved)

The final whole-branch review and a follow-up cursor peer-review of PR #38
surfaced several gaps in the P0+P3 slice; all were fixed on the branch before
merge (commits `42c0a7c` DB layer, `0d58b54` launch logic):

- **Recency bound on `findOutstandingCodraDocsSession`** — now only folds into
  sessions launched within a 24h window (`gt(updated_at, now-24h)`, ordered by
  `updated_at`), so a stalled `launched` session no longer becomes a permanent
  per-repo sink on deploy. Threshold is ISO-8601 to match the ISO `updated_at`
  that `markJulesLaunched` writes.
- **No `target_files` wipe** — `stageJulesSession` treats an empty `targetFiles`
  as "keep prior" (`input.targetFiles?.length ? … : existing`).
- **Fold failure degrades to launch** — the fold check in
  `launchStagedJulesSessions` is wrapped so a transient DB/send error launches
  normally instead of marking the row `error` (never reprocessed). Combined with
  `markJulesFolded` replacing the swallowed `markJulesOutcome`, a redelivered
  merge webhook no longer re-folds (a successful fold marks the row `skipped`, so
  it drops out of the staged set).
- **Folded rows keep the session link** (`markJulesFolded` stamps `session_id`
  and merges target files into the outstanding session), the follow-up sent to
  Jules is a reframed gap summary rather than the raw kickoff prompt, and the
  fold count is logged.

Remaining hardening genuinely deferred to P1/P2: excluding terminal
`session_state` values from the outstanding set (belt-and-suspenders alongside
the recency bound), and surfacing folded/`skipped` sessions distinctly in the
operations dashboard.

## Open questions

None blocking. Enum string values (`INTERNAL_CODRA` etc.) and the config key name
`external_jules` are the proposed defaults; adjust at implementation if a
convention conflict surfaces.
