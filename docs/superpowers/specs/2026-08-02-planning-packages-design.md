# Planning Packages — Design Spec

[Return to Index](../../README.md)

**Date:** 2026-08-02
**Status:** Approved (design), pending implementation
**Branch:** `claude/planning-packages-architecture-818e35`

## 1. Purpose

Port core-remodel's "feature proposal / preview changelog" concept into codra as
**planning packages**, tracked **per repo**, with three fixes to core-remodel's
known weaknesses:

1. **No giant JSON blob.** core-remodel stores the whole plan detail in one
   `changelog_entries.detail_json` column whose free-form `code[]` cards contain
   stored `// …unchanged…` elisions and `...`-truncated SQL, never diff-validated.
   Codra stores every field in discrete typed columns / child rows.
2. **Revisions that never lose prior content.** core-remodel upserts on `slug`
   and overwrites the R2 transcript in place — prior content is gone. Codra keeps
   every revision as an **immutable snapshot**, so a model hallucination or a
   `<!-- ... unchanged ... -->` shortcut in one revision never destroys earlier work.
3. **Multi-agent, orchestrated production.** Any agent (Jules, a coding agent
   mid-session, a human) can submit a revision via MCP tools running in codemode.
   Codra's onboard orchestrator drives Jules to produce and then merge a final
   "super plan," reviewing and re-assigning until satisfied.

## 2. Glossary (mapping from core-remodel)

| core-remodel | codra planning packages |
|---|---|
| `changelog_proposals` bundle | `planning_packages` (header) + `package_revisions` |
| `changelog_entries` (staged) — "previewChangeList" | `revision_change_items` |
| `detail_json` (blob) | fielded child tables (`revision_*`) |
| `plan_tasks` | `revision_tasks` (definition) + `package_tasks` (live state) |
| PRD / design brief / PROMPT | scalar columns on `package_revisions` |
| R2 `feature-context/<slug>.md` (overwritten) | R2 `PLANNING_ARTIFACTS` keyed per-revision (never overwritten) |
| `submit_feature_proposal` MCP | `submit_planning_revision` MCP (always a new revision) |

## 3. Data model (Cloudflare D1 / Drizzle SQLite)

Conventions follow codra: `text` uuid PKs via `crypto.randomUUID()`, `text`
timestamps defaulting to `CURRENT_TIMESTAMP`, FK to `repositories.id`. New schema
module `src/server/db/schemas/planning-packages/index.ts`, exported from the
barrel; query helpers in `src/server/db/planning-packages.ts`.

### 3.1 `planning_packages` (header)
- `id` text PK (uuid) — **also the public-export capability id (unguessable)**
- `repository_id` integer NOT NULL → `repositories.id`
- `slug` text NOT NULL — human handle
- `title` text NOT NULL
- `status` text NOT NULL default `'draft'` — `draft | planning | in_progress | pr_submitted | merged | rejected`
- `current_revision_id` text NULL → `package_revisions.id`
- `request_prompt_json` text NULL — Plate rich-text feature-request prompt (autosaved)
- `created_by` text NULL
- `created_at` / `updated_at` text NOT NULL default `CURRENT_TIMESTAMP`
- unique(`repository_id`, `slug`); index(`repository_id`, `status`, `created_at`)

Drafts are just `status='draft'` — no separate drafts table.

### 3.2 `package_revisions` (immutable snapshot header)
- `id` text PK (uuid)
- `package_id` text NOT NULL → `planning_packages.id` (cascade delete)
- `revision_number` integer NOT NULL — monotonic per package
- `source` text NOT NULL — `jules | merge | orchestrator | human | coding_agent`
- `jules_session_id` text NULL — links to `jules_sessions.id` when Jules-produced
- `status` text NOT NULL default `'proposed'` — `proposed | superseded | accepted | rejected`
- `summary` / `problem` / `approach` / `verification` text NULL
- `prd_markdown` / `design_brief_markdown` / `prompt_markdown` text NULL
- `context_r2_key` / `context_sha256` / `context_coverage_note` text NULL; `context_bytes` integer NULL
- `created_by` text NULL
- `created_at` text NOT NULL default `CURRENT_TIMESTAMP`
- unique(`package_id`, `revision_number`); index(`package_id`, `created_at`)

**Immutable:** rows and their children are never `UPDATE`d after insert (except
`status` transitions proposed→superseded/accepted/rejected, which are metadata,
not content). A new plan = a new revision + new child rows.

### 3.3 Fielded children (per revision, `ordinal` int for ordering, no blobs)
Each: `id` text PK, `revision_id` text NOT NULL → `package_revisions.id` (cascade), `ordinal` integer NOT NULL, index(`revision_id`, `ordinal`).

