# Codra Rebuild — In-Depth Plan

[Return to Index](./README.md)

**Strategy (your words):** enrich `core-template-cfw` with core-remodel's
planning suite → fork it into the new codra → build the frontend (shoogle /
shadcn registry research) → then the backend → rebuild from scratch.

This plan is grounded in the actual repos on disk:
- Current codra: `/Volumes/Projects/workers/codra` — **Vite SPA + Hono worker**.
- Template: `/Volumes/Projects/workers/core-template-cfw-assets-astro-shadcn` — **Astro + React islands + Hono/zod-openapi** (`src/frontend` + `src/backend`).
- Reference: `/Volumes/Projects/workers/core-remodel` — same Astro stack, feature-rich.

---

## North Star — codra is not a review bot

Codra is the **planning brain and orchestrator** for the whole dev loop. Code
review is just the *closing gate*, not the product. The product is a closed loop:

```
   ┌──────────────────────────────────────────────────────────────────┐
   │                        CODRA (central hub)                          │
   │                                                                    │
   │  1. PLAN      specs, tasks, acceptance criteria live here          │
   │      │        (kanban / sprint / gantt — Phase 1 planning suite)    │
   │      ▼                                                              │
   │  2. DISPATCH  assign a task to an agent with a PR-scope contract:   │
   │      │        "build X, keep the PR to files A/B, submit when       │
   │      │         tests pass + acceptance criteria met"                │
   │      ▼                                                              │
   │  3. AGENTS    claude code · codex · gemini cli · open-code ·        │
   │      │        antigravity(local) · jules · stitch · claude.ai design │
   │      ▼        (local fleet + cloud fleet, via a bridge — see below) │
   │  4. PR        agent opens a PR, linked back to its task             │
   │      ▼                                                              │
   │  5. AUDIT     codra reviews the PR against BOTH:                    │
   │      │          (a) best practices + infra rules (today's codra)    │
   │      │          (b) the linked spec/task — "was everything          │
   │      │              expected actually delivered?"                   │
   │      ▼        merge  ·  or kick back with the gap list              │
   │  6. LOOP      unmet criteria → new task → back to DISPATCH          │
   └──────────────────────────────────────────────────────────────────┘
```

The step that makes codra different from every review bot: **step 5(b),
spec-conformance audit.** Review is no longer context-free. Codra holds the task
and its acceptance criteria, so it audits delivered-vs-expected, not just style.

### What this adds on top of the earlier plan
- **Planning suite (Phase 1) is now the foundation, not decoration.** The
  kanban/sprint/spec data *is* the review context.
- **Agent orchestration layer** — a new first-class subsystem (below).
- **PR-scope contracts** — codra constrains an agent's PR up front.
- **Spec-aware review** — the review pipeline takes the linked task + acceptance
  criteria as input.

---

## Orchestration architecture (the new hard part)

Codra is a Cloudflare Worker (cloud). It cannot reach into your Mac directly, so
commanding **local** agents needs a bridge.

**Recommended: a local Codra Bridge daemon.**
A small long-running process on your machine that holds a WebSocket / long-poll to
codra, receives task assignments, and drives the right local CLI agent in the
right git worktree, then reports status back.
```
codra (cloud)  ⇄  Codra Bridge (your Mac)  →  spawns: claude code (headless) |
                                                        codex exec | gemini cli |
                                                        open-code | antigravity
                                              →  reports progress/PR url back
```
- **Cloud agents** (jules, stitch, claude.ai design) codra calls directly by API
  — no bridge needed (`JULES_API_KEY` binding already exists).
- **The PR-scope contract** is a machine-readable artifact codra writes into the
  task and injects into the agent (a `TASK.md` / prompt preamble in the worktree):
  goal, file scope, acceptance criteria, "submit when …". Same contract is what
  step 5(b) audits against — one source of truth for dispatch *and* review.
- **Agent abstraction:** one `AgentAdapter` interface (dispatch, poll, cancel,
  collectResult) with a driver per agent. Local drivers run via the Bridge; cloud
  drivers hit APIs. Codra stays agent-agnostic.

