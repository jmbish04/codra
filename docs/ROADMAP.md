# Codra Roadmap & Feature Spec

Status legend: ✅ done · 🟡 partial (skeleton exists, gaps noted) · ⬜ not built · 🔴 broken/dead

This is the source of truth for where Codra is and where it's going. Every item
below is traced to real files so it's verifiable, not aspirational.

---

## Part 0 — Architecture reality (read this first)

**The entire working product is the queue pipeline.** Every Durable Object
"agent" is currently dead, demo, or half-wired.

Live review path:
```
GitHub webhook (routes/webhook.ts, verified via WORKER_API_KEY)
  → REVIEW_QUEUE
  → runReviewJob (core/review.ts)  [prepare → review → finalize → changelog]
  → ModelService (services/model.ts) → provider (models/*.ts)
  → GitHubService posts review + comments
```

Durable Objects (`src/server/agents/`):

| Class | Base | State | Notes |
|---|---|---|---|
| `RepoAgent` | `Agent` | 🔴 empty shell | was the broken orchestrator (RPC `chat` bug, 210 errors) |
| `ReviewAgent` | `AIChatAgent` | 🔴 dead | no caller since `RepoAgent.processPR` removed; hardcodes kimi |
| `Chat` | `AIChatAgent` | 🔴 dead | no route serves it; hardcodes kimi |
| `GitHubLikeMCP` | `McpAgent` | 🟡 live but demo | `/mcp` server returning **fake** PRs #101/#102 |
| `PrReviewStream` | `DurableObject` | 🟡 half-wired | review.ts writes comments to it, but no `/ws` route reads them |
| `codemode/` | — | 🔴 dead | imported only by the dead agents |

**Model config DOES drive real reviews.** `ModelService.selectModel` reads
`config.model.{main,fallbacks,size_overrides}` from the repo config (the
frontend). The hardcoded `@cf/moonshotai/kimi-k2.7-code` lives only in (a) the
dead DO agents and (b) `DEFAULT_WORKERS_AI_FALLBACKS`, appended to the END of
your chain as a last-resort parachute. Your choice wins; kimi is the safety net.

### Decision D0 — DO cleanup (prerequisite for clarity)
Delete `ReviewAgent`, `Chat`, `codemode/`, and the `RepoAgent` shell via a DO
migration (`deleted_classes`). Keep `GitHubLikeMCP` only if the `/mcp` server is
wanted (then make it real). Decide `PrReviewStream` under Feature 8.

---

## Part 1 — Frontend standard ✅

Confirmed shadcn/ui: `components.json` (style `default`, base `slate`, lucide
icons, CSS variables), `src/client/components/ui/*` are shadcn primitives, pages
in `src/client/pages/*` compose them. **This is already your preferred standard.**
Roadmap: keep every new surface on these primitives; no bespoke CSS.

---

## Part 2 — Existing features: state & gaps

### F2a — Managed system prompts (`/prompts`) 🟡→🔴 disconnected
- **Live:** `routes/api/prompts.ts` CRUD over `PROMPTS_KV` (list/get/put/delete,
  import/export/add). Frontend `pages/prompts.tsx`.
- **Gap (critical):** the review pipeline **never reads `PROMPTS_KV`**.
  `buildFileReviewPrompts` (`prompts/file-review.ts`) uses static `.ts`
  templates. So managed prompts are stored and never used.
- **Plan:** make `buildFileReviewSystemPrompt` resolve an override from
  `PROMPTS_KV` by a well-known key (e.g. `system:file-review`), falling back to
  the static template. Seed KV from the current templates so nothing changes
  until edited. Add a "reset to default" + a "{variables}" contract doc on the
  page. **Traceability:** store `promptVersion` on each job so a review records
  which prompt produced it.

### F2b — Best practices (`/best-practices`) 🟡 wired, needs depth
- **Live:** `db/best-practices.ts` → `getMatchingBestPractices(path, content)`
  matches by inferred infra (cf-workers / python / appsscript) + `criteria`,
  and `ModelService.buildReviewPrompt` appends them as custom rules. Infra +
  criteria data model exists.
- **Gaps:** infra inference is a 3-branch filename guess; `criteria` matching is
  shallow; the "if cf-worker + D1 involved → enforce Drizzle" rule needs a real
  signal (detect bindings from `wrangler.jsonc`, imports, file globs).