- `revision_change_items` — the previewChangeList: `kind` text, `text` text
- `revision_tasks` — task **definition**: `task_key` text, `workstream` text, `phase` integer, `title` text, `description` text, `target_path` text, `change_type` text, `depends_on` text (JSON `string[]` of task_keys — small, bounded)
- `revision_file_changes` — `path` text, `change_type` text (`add|modify|delete`), `note` text
- `revision_code_cards` — `file_path` text, `language` text, `intent` text, **`content` text (FULL code, the anti-truncation field)**
- `revision_api_changes` — `method` text, `path` text, `description` text
- `revision_migrations` — `tag` text, `sql` text
- `revision_diagrams` — `caption` text, `mermaid` text

### 3.4 `package_tasks` (live mutable task state — survives revisions)
- `id` text PK (uuid)
- `package_id` text NOT NULL → `planning_packages.id` (cascade)
- `task_key` text NOT NULL
- `status` text NOT NULL default `'pending'` — `pending | in_progress | in_review | blocked | deferred | done`
- `assignee` text NULL — agent/human id
- `pr_number` integer NULL
- `notes` text NULL
- `updated_at` text NOT NULL default `CURRENT_TIMESTAMP`
- unique(`package_id`, `task_key`)

Task **definition** comes from the current revision's `revision_tasks`; this table
holds **live status/assignee**. When a revision is accepted, reconcile: insert
new `task_key`s as `pending`, keep existing rows' status untouched (mirrors
core-remodel's deliberate status-preservation). MCP `update_plan_task` and the
codra orchestrator write here — this is what "tasks must have status and assignee
updated at all times" hangs on.

### 3.5 New binding
`PLANNING_ARTIFACTS` — R2 bucket for raw Jules transcripts / context dumps.
R2 key is **per-revision** (`planning/<package_id>/<revision_id>.md`), so a new
revision never overwrites an earlier transcript. Only pointer + size + sha256 +
coverage note live in D1.

## 4. API surface

New Hono sub-router `src/server/routes/api/planning-packages.ts`, mounted in
`app.ts` inside the `/api/*` session+CSRF guard. Plus one **public** route mounted
before the guard.

### 4.1 Session-authenticated
- `GET /api/planning-packages?repo=&status=` — list, grouped by repo, `created_at DESC`
- `POST /api/planning-packages` — create draft (`repository_id`, `title`, optional `request_prompt_json`)
- `GET /api/planning-packages/:id` — header + revision summaries + live tasks
- `PATCH /api/planning-packages/:id` — update `title`/`status`/`request_prompt_json` (autosave target)
- `GET /api/planning-packages/:id/revisions/:num` — full fielded revision
- `POST /api/planning-packages/:id/revisions` — submit a new fielded revision → child rows (always a new immutable revision; `context` streamed to R2)
- `GET /api/planning-packages/:id/context?rev=` — stream a revision's R2 transcript
- `POST /api/planning-packages/:id/tasks/:taskKey` — update live task `status`/`assignee`/`pr_number`/`notes`
- `POST /api/planning-packages/:id/orchestrate` — kick the `PlanAgent` (start planning / trigger merge)

### 4.2 Public (unauthenticated, capability-gated)
- `POST /api/public/planning-packages/export` — body `{ planIds: string[] }` → fielded JSON of **all revisions** for each package id. **Read-only.** Gate is the unguessable uuid `id` acting as a bearer capability (no other auth). This is the curl handed to Jules for the merge step. Rate-limited; validates each id exists; returns only packages whose ids were supplied (no enumeration).

## 5. MCP tools

Added in `GitHubLikeMCP.init()` (`src/server/agents/orchestrator.ts`), and surfaced
through the codemode `GithubConnector` so both the orchestrator and external coding
agents can call them. All share the same service functions as the HTTP routes.

- `list_planning_packages(repo?, status?)` — READ
- `get_planning_package(packageId, { includeRevisions?, includeContext? })` — READ
- `get_planning_revision(packageId, revisionNumber)` — READ
- `create_planning_package(repo, title, promptMarkdown?)` — WRITE
- `submit_planning_revision(packageId, { summary, problem, approach, verification, prdMarkdown, designBriefMarkdown, promptMarkdown, changeItems[], tasks[], fileChanges[], codeCards[], apiChanges[], migrations[], diagrams[], context?, coverageNote?, source })` — WRITE, **always a new revision** (immutable; never overwrites)
- `export_planning_packages(planIds[])` — READ (same payload as the public route, for agents)
- `update_plan_task(packageId, taskKey, { status?, assignee?, prNumber?, notes? })` — WRITE (live state)

Writes are marked `requiresApproval` in `GithubConnector` per codra's existing
pattern. This enables a coding agent mid-session to capture a plan idea as a new
revision without leaving its editor context.

## 6. Orchestration — `PlanAgent` Durable Object

New DO `PlanAgent`, one instance per planning package (id = `package_id`).
`wrangler.jsonc` migration `v4` → `new_sqlite_classes: ["PlanAgent"]`. Re-exported
from `src/server/index.ts`; binding `PlanAgent`.