### New data model (spec-aware loop)
- `specs` (id, title, body/markdown, repo, status)
- `tasks` (id, spec_id, title, acceptance_criteria[], file_scope[], assignee_agent,
  status[todo|dispatched|in_progress|in_review|done], pr_url, worktree)
- `agent_runs` (id, task_id, agent_kind, status, started_at, pr_url, logs_ref)
- `pr_task_links` (pr_number, repo, task_id)  ← ties a PR to its spec for the audit
- `conformance_audits` (pr_number, task_id, criteria_met[], criteria_missing[],
  verdict) ← the output of step 5(b)

---

---

## 0 — The stack decision (the reason this is a rebuild, not a refactor)

Current codra is a **Vite single-page-app** served by a Hono worker. The template
and core-remodel are **Astro SSR + React islands** with a `src/frontend` /
`src/backend` split, Hono + `@hono/zod-openapi`, Drizzle/D1, `[assets]` on a
single Worker. These are different enough that porting page-by-page into the SPA
would fight the framework. **Decision: adopt the Astro+shadcn template stack.**
That is the "rebuild from scratch."

This aligns with the house `cloudflare-jedi` stack: Hono+zod-openapi → D1+Drizzle
→ Astro SSR + shadcn → Agents SDK + AI Gateway, one Worker with `[assets]`.

---

## Phase 1 — Bring `core-template-cfw` to feature parity with core-remodel

Goal: the template becomes the golden planning shell. Everything here is work in
the **template repo**, not codra.

### 1.1 What the template already has ✅
`tasks/` (TaskBoard **static**, TaskCard, TaskDetail, ProjectList, TeamAnalytics,
TeamNotes), `dashboard/` (recharts: StatCards, TimeSeriesCharts, CategoryCharts,
InsightsPanel), `admin/changelog` + `[slug]` **with mermaid**, `projects/`,
`settings/*`, `analytics`, `showcase/*` (artifacts, code-mode, browser-hitl,
workflows, multi-agent), `playbook`, `chat`, `notes`, `mermaidcn/`.

### 1.2 The gap to port from core-remodel ⬜
| Feature | core-remodel source | Deps to add | Notes |
|---|---|---|---|
| **ClickUp integration** | `components/clickup/{ClickUpTasksPage,ClickUpKanban,ClickUpGantt,ClickUpTaskModal}.tsx`, `backend/services/clickup-client.ts`, `backend/api/routes/clickup.ts`, `backend/db/schema/scrum/{clickup_revision_log,clickup_system_alerts,clickup_task_flags}.ts` | — | The whole scrum/clickup vertical |
| **DnD kanban** | `workshop/hooks/useBoard.ts`, `plans/PlanBoardApp.tsx` | `@dnd-kit/core`, `@dnd-kit/modifiers` | Upgrade template's static TaskBoard to draggable |
| **Gantt** | `components/clickup/ClickUpGantt.tsx`, `kibo-ui/gantt` | `frappe-gantt` and/or `@kibo-ui` gantt | |
| **Sprint / burndown / metrics** | `BudgetDashboardApp.tsx` + visx usage | `@visx/*`, `d3-sankey`, `@number-flow/react` | Burndown, sankey, animated metrics |
| **kibo-ui component set** | `components/kibo-ui/*` | kibo-ui registry | Rich planning primitives |
| **Rich changelog authoring** | Plate/tiptap editors | `@platejs/*` or `@tiptap/*` | Template renders mermaid; add authoring + preview |
| **Timeline** | `research-console/StepTimeline.tsx` | — | Sprint/step timeline |

### 1.3 Approach for 1.2
Port vertical by vertical (schema → backend route/service → frontend component →
page), each behind a route so the template stays deployable throughout. Keep the
**Monolith** design profile (core-remodel has `components/monolith/`; the
shadcn/taste-design skills default to it). Do **not** hand-copy blindly — run each
ported page through the design/review skills.

**Deliverable of Phase 1:** the template has tasks(kanban+dnd), sprint planning,
gantt, burndown/metrics, changelogs + preview + mermaid diagrams, and ClickUp
sync. This is the reusable base for every future project, not just codra.