- **Plan:** (1) richer infra/criteria matching — glob + content-signal rules
  (e.g. `wrangler.jsonc` has `d1_databases` ⇒ activate the Drizzle practice).
  (2) Repo-level infra profile cached per repo. (3) Show on the PR which
  practices fired (traceability in the review body footer).

### F2c — Lessons learned ✅ (mechanism) → see Feature 10 for the debrief layer
- **Live:** `fetchLessonsLearned` (model.ts) pulls per-file lessons from the
  `EDGRAPH` service binding and injects them into the prompt as "previously-wrong
  comments." Feedback loop exists.
- **Plan:** extend to the proactive incident catalog in Feature 10.

---

## Part 3 — New feature specs

Each entry: **Problem / Approach / Data / Traceability / Depends on / Phase.**

### Feature 5 — Right-sized model routing + Jules queue ⬜
**Problem:** small-but-hard changes deserve a premium model (Anthropic) with
blinders on the tricky hunk; the rest should run on a cheap model. And some work
(docs, stale READMEs) should be handed to Jules post-merge.

**Approach:**
- Complexity scorer per file/hunk: signals = diff size, cyclomatic-ish density,
  touched-symbol fan-out, security/infra criteria hits, historical churn. Map
  score → tier. This generalizes the existing `size_overrides` from lines-only
  to a complexity vector.
- "Blinders" = a focused sub-review: send only the hard hunk + minimal context to
  the premium model, then continue the rest of the file on the cheap tier. Slots
  into the existing per-file review loop in `runReviewPhase`.
- Jules: when the orchestrator detects doc/readme/docstring gaps, enqueue a
  **pending Jules task** (D1 row) tagged to the PR; on merge webhook, dispatch to
  the Jules API (`JULES_API_KEY` binding already exists).

**Data:** `model_routing_decisions` (job_id, file, score, tier, model, reason);
`jules_tasks` (id, repo, pr_number, kind, status[pending|dispatched|done],
payload, created_at, dispatched_at).

**Traceability:** every file review already records `model_used`; add `tier` +
`routing_reason`. Jules tasks link back to job + PR.

**Depends on:** D0 (clean agent model), F2b (criteria signals feed complexity).
**Phase:** 2 (routing), 3 (Jules).

### Feature 6 — CI self-healing (build-log driven) ⬜
**Problem:** pnpm CI errors, Drizzle migration failures, invalid
`wrangler.jsonc` binding ids, missing `.vscode/settings.json` — all recurring,
all auto-fixable.

**Approach:** poll the **Cloudflare Workers Builds API** (MCP/binding already
available) for the target worker's latest build; on failure, classify the log:
- pnpm/lockfile ⇒ agent opens a fix PR (regenerate lockfile / align
  `packageManager`).
- Drizzle migration ⇒ regenerate + commit migration.
- Invalid binding id (e.g. missing D1 `database_id`) ⇒ call the **Cloudflare API
  to create the resource** and fill the id back into `wrangler.jsonc`.
- Missing `.vscode/settings.json` ⇒ add the standard file (kills jsonc lint noise).

**Data:** `ci_incidents` (repo, build_id, class, action, pr_url, status).
**Traceability:** each incident links build → classification → remediation PR.
**Depends on:** an agent runner (Feature 5 tier infra or a dedicated fixer
worker), CF API token (`CF_API_TOKEN` binding exists).
**Phase:** 3. **Risk:** auto-creating cloud resources is powerful — gate behind a
per-repo allowlist + dry-run-by-default.

### Feature 7 — Standardization sync ⬜
**Problem:** keep every repo aligned to your golden template
(`STANDARDIZATION_REPO = jmbish04/core-github-standardization`, binding already
configured).

**Approach:** a scheduled job diffs each managed repo against the template for a
tracked fileset (`.vscode/`, `AGENTS.md`, tsconfig, lint config, CI). Drift ⇒
open a sync PR. Reuses the Feature 6 fixer path.
**Data:** `standardization_drift` (repo, file, status, pr_url).
**Depends on:** Feature 6. **Phase:** 3.