Alarm-driven state machine:
1. **startPlanning** — build a planning prompt from `request_prompt_json` + repo
   source; start a Jules **planning** session (a plan session — not `autoPr`) via
   `services/jules.ts`. Persist the linked `jules_sessions` row.
2. **ingestPlan** — when the Jules session goes stable, parse its structured output
   into a fielded revision via the `submit_planning_revision` service path
   (`source='jules'`, `status='proposed'`), transcript → R2.
3. **reviewLoop** — orchestrator LLM (existing model service) reviews the proposed
   revision against the request + repo context. If gaps / shortcuts detected,
   `send_reply` to the Jules session to improve (re-assign). Bounded max iterations;
   each improvement lands as a **new** revision (nothing lost).
4. **merge** — on merge trigger, hand Jules the export curl (`/api/public/planning-packages/export` + `planIds`) in a merge-session prompt. Jules pulls all revisions,
   produces the merged super-plan, submits it via `submit_planning_revision`
   (`source='merge'`). Orchestrator reviews; re-assigns if unsatisfied.
5. **accept** — when satisfied, mark that revision `accepted`, set
   `planning_packages.current_revision_id`, reconcile `package_tasks`, advance
   `status` (`planning`→`in_progress`, and later `pr_submitted`/`merged` from PR events).

Entry points: the FE "Submit to Jules" button and `POST /orchestrate` both address
the DO. Iteration counts / phase persist in DO storage.

## 7. Jules fleet / merge / mcp integration (programmatic, on-worker)

- `services/jules-fleet.ts` — wraps `AnalyzeHandler` / `DispatchHandler` /
  `MergeHandler` from `@google/jules-fleet` with `createFleetOctokit` and a
  `SessionDispatcher` that delegates to `@google/jules-sdk` (already a dep). Runs
  entirely in the Worker (fleet's handlers are programmatic — no CLI needed).
- `services/jules-merge.ts` — wraps `scanHandler` / `getContentsHandler` /
  `stageResolutionHandler` / `pushHandler` / `mergeHandler` from `@google/jules-merge`
  with `createMergeOctokit`, for parallel-PR reconciliation.
- Surfaced as routes `/api/jules/fleet/*` (analyze/dispatch/merge) + `/api/jules/merge/*`,
  and as MCP tools (`jules_fleet_analyze`, `jules_fleet_dispatch`, `jules_fleet_merge`,
  `jules_merge_reconcile`).
- Optional opt-in cron: extend the 6h `scheduled()` handler to run analyze→dispatch→merge
  for repos that opt in (a `repo_configs` toggle), staggered per fleet's own cadence model.
- `@google/jules-mcp` is a **stdio** MCP server (`npx`) and cannot run in a Worker —
  its tool surface is reimplemented natively as the codra MCP tools above instead.
- New deps: `@google/jules-fleet`, `@google/jules-merge`.

## 8. Frontend (React + Plate)

Reuse `src/client/components/plate-editor.tsx`. New pages in `src/client/pages/`,
routed in `main.tsx`, paths added to **both** SPA allowlists (`app.ts` `requireSession`
block and `wrangler.jsonc` `run_worker_first`).

- `/planning/new` — repo dropdown (from `/api/repos`) + Plate editor for the request
  prompt + **debounced autosave** (`PATCH request_prompt_json`; creates the draft
  package on first edit) + "Submit to Jules" (→ `POST /orchestrate`).
- `/planning` — packages grouped by repo, `created_at DESC`, status filter chips
  (draft / planning / in_progress / pr_submitted / merged). A "Drafts" chip covers
  draft resumption (no separate drafts page needed).
- `/planning/:id` — detail: **revision-history selector** (all immutable revisions),
  preview change list, **live task board** (status/assignee, editable), code cards,
  api changes, migrations, diagrams, transcript link, orchestrate/merge controls.

## 9. Testing

D1-in-memory specs via `createTestEnv()` (`node:sqlite`, per codra test harness):
schema + query helpers (revision immutability, task-state reconciliation), API
routes (auth gating, public export capability check, revision append), and MCP tool
handlers. No external DB.

## 10. Phases

| Phase | Scope |
|---|---|
| **P1** | R2 binding + D1 schema (all tables) + migration + query helpers + tests — **scaffolded this session** |
| P2 | Ingestion API (auth CRUD, revision append, public export) + tests |
| P3 | MCP tools wired into `GitHubLikeMCP` + codemode connector |
| P4 | `PlanAgent` DO orchestration (Jules planning + review loop + merge acceptance) + migration v4 |
| P5 | `jules-fleet` + `jules-merge` services + routes/MCP + optional cron |
| P6 | Frontend pages (new / list / detail) + autosave + task board |

## 11. Explicit non-goals / deferrals

- No per-field block versioning (rejected in favor of whole-revision snapshots).
- No public **write** endpoints (core-remodel's public `POST /entries` etc. are not
  ported — export is read-only).
- Diff application / patch validation of `code_cards.content` is out of scope; we
  store full content to avoid loss, but do not auto-apply.