---

## Phase 2 — Fork template → new codra; build the frontend

1. **Fork:** copy the enriched template to a fresh `codra` (new repo or
   `codra-v2`), rename bindings/vars, wire `APP_URL`, keep the old codra worker
   running untouched.
2. **Frontend research (shoogle):** use the `shoogle-mcp` / shadcn registry skills
   to source richer-than-stock components for codra's specific surfaces:
   - **Review job view** — live progress, per-file findings, severity, diff.
   - **PR ledger / regression radar** (Roadmap F9).
   - **Debriefs / red-flag catalog** (Roadmap F10).
   - **Model routing & spend** dashboards (Roadmap F5, F11).
   - **Prompts & best-practices** editors (Roadmap F2a/F2b), Plate-based.
   - **Changelog + slide-deck + diagrams** per PR (Roadmap F8).
3. **Iterate UI to done before backend.** Mock data first (the template already
   ships seed/mock patterns — `SeedBanner`, `data/`). Sign off on the UX, then
   wire real data. This is the user's explicit ordering.

**Deliverable of Phase 2:** codra's frontend, on the enriched template, styled to
standard, running against mocks — reviewed and approved.

---

## Phase 3 — Rebuild the backend (port the *good* parts of today's codra)

Today's codra backend is genuinely good in places. Port these; leave the dead
DO experiments behind.

### 3.1 Carry over (proven, port as-is or lightly adapted)
- **Queue review pipeline** — `core/review.ts` (prepare→review→finalize→changelog),
  leases, retries, DLQ, superseding, resumability. This is the crown jewel.
- **Provider layer** — `models/{openai,anthropic,google,cloudflare,antigravity}.ts`,
  `ModelService` routing, AI Gateway, catalog sync (**with the D1 100-param
  chunk fix**).
- **Webhook ingestion** — `routes/webhook.ts`, verified via `WORKER_API_KEY`
  (see AGENTS.md), delivery persistence.
- **Best-practices + lessons-learned** injection into prompts (`db/best-practices.ts`,
  `fetchLessonsLearned`).
- **Antigravity webhook path** — `models/antigravity.ts`, `routes/gemini-webhook.ts`,
  `runAntigravityWebhookPhase`, `gemini_webhook_events` + `antigravity_interactions`.
- **Health/alarm** — `core/health.ts`, `/healthz`, `/api/health`.
- **GitHub App auth** — installation tokens, checks, comments (`core/github.ts`).

### 3.2 Leave behind (dead/demo/broken)
`RepoAgent`, `ReviewAgent`, `Chat`, `codemode/`, demo `GitHubLikeMCP`, half-wired
`PrReviewStream`. If interactive `@codra` chat is wanted, build **one** deliberate
`AIChatAgent` that reads model config from `ModelService` (no hardcoded kimi).

### 3.3 Build new — the closed loop (this is the point of the rebuild)
In dependency order:
1. **Spec & task store + planning UI** (Phase 1 suite wired to real D1). The
   plan lives here.
2. **PR↔task linking + spec-aware audit** — the review pipeline gains a step:
   load the linked task's acceptance criteria, audit delivered-vs-expected,
   emit `conformance_audits`, kick back with the gap list. *This is the
   highest-leverage new capability — build it before the fancy orchestration.*
3. **Agent orchestration layer** — `AgentAdapter` interface + drivers. Start with
   **cloud** drivers (Jules API — reliable, already keyed) and **one local**
   driver via the Bridge (claude code headless). Expand the fleet after.
4. **Codra Bridge daemon** — the local process. Ship as a tiny separate package.
5. Then the convenience/guardrail features: CI self-heal (F6), standardization
   sync (F7), rich changelog/preso/diagrams (F8), PR ledger + regression (F9),
   debrief red-flags (F10), core-guardian spend + kill-switch (F11), model
   routing (F5).

Each ships behind a flag with its own D1 table (traceability + revertibility).

