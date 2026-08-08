# Design: Codra docs-gap Jules tasks + deployment GitHub Action

[Return to Index](../../README.md)

Date: 2026-07-29
Status: Approved design → implementation planning

## Summary

Two new autonomous behaviors for Codra's PR-review pipeline, both discovered
during a review and both acting on the repo *outside* the reviewed PR:

1. **Docs-gap → Jules task.** When Codra detects that a repo's documentation is
   severely lacking (missing/stale `AGENTS.md`/`CLAUDE.md`, `README.md`, a
   frontend `docs/` suite, or low docstring coverage in the reviewed PR), it
   **stages** a Jules coding-agent task. The task is launched **only after the
   triggering PR merges** (Jules starts from GitHub HEAD). The Jules session id
   + link are stored in D1, surfaced on the Codra dashboard, and echoed back
   into the PR conversation.

2. **Deployment GitHub Action.** When a Cloudflare Worker repo has no deploy
   workflow, Codra opens a **separate** PR (distinct from the standardization /
   housekeeping PR) adding a `wrangler-action@v4` workflow with manual
   (`workflow_dispatch`) deploy / DB-migrate / log-check actions and a
   commented-out auto-deploy-on-main block. When opening that PR, Codra also
   sets the repo's `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` GitHub
   Actions secrets from its own Cloudflare secret store.

Both are best-effort and must never break the core review flow.

## Non-goals

- No repo-wide docstring rewrite by Codra itself (that's Jules's job).
- No polling Jules to completion inside a Worker request. Fire session, store
  id/url, return. Progress can be inspected later via the Jules link.
- No auto-enabling of production deploys (the push-to-main block ships commented
  out).

---

## Feature 1: Docs-gap → Jules task

### 1.1 Detection (`src/server/core/jules-docs-gap.ts`)

Runs inside the existing Standardization phase of `runReview`
(`src/server/core/review.ts`), which already fetches the repo tree, config
files, and `getProjectContext` (AGENTS.md/CLAUDE.md). Reuse that data; add at
most one extra Worker-AI call.

Gap sources (combined heuristic + AI judgment):

| Target | Heuristic | AI judgment |
|---|---|---|
| `AGENTS.md` / `CLAUDE.md` | missing/empty → gap | present but AI judges "not reflective of current app", or last-commit age > `STALE_DAYS` → verify/improve gap |
| `README.md` | missing/empty → gap | same staleness/reflectiveness check |
| Frontend docs suite (`docs/` w/ TOC + subpages) | `docs/` absent → gap | present but stale/thin → improve gap |
| Docstrings | `analyzePrFileDocstrings` over the PR's **changed** source files; per-file `requiresJulesTask` (missing > documented) | none (deterministic) |