### Feature 8 — Rich changelog / preso / diagrams (`/changelog`) 🟡
**Problem:** you want the core-remodel treatment — detailed changelog + linked
slide deck + Mermaid ERD/UML/class diagrams at the top of each PR summary.
**Live:** changelog phase already exists (`runChangelogJob`, `changelog_entries`
table, `/changelog/:slug` page, Mermaid support in `CHANGELOG_RESPONSE_SCHEMA`
with `securityLevel: strict`). This is the closest-to-done new feature.
**Gaps:** no slide-deck artifact; diagram coverage is model-optional, not
enforced; page styling vs core-remodel.
**Approach:** (1) require a diagram set (ERD when schema changed, class/sequence
when logic changed) in the changelog schema. (2) Generate a slides artifact
(reuse the existing `create_artifact`/render infra if applicable) and link it at
the top. (3) Port the core-remodel changelog page components (shadcn).
**Also resolves PrReviewStream:** if you want live-streaming review comments,
finish `PrReviewStream` with a `/api/jobs/:id/stream` WS route + frontend
`EventSource`; otherwise delete it and keep 15s polling. **Recommend delete**
unless live-stream is a real want.
**Phase:** 2.

### Feature 9 — PR ledger + regression/overwrite detection ⬜
**Problem:** an agent on a stale worktree (86 commits behind) opens a PR that
silently wipes recently-merged progress.
**Approach:** a D1 ledger of every PR (`pr_ledger`: repo, pr_number,
changelog_url, head_sha, base_sha, merged_at, impacted_files[]). On each new PR,
flag when it (a) targets files touched by a PR merged in the last N hours AND
(b) its base is behind those merges ⇒ **loud red banner + PR comment**: "This PR
may overwrite #123 merged 20 min ago (files X, Y). Rebase before merge."
**Traceability:** ledger is the audit trail; the changelog url ties to Feature 8.
**Depends on:** Feature 8 (changelog url). **Phase:** 2.

### Feature 10 — Lessons-learned debrief & red-flag catalog ⬜→ (builds on F2c)
**Problem:** the $700 DO-alarm incident must never recur silently. Codra should
carry a catalog of past disasters and hard-block on recurrence.
**Approach:** a curated `incident_debriefs` table (title, pattern, severity,
detection_rule, cost_impact, date) surfaced on a self-serve `/debriefs` page.
During review, matching a debrief pattern (e.g. "unbounded DO alarm reschedule")
raises a **P0 red flag** that cannot be suppressed. Seed it with the $700 bug.
**Traceability:** each red flag on a PR links to the debrief entry.
**Depends on:** F2c mechanism. **Phase:** 2.

### Feature 11 — core-guardian spend integration + kill switch ⬜
**Problem:** bad/inefficient AI-merged code causes billing surges; you want Codra
to correlate spend spikes to recent PRs and, worst case, disable a rogue loop.
**Approach:** consume core-guardian's spend signal (service binding or API). On a
spike, correlate to the Feature 9 ledger (which PR/files landed just before) and
raise an alert on the dashboard + PR. **Kill switch** (Hail-Mary): a gated action
to disable a worker / roll back a deployment via the CF API — **manual-confirm by
default**, auto only for explicitly allowlisted patterns.
**Depends on:** Feature 9 ledger, core-guardian contract. **Phase:** 4.
**Risk:** highest-blast-radius feature; never fully autonomous without a
per-account opt-in.

---

## Delivery phases (dependency-ordered)

- **Phase 0 — Honesty & unblock:** ✅ queue fix, ✅ webhook auth, ✅ health/alarm,
  ✅ Antigravity provider, ✅ catalog insert fix. **D0 DO cleanup** (next).
- **Phase 1 — Make existing features real:** F2a (wire PROMPTS_KV into reviews),
  F2b depth, frontend polish pass.
- **Phase 2 — Intelligence:** Feature 5 model routing, Feature 8 changelog/diagrams,
  Feature 9 PR ledger, Feature 10 debriefs.
- **Phase 3 — Automation:** Feature 5 Jules, Feature 6 CI self-heal, Feature 7
  standardization sync.
- **Phase 4 — Guardrails:** Feature 11 spend/kill-switch.

Each feature ships behind its own flag and writes its own D1 table, so everything
is traceable and independently revertible.

---

## Cross-cutting: D1 100-parameter cap
D1 rejects any query with >100 bound params. The catalog insert hit this (fixed:
chunked to 10 rows). **Audit every batch insert** before it can grow: e.g.
`recordAntigravityInteractions` (3 cols → safe under 33 files, chunk if more),
any KB bulk upsert. Add a shared `chunkedInsert` helper in Phase 1.
