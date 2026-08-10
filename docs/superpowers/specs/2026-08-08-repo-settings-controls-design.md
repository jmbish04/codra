# Repository settings controls + on-demand checks + loop fix

Date: 2026-08-08
Status: Approved

## Problem

The repository settings page auto-issues code reviews to every connected repo (~695).
There is no bulk way to turn reviews off, no per-repo control over the two adjacent
automations (docstring/Jules docs-gap, toolbox/standardization), and no way to run a
single check on demand. Separately, an in-flight review is torn down and restarted on
every new PR event or comment, which produced an endless loop when a hallucinating
coding agent kept commenting on a PR.

## Mental model

A repo has **three independent auto-toggles**:

- **Code Review** — the existing per-file AI review (existing `enabled` column).
- **DocString Enforcer** — the existing Jules "Docs Gap" step (`evaluateAndStageJulesDocsTask`).
- **Toolbox Watcher** — the existing "Standardization" step (`standardizeRepository`,
  core-github-standardization: install missing standard files by repo type).

A PR event runs one job containing exactly the checks that are toggled on. Regardless of
toggles, a maintainer can invoke any single check on demand by commenting `@codra-app …`.
The two "new" checks are not new engines — they are existing pipeline steps, now
individually gated and independently triggerable.

## Requirements

1. Reset button at the top of the repo settings page sets all three toggles to false
   across every repo. User then re-enables per repo as needed.
2. Repo list sorted DESC by last review activity (most recently touched first).
3. Two new per-repo switches: DocString Enforcer and Toolbox Watcher. Both default false.
   Reset returns both (and Code Review) to false.
4. The three checks are independent — any combination can be enabled per repo.
5. On-demand mentions work even when all toggles are off:
   `@codra-app review`, `@codra-app audit docstring`, `@codra-app audit toolbox`.
6. Loop fix: only `@codra-app review` restarts an in-flight review. New commits, other
   comments, and on-demand audits never tear down a running review.

## Design

### 1. Data model — one migration (drizzle-generated)

- `repo_configs`: add `docstring_enabled` and `toolbox_enabled`
  (`integer` boolean, `NOT NULL DEFAULT 0` / false). Existing `enabled` = Code Review.
- `jobs`: add `scope` (`text` JSON, nullable). Shape `{ codeReview, docstring, toolbox }`
  (booleans). `NULL` = legacy `{ codeReview: true, docstring: false, toolbox: false }`
  for back-compat. Scope makes each job self-contained — it runs exactly its checks
  regardless of later toggle changes.

`repoConfigRecordSchema` gains `docstringEnabled` / `toolboxEnabled` (booleans).
`mapRepo` reads the new columns.

### 2. Sort — `listRepoConfigs`

`ORDER BY last_job_created_at IS NULL, last_job_created_at DESC, owner, repo`.
Reuses the `last_job_created_at` aggregate already in the query. Never-touched repos sort last.

### 3. Reset endpoint + button

- `POST /api/repos/reset` → single
  `UPDATE repo_configs SET enabled = 0, docstring_enabled = 0, toolbox_enabled = 0,
  updated_at = CURRENT_TIMESTAMP`. Clears the repo-config cache. Returns `{ ok, count }`.
- Top-of-page destructive button → confirm dialog (radix) explaining it turns off all
  three checks for all N repos. On confirm, calls reset and reloads the list.

### 4. Three switches per repo row

Each `RepoRow` shows Code Review / DocString Enforcer / Toolbox Watcher switches.
`PATCH /api/repos/:owner/:repo/config` and `repoConfigPatchSchema` extended to accept
`docstringEnabled` / `toolboxEnabled` booleans → column updates via the same fast path
as `enabled` today (`updateRepoConfigFlags`).

### 5. Mention grammar — `extractReviewRequest`

Parse the comment body after the mention trigger into a `mode`:

| Comment | mode |
|---|---|
| `@codra-app` (bare) or `@codra-app review` | `review` |
| `@codra-app audit docstring` | `docstring` |
| `@codra-app audit toolbox` | `toolbox` |

`mode` + repo toggles → job `scope`:

| Trigger | scope |
|---|---|
| PR opened/synchronize (auto) | `{ codeReview: enabled, docstring: docstringEnabled, toolbox: toolboxEnabled }`; **no job if all false** |
| `@codra-app review` | `{ codeReview: true, docstring: docstringEnabled, toolbox: toolboxEnabled }` |
| `@codra-app audit docstring` | `{ docstring: true }` only |
| `@codra-app audit toolbox` | `{ toolbox: true }` only |

The webhook's `enabled === false` hard gate is replaced by this scope logic:
mentions are always processed; auto events produce a job only when scope is non-empty.
`ReviewRequest` gains `mode` and `scope`; the repo flags are threaded from
`loadRepoConfig` (which must now expose `enabled`, `docstringEnabled`, `toolboxEnabled`).

### 6. Pipeline gating — `runReviewPhase`

Read `job.scope` (default legacy shape when null):

- Standardization step runs iff `scope.toolbox`.
- Docs Gap step runs iff `scope.docstring`.
- File-review loop + review summary run iff `scope.codeReview`.

An audit-only job (no `codeReview`) skips file reviews and finalizes by closing its
check run without a review summary — the docstring/toolbox subsystems post their own
artifacts (staged Jules session / standardization PR).

Existing `config.review.jules.enabled` / `deployWorkflow.enabled` gates stay; the new
scope gate is an additional AND (a step runs only when both its scope bit and its
existing config gate allow it).

### 7. Loop fix — `handleGitHubWebhook` + `resolveQueuedJob`

Before creating any job, call `findActiveJobsForPr`. If a review is already
queued/running for that PR:

- trigger is `@codra-app review` → `supersedeOlderJobs` + create a fresh job (explicit
  restart).
- anything else (new commit / `audit …` / bare mention / other comment) → ack as
  duplicate, create nothing.

`supersedeOlderJobs` is now called **only** on the explicit-review restart path (both in
`handleGitHubWebhook` and `resolveQueuedJob`). A running review is never torn down and
restarted by pushes or chatter.

## Accepted tradeoffs

- New commits no longer auto-supersede an in-flight review — a review can finish against
  the commit it started on. Push + want re-review = comment `@codra-app review`.
- An `audit …` requested while a review is running is dropped (ack'd), not queued —
  re-request after it finishes.
- DocString default flips to off for existing repos (was effectively on via
  `jules.enabled` default true). Matches the "default is no" requirement.

## Out of scope

- No new review engine, model, or Jules/standardization logic — only gating and triggering.
- No change to the auto-review cap (`MAX_AUTO_REVIEWS_PER_PR`).
- No global (account-level) equivalents of the three toggles.

## Testing

- Unit: `extractReviewRequest` mention parsing (bare / review / audit docstring / audit
  toolbox / non-matching) → correct mode + scope.
- Unit: scope resolution from auto trigger + toggle combinations (all off → null request).
- Unit: loop guard — active job present + `review` → supersede; + other → duplicate ack.
- Typecheck + build (project test harness quirk: app-import specs are flaky, verify via
  `npm run typecheck` and `npm run build`).