### 3.4 Data migration
New D1 schema via Drizzle. Migrate live tables that matter (`jobs`,
`file_reviews`, `changelog_entries`, `model_configs`, `best_practices`,
`repositories`, KB). Write one-time copy scripts; keep the old DB read-only as a
fallback until cutover is proven.

---

## Phase 4 — Cutover

Run new codra on a preview URL against the same GitHub App (or a test App) until
review parity is proven on real PRs. Flip the webhook URL. Keep old codra
deployable for rollback for one to two weeks. Then archive it.

---

## The Gotchas engine (self-service, decisive)

Today's `best_practices` are **soft** — free text appended to the prompt, matched
by shallow term search (`matchesCriteria`). The bar you want is higher: codra
should *recognize a known gotcha and act decisively*, not reinvent the fix.

**Model:** a gotcha = **detection signal + decisive directive + severity**, held
in a portable catalog (`data/gotchas/*.json`, seeded into the DB via
`scripts/ops/seed-gotchas.mjs`). See `data/gotchas/README.md`.
- **P0 gotcha** → hard red-flag that blocks merge (ties into F10 debriefs, e.g.
  the $700 DO-alarm bug).
- **P1/P2** → must-address directive injected into the review.
- **Prevention side:** matching directives are added to the **agent's PR-scope
  contract at dispatch**, so the agent avoids the trap instead of hitting it.
  Same catalog, used at both dispatch and audit — no 30-minute rediscovery.

First entry shipped: `d1-100-param-cap` (the D1 >100 bound-param cap that broke
the model catalog). Adding a gotcha = drop a JSON file + run the seed, or (later)
the `/best-practices` UI writes to the same catalog.

**Rebuild upgrade:** replace `matchesCriteria`'s term-guessing with the catalog's
explicit `detect.content_any` / `path_any` regex signals — precise, not fuzzy.

## Cross-cutting decisions you need to make

1. **New repo vs. in-place `codra-v2` branch?** (Recommend a new repo; clean git,
   old one stays live.)
2. **Keep old codra serving reviews during the rebuild?** (Recommend yes — it
   works now once deployed; don't go dark.)
3. **Task backbone: ClickUp or codra-native D1?** Big fork. ClickUp = reuse
   core-remodel's integration + you already live there; but then codra's spec/
   acceptance-criteria model must sync to ClickUp custom fields. Native D1 = full
   control of the spec→audit contract, less lock-in, more to build. *The
   spec-aware audit needs structured acceptance criteria — ClickUp custom fields
   can hold them, but native D1 is cleaner for the contract.*
4. **Interactive `@codra` chat agent — in scope?** Decides whether we keep one DO.
5. **Design profile** — Monolith (core-remodel default) confirmed?
6. **Agent fleet priority** — which agents first? (Recommend: Jules(cloud) +
   claude-code(local via Bridge) as the two pilots, expand after the loop works.)
7. **Bridge trust model** — the local daemon can run agents that write code and
   open PRs on your machine. It must be least-privilege, per-repo-scoped, and
   never auto-merge. Confirm the guardrails before it's built.

## Risks
- **Scope.** This is a multi-month, multi-repo effort. Phase 1 alone is large.
  Mitigation: vertical-by-vertical, always-deployable, flag-gated.
- **Two codras diverging.** Freeze feature work on old codra except critical
  fixes once Phase 2 starts.
- **Framework unfamiliarity.** Astro islands + assistant-ui wire contract has
  sharp edges (DO re-export gotcha, hydration directives) — the cloudflare-jedi /
  shadcn skills cover these; lean on them.

## Suggested first concrete steps
Two independent tracks can start in parallel:
- **Track A (foundation):** Phase 1 planning suite in the template — pilot the
  **ClickUp vertical** (or native task vertical, per decision #3) as one
  deployable slice. Proves the port workflow.
- **Track B (the differentiator, prototype-able on TODAY's codra):** the
  **spec-aware audit**. Add a `pr_task_links` table + a task's acceptance
  criteria to the existing review pipeline, and have finalize emit a
  delivered-vs-expected gap list. This is the highest-value idea and doesn't need
  the full rebuild to prototype — it can prove the concept on the current worker
  first, then port.
```