- `STALE_DAYS` default 180 (constant, tunable). "Last updated" = last commit
  touching the file on the default branch (GitHub commits API, `path=` +
  `per_page=1`); if unavailable, skip the staleness signal (don't guess).
- Docstring analyzer: port the user-provided `analyzePrFileDocstrings`
  verbatim into `src/server/core/docstrings.ts` with a unit test. Supported
  ext: `.ts .tsx .js .jsx .mjs .cjs .py .sql`. It is a heuristic regex scan —
  documented as such (ponytail ceiling comment); upgrade path is an AST parser
  if false positives matter.
- The AI call returns a small JSON verdict per doc target
  (`{ needsWork: boolean, reason: string }`) via a Zod schema in
  `src/server/models/schemas.ts`. On any failure, fall back to heuristic-only.

Output: a `DocsGapReport` = ordered list of gap items, each with a
`kind` (`agents` | `readme` | `frontend-docs` | `docstrings`), a human reason,
and (for docstrings) the `{ path, functions[] }` list. Empty list → no task.

### 1.2 Prompt composition

`buildJulesPrompt(report, repoInfo): string` — treats Jules as a newborn:
spells out exactly what to create/update, the required doc-suite layout
(`docs/` index/TOC → subpages → nested subpages), **how to wire the frontend
routing** (derived from the repo's detected router — e.g. the
`react-router-dom createBrowserRouter` pattern), and the hard rules:
- Never overwrite or delete existing docstrings; only add missing ones.
- For each listed file, add docstrings to exactly the listed functions.
- Match the project's existing style/conventions (reference AGENTS.md).

Prompt embeds the concrete file+function list from 1.1. Kept under a size cap
(truncate the docstring list with an explicit "…and N more" note — never
silently drop, per ponytail).

### 1.3 Staging + storage (`jules_sessions` table)

New Drizzle schema `src/server/db/schemas/jules-sessions/index.ts` + helpers
`src/server/db/jules-sessions.ts`.

Columns:
- `id` (uuid PK)
- `created_at`, `updated_at`
- `owner`, `repo`
- `triggering_pr_number` (int), `triggering_job_id` (text)
- `state`: `staged` | `launched` | `skipped` | `error`
- `prompt` (text — the full prompt sent/queued to Jules)
- `gap_summary` (text — human summary for the UI + PR comment)
- `session_id` (text, null until launched)
- `session_url` (text, null until launched)
- `session_state` (text — Jules's own state, e.g. `QUEUED`; null until launched)
- `error_msg` (text, null)
- `pr_comment_id` (int, null — the issue comment Codra updates)

When gaps found during review: insert one `staged` row and post a PR issue
comment (store its id): *"📚 Codra found documentation gaps (…summary…). A Jules
agent session will be opened automatically once this PR is merged."*
Idempotency: if a non-terminal `jules_sessions` row already exists for
`(owner, repo, triggering_pr_number)`, update it instead of inserting.

### 1.4 Launch on merge (`src/server/routes/webhook.ts`)

At the `pull_request` / `closed` handler (`webhook.ts:141`), add a
`merged === true` branch that calls a new
`launchStagedJulesSessions(env, github, {owner, repo, prNumber})` in
`src/server/core/jules.ts`:

1. Load `staged` rows for `(owner, repo, prNumber)`. None → return.
2. Read `JULES_API_KEY` via `getSecretStoreBinding(env, 'JULES_API_KEY')`.
   Missing → mark rows `skipped`, comment says Jules key not configured.
3. `GET https://jules.googleapis.com/v1alpha/sources` (header
   `X-Goog-Api-Key`). If `sources/github/{owner}/{repo}` not present → mark
   `skipped`, update PR comment: repo not connected to the Jules GitHub app
   (with the connect link). Do not error the webhook.
4. `POST https://jules.googleapis.com/v1alpha/sessions` with
   `{ prompt, title, sourceContext: { source, githubRepoContext: { startingBranch: <default branch> } } }`.
   (No `automationMode` — let Jules open its own PR per its normal flow; revisit
   if we want `AUTO_CREATE_PR`.)
5. On success: store `session_id`, `session_url` (response `url`, fallback
   `https://jules.google.com/session/{id}`), `session_state`, state `launched`.
   Update the PR comment: *"✅ Jules session opened: <url> (id: `…`)."*
6. On HTTP failure: state `error`, `error_msg`, comment notes the failure.

All wrapped so a Jules failure never throws out of the webhook handler.

Client: plain `fetch` in `src/server/services/jules.ts` (`startSession`,
`listSources`) — the npm SDK pulls Node built-ins and is not Worker-ready.

### 1.5 Frontend (`src/client/pages/actions.tsx`)

Fetch Jules sessions via a new `GET /api/jules-sessions` route
(`src/server/routes/api/jules-sessions.ts` → `listJulesSessions`) and a client
method in `src/client/lib/api.ts`. Render a card per session showing: state
badge, owner/repo, triggering PR link, gap summary, the prompt (collapsible),
a `CopyButton` for the session id, and a hyperlink (`session_url`) opening the
session in Jules. Shared row type added to `src/shared/api.ts`.

Placement: a section on the existing Codra Actions page (reuses layout + auth).

---

## Feature 2: Deployment GitHub Action (separate PR)

### 2.1 Detection + PR (`src/server/core/deploy-workflow.ts`)

Runs as its own step after Standardization in `runReview` (best-effort). Gate:
- Cloudflare Worker repo (wrangler config present — same check standardization
  uses).
- No existing deploy workflow: none of `.github/workflows/deploy.yml`,
  `deploy.yaml`, or any workflow file whose contents reference
  `cloudflare/wrangler-action` or `wrangler deploy`. (List `.github/workflows`
  via the repo tree; fetch candidates only as needed.)
- Respect `dismissed-standards` (path `.github/workflows/deploy.yml`) and dedup
  against an open `codra/deploy-workflow-*` PR — mirrors the housekeeping dedup.

If a workflow is needed, open a **separate** PR on branch
`codra/deploy-workflow-<ts>` (base = default branch) containing
`.github/workflows/deploy.yml`. Record an `agent_action`
(`action_type: 'deploy-workflow'`).

### 2.2 Workflow contents

`workflow_dispatch` with an `action` choice input:
- `deploy` → `wrangler-action@v4` `command: deploy`
- `migrate-db` → `command: d1 migrations apply <DB_NAME> --remote` (DB name read
  from wrangler config; if not determinable, use a documented placeholder + a
  note)
- `check-logs` → `command: deployments list` (recent deploys / build status)

Uses `apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}` and
`accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}`. Includes a **commented-out**
`on: push: branches: [main]` auto-deploy job with a header comment telling the
maintainer to uncomment to enable continuous deploys. Node/pnpm setup matches
the repo's package manager (detected; default pnpm per this repo).

---

## Feature 3: Set GitHub Actions secrets

### 3.1 Flow

Invoked right after the deploy PR is opened (only then — no point setting deploy
secrets on a repo we're not adding a deploy workflow to):

1. Read `CLOUDFLARE_ACCOUNT_ID` = `env.CF_ACCOUNT_ID.get()` and
   `CLOUDFLARE_API_TOKEN` = `env.CF_API_TOKEN.get()`
   (← `CLOUDFLARE_WRANGLER_API_TOKEN` secret). Either empty → skip + note.
2. `GET /repos/{owner}/{repo}/actions/secrets/public-key`.
3. Encrypt each value with libsodium `crypto_box_seal` against that public key,
   base64 the sealed bytes.
4. `PUT /repos/{owner}/{repo}/actions/secrets/{name}` with
   `{ encrypted_value, key_id }` for `CLOUDFLARE_ACCOUNT_ID` and
   `CLOUDFLARE_API_TOKEN`.

New `GitHubClient` methods (`src/server/core/github.ts` + `GitHubService`
passthroughs): `getRepoActionsPublicKey`, `putRepoActionsSecret`.

### 3.2 Permission degradation

The GitHub App needs the **Actions Secrets: write** repository permission,
which it likely does not have today. On `403`/`404` from step 2 or 4:
- Do **not** fail the PR.
- Append a section to the deploy PR body listing the exact secret names to add
  (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`), where the values come from
  (the Cloudflare dashboard / account API token), and that Codra could set them
  automatically once granted `Actions Secrets: write`.
- Record the outcome on the `agent_action` summary.

### 3.3 Crypto

Add dependency `libsodium-wrappers` (+ `@types/libsodium-wrappers`). WASM,
Workers-compatible, implements `crypto_box_seal` (the exact primitive GitHub
documents for encrypting Actions secrets). Never hand-roll the sealed box.
A unit test seals a known value and asserts output shape / round-trips against a
known keypair.

---

## Config toggles (`src/shared/schema.ts`)

Add to `reviewConfigSchema` (following the existing `exec` sub-object pattern),
all defaulting **on** so behavior is available without per-repo setup:

```ts
jules: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
deployWorkflow: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
```

`runReview` checks these before running the respective steps. This lets a repo
opt out via its Codra config without code changes.

## Pipeline integration

Add two job steps (visible via `updateJobStep`), after `Standardization`:
- `Docs Gap` — runs 1.1–1.3 (stage Jules task).
- `Deploy Workflow` — runs Feature 2 + 3.

Both best-effort: a failure marks the step `failed` with the error but never
aborts the review.

## Error handling & safety

- Every new external call (Jules REST, GitHub secrets API, commits API) is
  wrapped; failures log + degrade, never throw into review/webhook.
- Jules launches **only** on `merged === true` — never on close-without-merge.
- Secret values are read at call time and never logged or persisted.
- Idempotency: staged Jules rows dedup per `(owner, repo, triggering_pr)`;
  deploy PR + housekeeping PR both dedup on open branch prefix.

## Testing

- `docstrings.test.ts` — the ported analyzer across each supported extension,
  including the `requiresJulesTask` boundary.
- `jules-docs-gap.test.ts` — gap detection given fixture repo states
  (missing/stale/present), heuristic path with AI mocked.
- `jules.test.ts` — source-not-connected, missing key, and happy-path launch
  (fetch mocked); assert PR-comment + row-state transitions.
- `github-secrets.test.ts` — sealed-box round-trip; 403 → PR-body degradation.
- `deploy-workflow.test.ts` — gate logic (worker vs not, workflow present vs
  absent, dedup, dismissed).

## New/changed files

New:
- `src/server/core/jules-docs-gap.ts`, `src/server/core/jules.ts`,
  `src/server/core/docstrings.ts`, `src/server/core/deploy-workflow.ts`,
  `src/server/core/github-secrets.ts`
- `src/server/services/jules.ts`
- `src/server/db/schemas/jules-sessions/index.ts`,
  `src/server/db/jules-sessions.ts`
- `src/server/routes/api/jules-sessions.ts`
- D1 migration for `jules_sessions`
- tests above

Changed:
- `src/server/core/review.ts` (two new steps + config gates)
- `src/server/routes/webhook.ts` (merge → launch Jules)
- `src/server/core/github.ts` + `src/server/services/github.ts`
  (actions public key + put secret; PR comments reuse existing
  `createIssueComment`/`updateIssueComment` — PR number is the issue number)
- `src/shared/schema.ts` (config toggles), `src/shared/api.ts` (Jules row type)
- `src/client/pages/actions.tsx`, `src/client/lib/api.ts`
- `package.json` (`libsodium-wrappers`)
- docs (`README.md` / `AGENTS.md`) note of the new behaviors

## Open ceilings (ponytail)

- Docstring analyzer is regex-based (fast, some false positives) — upgrade to
  AST only if noise warrants.
- Docstring gap scans only the triggering PR's changed files — a repo-wide
  sweep would be a separate scheduled Jules task later.
- Jules is fired without `AUTO_CREATE_PR`; enable if we prefer Codra to force
  the PR mode.
