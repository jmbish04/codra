# Codra Rebuild — In-Depth Plan

**Strategy (your words):** enrich `core-template-cfw` with core-remodel's
planning suite → fork it into the new codra → build the frontend (shoogle /
shadcn registry research) → then the backend → rebuild from scratch.

This plan is grounded in the actual repos on disk:
- Current codra: `/Volumes/Projects/workers/codra` — **Vite SPA + Hono worker**.
- Template: `/Volumes/Projects/workers/core-template-cfw-assets-astro-shadcn` — **Astro + React islands + Hono/zod-openapi** (`src/frontend` + `src/backend`).
- Reference: `/Volumes/Projects/workers/core-remodel` — same Astro stack, feature-rich.

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

### 3.3 Build new (from ROADMAP.md, now on the new stack)
Model routing (F5), Jules queue (F5), CI self-heal (F6), standardization sync
(F7), rich changelog/preso/diagrams (F8), PR ledger + regression detection (F9),
debrief red-flags (F10), core-guardian spend + kill-switch (F11). Each ships
behind a flag with its own D1 table (traceability + revertibility).

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

## Cross-cutting decisions you need to make

1. **New repo vs. in-place `codra-v2` branch?** (Recommend a new repo; clean git,
   old one stays live.)
2. **Keep old codra serving reviews during the rebuild?** (Recommend yes — it
   works now once deployed; don't go dark.)
3. **ClickUp as the task backbone, or codra's own D1 tasks?** core-remodel uses
   ClickUp heavily; decide if codra planning lives in ClickUp or natively.
4. **Interactive `@codra` chat agent — in scope?** Decides whether we keep one DO.
5. **Design profile** — Monolith (core-remodel default) confirmed?

## Risks
- **Scope.** This is a multi-month, multi-repo effort. Phase 1 alone is large.
  Mitigation: vertical-by-vertical, always-deployable, flag-gated.
- **Two codras diverging.** Freeze feature work on old codra except critical
  fixes once Phase 2 starts.
- **Framework unfamiliarity.** Astro islands + assistant-ui wire contract has
  sharp edges (DO re-export gotcha, hydration directives) — the cloudflare-jedi /
  shadcn skills cover these; lean on them.

## Suggested first concrete step
Phase 1.2 pilot: port the **ClickUp vertical** (schema → client → route → kanban/
gantt page) into the template as one deployable slice. It's the biggest single
gap and proves the port workflow end to end.
```
