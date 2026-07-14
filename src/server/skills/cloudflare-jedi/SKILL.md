---
name: cloudflare-jedi
description: >
  Jedi-master opinionated skill for full-stack Cloudflare development. ALWAYS use this skill
  when working on any Cloudflare Worker project — especially with Hono, zod-openapi, Drizzle ORM,
  D1, Astro SSR, Workers AI, Agents SDK, AI Gateway, wrangler.jsonc, worker-configuration.d.ts,
  Durable Objects, or any Cloudflare binding. Encodes a strict, production-grade stack:
  Hono + zod-openapi → D1 + Drizzle → Astro SSR + shadcn → Agents SDK + AI Gateway, deployed
  as a single Cloudflare Worker with `[assets]` (NOT Pages). ALWAYS pairs with the stitch-skills
  family (`stitch-orchestrator`, `stitch-initiate`, `stitch-ideate`, `taste-design`, `design-md`,
  `stitch-design`, `enhance-prompt`, `react-components`, `shadcn`, `shadcn-ui`, `stitch-loop`)
  plus the `shoogle-mcp` registry-discovery wrapper for picking richer-than-stock shadcn
  components — for any work that impacts the frontend UX. The `shadcn`
  sibling owns the official shadcn CLI/MCP/registry workflow plus the Astro + Cloudflare Workers
  setup mechanics (`@astrojs/cloudflare` adapter, `wrangler.jsonc` for Workers + assets, the
  Durable Object re-export pattern, React island hydration directives). Encodes the planning-
  package decision logic: when a request warrants a PRD/TASKS/PROMPT artifact AND/OR will impact
  frontend UX, automatically generates the appropriate planning + stitch artifacts. Use it even
  if the user only mentions a single piece of this stack — load it and apply the full conventions
  throughout.
---

# Cloudflare Jedi 🌌

**Stack**: Hono + `@hono/zod-openapi` → D1 + Drizzle ORM + drizzle-zod → Astro SSR + shadcn/ui → Agents SDK + AI Gateway (Workers AI default).
**Package manager**: pnpm. **Language**: TypeScript throughout.
**Design system**: Monolith (dark shadcn, OKLCH chart palette, no traditional borders) — defined and enforced by the `taste-design` + `design-md` + `shadcn-ui` skills.

---

## ⚡ Golden Rules — Never Break These

### TypeScript & Env
- `worker-configuration.d.ts` is **AUTO-GENERATED** by `wrangler types`. Never manually edit it.
- `Env` is a **global interface** — never import it, never redefine it, just use it.
- After any `wrangler.jsonc` binding change → immediately run `wrangler types`.
- All bindings are accessed via `env.*` (passed through Hono context `c.env`).

### Wrangler Config — Always `wrangler.jsonc`, Retrofit Legacy `wrangler.toml` On Sight
- **STANDARD**: All Cloudflare Worker projects use **`wrangler.jsonc`** for configuration. This is the modern Cloudflare-recommended format — supports comments, plays nicely with JSON tooling, and is the default emitted by current Cloudflare templates.
- **RETROFIT on sight**: If the project contains a legacy **`wrangler.toml`**, **convert it to `wrangler.jsonc` before making any other changes**. The semantics are 1:1: TOML tables become JSON objects, `[[arrays]]` become JSON arrays of objects. Preserve every binding, var, env, `[[durable_objects.bindings]]`, `[[migrations]]`, `[[d1_databases]]`, `[[kv_namespaces]]`, `[[r2_buckets]]`, `[assets]` block, `compatibility_date`, and `compatibility_flags`. Comments survive as `//` lines in JSONC.
- **NEVER** leave both `wrangler.toml` AND `wrangler.jsonc` in place. After successful conversion, **delete the legacy `wrangler.toml`** — wrangler's CLI picks up whichever it finds first and the two-file state silently desyncs.
- **NEVER** add new bindings to a `wrangler.toml`. If you're touching the config at all, retrofit to `wrangler.jsonc` first, then add bindings to the new file.
- After any binding change in `wrangler.jsonc`, immediately run `pnpm run types` (or `wrangler types`) to regenerate `worker-configuration.d.ts`.
- Retrofit checklist (run in order):
  1. Read existing `wrangler.toml` in full.
  2. Translate to `wrangler.jsonc` (TOML tables → JSON objects, `[[arrays]]` → JSON arrays of objects, TOML comments `#` → JSONC comments `//`).
  3. Confirm `name`, `main`, `compatibility_date`, `compatibility_flags`, all `[[bindings]]` arrays, `[vars]`, `[env.*]`, `[assets]`, and `[observability]` survived.
  4. Delete the original `wrangler.toml`.
  5. Run `pnpm run types` to regenerate `worker-configuration.d.ts`.
  6. Run `pnpm run deploy --dry-run` (or `wrangler deploy --dry-run`) to confirm wrangler accepts the new file before committing.
- TOML → JSONC translation example:
  ```toml
  # wrangler.toml (legacy)
  name = "my-worker"
  main = "src/index.ts"
  compatibility_date = "2025-05-01"

  [[d1_databases]]
  binding = "DB"
  database_name = "production"
  database_id = "abc-123"

  [[durable_objects.bindings]]
  name = "Chat"
  class_name = "Chat"

  [[migrations]]
  tag = "v1"
  new_sqlite_classes = ["Chat"]
  ```
  ```jsonc
  // wrangler.jsonc (modern)
  {
    "name": "my-worker",
    "main": "src/index.ts",
    "compatibility_date": "2025-05-01",
    "d1_databases": [
      { "binding": "DB", "database_name": "production", "database_id": "abc-123" }
    ],
    "durable_objects": {
      "bindings": [
        { "name": "Chat", "class_name": "Chat" }
      ]
    },
    "migrations": [
      { "tag": "v1", "new_sqlite_classes": ["Chat"] }
    ]
  }
  ```

### Frontend
- **NEVER** use `window.alert()`, `window.confirm()`, or `window.prompt()` — use shadcn `Dialog` or `AlertDialog`.
- **NEVER** use mock/hardcoded/placeholder data. All data flows from real API calls.
- **NEVER** use traditional 1px borders for separation — use `ring-1 ring-border/40`, `divide-y divide-border/40`, or `bg-card`. Only sanctioned border is the navbar bottom-edge.
- **ALWAYS** default to shadcn **dark theme** — wrap root in `<html class="dark">`, no light fallback unless explicitly requested.
- **ALWAYS** apply the **Monolith design system** for all UI work — palette, typography, no-borders rule, chart palette, label/grid contrast. Profile + ban list: `taste-design/SKILL.md`. Drop-in DESIGN.md: `taste-design/resources/DESIGN.md.monolith.template`.
- **ALWAYS** wrap recharts in shadcn `<ChartContainer>` and override `--chart-1..5` with the Monolith OKLCH/HSL palette. Force chart text to `hsl(var(--foreground))` via `tick={{ fill: ... }}` on axes and `[&_.recharts-pie-label-text]:fill-foreground` on pies. Never use Chart.js, Plotly, Visx, Nivo, Apex, Highcharts, or ECharts. Full spec with per-chart-type code: `shadcn-ui/resources/charts.md`.
- **ALWAYS** route every error through the global `ErrorLogger` — never swallow silently.
- **ALWAYS** include `<Navbar />` on every page.
- **ALWAYS** build mobile-responsive layouts with collapsible sidebar.
- **ALWAYS** add sort + filter to any data table (low effort, high UX value).

### Code Modularization — Always
- **NEVER** put all schemas in one flat file. Every domain gets its own folder with category subfolders and an `index.ts` entrypoint.
- **NEVER** put all agent logic in one file. Every agent gets its own folder with `types.ts`, `health.ts`, `index.ts`, and a `methods/` subfolder.
- **NEVER** define provider logic inline — every provider gets its own module under `backend/ai/providers/`, with a single `index.ts` entrypoint.
- Schema path: `backend/db/schemas/${category}/${subcategory}/${table_name}.ts`
- Agent path: `backend/ai/agents/${agentName}/{types,health,index}.ts` + `methods/`
- Provider path: `backend/ai/providers/${providerName}.ts` + `index.ts`
- Every folder with multiple files **must** have an `index.ts` that re-exports — consumers import from the folder path, never from individual files.
- See full conventions and examples: `references/modular-structure.md`

### Database
- **NEVER** write raw SQL migration files — always `pnpm run db:generate`.
- **NEVER** manually update migration files after generation.

### Deployment
- **NEVER** run `wrangler deploy` directly. Always `pnpm run deploy`.
- Production deploy = build + db:generate + migrate:remote + wrangler deploy (see `references/deployment.md`).

### Stitch (Frontend Mockups — Always First)
- **ALWAYS** generate Stitch mockups before writing any frontend code for a new page or significant UI feature.
- **ALWAYS** investigate the environment first (D1 schemas, agents, providers, API routes, AGENTS.md, existing components, globals.css) so the mockup covers the **full** UX surface — not just what the user explicitly asked for. Justin is solo backend-heavy; the agent is expected to fill UX gaps proactively. Procedure: `enhance-prompt/SKILL.md` Phases 1–3.
- **ASK at Step 0** of every fresh Stitch loop whether iterations should be driven by the **current coding agent** (default — Claude Code, Antigravity, Copilot, Cursor, etc., whichever is running this session) or delegated to **Jules** (requires git commit first). Never assume. See `stitch-loop/SKILL.md` Step 0.
- After Stitch generates screens, the agent **must review** them for logical gaps (missing states, missing pages, missing mobile views) and fill those gaps with additional Stitch calls — before presenting anything to the user.
- **REBUILD every Stitch mockup from the ground up.** Stitch returns image + plain HTML with no React — the HTML is throwaway. If `AGENTS.md` or an existing frontend exists, the rebuild mirrors that framework and tokens exactly. If not, default to Astro SSR + dark shadcn + Recharts on a Cloudflare Worker (assets), rarely Pages. Full decision tree: `react-components/SKILL.md`. For the Cloudflare-Workers + Astro setup mechanics specifically (`@astrojs/cloudflare` adapter, wrangler.jsonc for Workers + assets, Durable Object re-exports, React island hydration directives), see `shadcn/references/cloudflare-astro-setup.md` and `shadcn/references/durable-objects.md`.
- Present a structured mockup summary to the user. Only begin building after they confirm.
- Loop mechanics (baton, sitemap, iteration): `stitch-loop/SKILL.md`.
- Worker-orchestration mechanics for spawning Jules sessions: `references/stitch-jules-orchestration.md`.

### Jules (Context Efficiency — Delegate Aggressively)
- The current agent's context window is limited. **ALWAYS** look for tasks Jules can handle in parallel.
- Jules is appropriate for: React/TSX components, Astro pages, Hono route handlers (given exact schemas), test files, docs pages, AGENTS.md updates.
- Jules is **NOT** appropriate for: wrangler.jsonc, migrations, bindings config, AI Gateway, deployment.
- **ALWAYS** maintain `/AGENTS.md` in the project root — it's Jules' persistent briefing file.
- Jules prompts must be maximally detailed (Jules has 1M context — use it).
- Monitor Jules sessions and course-correct via `send_session_message` when it deviates.
- **Jules requires the repo committed to Git first.** That's why the orchestration default is **current-agent**, not Jules — current-agent doesn't need a clean git tree.
- See full workflow: `references/stitch-jules-orchestration.md`

### Chat / Agent UIs (assistant-ui + Cloudflare Agents)
- **DEFAULT** to the **Cloudflare Agents + assistant-ui** pattern for any chat surface that needs history, tool calling, or per-user state: `AIChatAgent` Durable Object server-side + `useAgent` → `useAgentChat` → `useAISDKRuntime` client-side. WebSocket transport, SQLite-backed history per DO instance, native tool calling, server-persisted edit/reload/regenerate.
- **ONLY** use the stateless `useChat` → `useVercelUseChatRuntime` pattern for one-shot ephemeral completions (summarize widget, code-gen prompt, embedded ask box) — no history, no tools-with-state, no WebSocket.
- **PIN** `agents` and `@cloudflare/ai-chat` to **exact versions** in `package.json` (no `^`, no `~`) — both are pre-1.0 and ship breaking changes between minor releases. Current pin: `agents@0.12.4` + `@cloudflare/ai-chat@0.7.0`.
- **NEVER** ship without authenticating the Worker fetch handler. `routeAgentRequest` accepts any client that knows the agent class + `name` — if `name` is a user ID, an unauthenticated request can read another user's full message log. Gate the handler with a JWT/cookie check, forward the credential from the client via `useAgent({ query })`, and tighten CORS to an explicit allowlist before deploy.
- **DO RE-EXPORT GOTCHA**: with `@astrojs/cloudflare`, the `Chat` DO class must be re-exported from the generated Worker entry. See `shadcn/references/durable-objects.md` (Pattern B injection is the default).
- **AssistantCloud is not compatible** with `useAgentChat`. If hosted-history via AssistantCloud is required, use the stateless pattern + `useChatRuntime` and skip the DO.
- Full integration guide with both patterns, type-compat notes, tool-calling, auth, and version stability: `references/agents-ai-gateway.md`.

### Agent Invocation — Always RPC, NEVER `stub.fetch()`
- **NEVER** invoke an Agents SDK agent (anything extending `Agent` / `AIChatAgent`) by hand-building an HTTP `Request` and calling `stub.fetch(new Request("https://internal/rpc", …))`. That is RPC wearing an HTTP costume — it compiles, passes tests, and silently discards type safety, streaming, and clear errors.
- **ALWAYS** call agent logic as **methods**:
  - **Worker / Hono route / cron / queue / another agent → agent**: `const stub = await getAgentByName(env.NS, name)` then `await stub.method(args)` (native DO RPC). `env.NS.getByName(name)` is the equivalent native helper.
  - **Browser / mobile / external service → agent**: expose the method with `@callable()` (import `callable` from `agents`) and call it via the client SDK `agent.call("method", [args])`.
- **NEVER** route agent methods through `onRequest` with a manual `/rpc` path switch. Promote that logic to a real method and add `@callable()` if a client needs it. (Genuine HTTP proxy routes that forward the *caller's* raw request are fine — but upgrade `idFromName().get()` → `getByName()`.)
- **`@callable` requires `experimentalDecorators` OFF** in `tsconfig.json` (native TC39 decorators). If it's `true`, that's a bug — remove it.
- **PROACTIVE MANDATE — scan and fix every time.** Whenever you work in a Cloudflare Agents repo (building, reviewing, or just opening it), run a **repo-wide** search for the invocation anti-patterns and fix every hit before finishing — don't wait to be asked. The patterns spread by copy-paste, so one bad call site usually means several.
  ```bash
  rg -n -t ts 'stub\.fetch\(\s*new Request'        # core anti-pattern
  rg -n -t ts '\.fetch\(\s*new Request'            # any .fetch(new Request(...)) on a stub
  rg -n -t ts '://internal|://do/|://dummy'        # synthetic URLs in hand-built requests
  rg -n -t ts 'idFromName|idFromString'            # legacy two-step stub construction
  rg -n -t ts 'onRequest'                          # manual HTTP routing inside agents
  rg -n -t ts 'getAgentByName|getByName'           # confirm SDK helper is actually used
  ```
  Classify each hit (method-dispatch = convert to RPC; raw-request proxy = keep `fetch`, upgrade construction), apply the fix recipe, rebuild + test, and report a before/after table. Full playbook: **`agents-sdk/references/agent-invocation-audit.md`** (also summarized in `references/agents-ai-gateway.md`).

### AI Prompt Construction — Always ES6 Template Literals
- **ALWAYS** build AI prompts (system prompts, user prompts, tool descriptions, RAG context injections, eval fixtures, anything that ends up sent to an LLM) using **ES6 backtick template literals** with real newline characters in the source.
- **NEVER** build a prompt by `.join('\n')` on a string array. Newlines get serialized as the **literal two-character sequence `\n`** at multiple transport boundaries (JSON encoding, tool-call args, Worker fetch bodies, AI Gateway pass-through). The model then sees `line 1\nline 2` as a single line containing the characters `\n` — not as two separated lines. The prompt structure collapses silently and you discover it only in eval drift.
- **NEVER** build a prompt by `+` concatenation across multiple `'…\n' + '…'` segments. Same failure mode.
- **NEVER** use `String.raw` for prompts unless you genuinely need raw escape sequences — `String.raw` defeats the real-newline behavior that makes template literals the right tool here.

The only safe form:

```ts
const systemPrompt = `You are a helpful assistant.

Rules:
- Be concise.
- Cite sources when provided.
- Refuse out-of-scope requests politely.
`;

const userPrompt = `Question: ${question}

Context:
${context}
`;
```

- **APPLY THIS EVERYWHERE**: agent system prompts (`backend/ai/agents/<name>/methods/`), tool description strings passed to `defineTool`/`tool()`, prompt templates in `backend/ai/providers/`, eval scripts, prompt-tuning fixtures, `.md` prompt files imported via `?raw`. No exceptions.
- **RAG context injection**: when interpolating retrieved chunks, interpolate them **inside** the template literal — never pre-`.join('\n\n')` them outside and then drop the joined string in. If you must separate, do it inside the literal: `chunks.map(c => `[${c.source}]\n${c.text}`).join('\n\n---\n\n')` is acceptable only because the entire result is then interpolated into a backtick template.
- **Code review trigger**: any PR that touches a file under `backend/ai/` and contains `.join('\n'` or `+ '\n'` is auto-flagged. Refuse to ship until rewritten as a template literal.

### OpenAPI Docs Routes
- `/openapi.json`, `/scalar`, `/swagger` are **always present** and **always dynamic** (never hardcoded schemas).
- These three routes are always linked in the Navbar.
- A `/docs` route with TSX doc pages is always scaffolded.

### Observability & Env (required everywhere)
- **Observability endpoints**: `/openapi.json` (OpenAPI 3.1.0 dynamic), `/swagger`, `/scalar`, `/health` (live binding probes), `/context` (LLM-ingestible markdown dump), `/docs` (TSX doc pages). All six are **always present**, **always dynamic**, and **always linked in the Navbar**. Full spec + Hono snippets: `references/observability-endpoints.md`.
- **Env var naming**: `GH_TOKEN` (not `GITHUB_TOKEN`), `GEMINI_API_KEY` (not `GOOGLE_GENERATIVE_AI_API_KEY`). Full preferred-vs-banned table: `references/env-var-naming.md`. After any wrangler binding change, run `pnpm run types` to regenerate `worker-configuration.d.ts`.
- **Zod v4+ enforcement**: ban `z.string().nonempty()` (use `.min(1)`), prefer first-class `z.email()`/`z.url()`/`z.uuid()`/`z.iso.datetime()`. Migration cheat sheet: `references/zod-v4-enforcement.md`. The OpenAPI 3.1.0 spec output requires Zod v4 — older code drifts.
- **Lifecycle scripts**: `migrate:db` (not `migrate-db` or `db-migrate`), `db:generate`, `db:push`, `db:studio`, `deploy`, `types`, `smoke`. Full canonical table: `references/env-var-naming.md`.

### Stitch MCP ID format guardrails (don't mix the two)
- **Bare numeric** (e.g., `"3780309359108792857"`) for: `generate_screen_from_text`, `get_screen`, `edit_screens`, `generate_variants`, `upload_screens_from_images`, `apply_design_system`.
- **Full resource path** (e.g., `"projects/3780309359108792857"`) for: `get_project`, `list_screens`, `delete_project`.
- Crossing the formats produces `INVALID_ARGUMENT` errors that look like flaky MCP behavior but are deterministic. Canonical table: `references/stitch-id-formats.md`. Every Stitch-calling skill cross-references this file.

### Orchestration tax controls (when delegating to Jules or sub-agents)
- **3-minute boundary**: if a delegated sub-session goes silent >180s, terminate, reclaim context, finish directly.
- **Branch anchoring**: every brief cites the active branch + parent commit hash. Avoids `main`-drift.
- **Context-bleed defense**: strip repo noise before delegating; isolate the payload to greenfield boundaries.
- **Completeness mandate**: no `// ... rest of code` patterns. End-to-end always.
- Full rules: `references/orchestration-tax.md`.

---

## 🐝 Swarm Dispatch — The cloudflare-jedi Sub-Agent Team

> **Explicit entry point: the `/swarm` command.** Users can kick this off directly with `/swarm <what to build>` (see `~/.claude/commands/swarm.md`). That command loads *this* skill and drives *this* section — so the swarm is "cloudflare-jedi's swarm." When you (cloudflare-jedi) detect cross-stack work, prefer the swarm even if `/swarm` wasn't typed; when `/swarm` is invoked, this section is the canonical playbook it executes.

This skill is the **orchestrator**. Four stack engineers and four coordination helpers live in `~/.claude/agents/` and are invoked via the `Agent` (Task) tool. Always prefer delegating to the right swarm agent over doing the work inline — preserves your context, parallelizes work, enforces specialization.

### Roster

**Stack engineers (cloudflare-jedi-tuned):**

| Agent | Model | Owns | When to dispatch |
|---|---|---|---|
| `cf-frontend-engineer` | opus | Astro SSR + React islands + shadcn/ui + Monolith theme + assistant-ui client | Any UI work, Stitch rebuild, dashboard, page, component, chat surface client-side |
| `cf-api-engineer` | sonnet | Hono + `@hono/zod-openapi` routes, observability endpoints, Zod v4 enforcement | Any new endpoint, route refactor, OpenAPI schema work, `/health`/`/scalar`/`/swagger`/`/openapi.json`/`/context`/`/docs` scaffolding |
| `cf-database-engineer` | sonnet | Drizzle ORM schemas, drizzle-zod exports, drizzle-kit migrations, D1-specific concerns | Any new table, column, index, relation; any migration; any `backend/db/schemas/` change |
| `cf-agents-sdk-engineer` | opus | Cloudflare Agents SDK, `AIChatAgent` Durable Objects, tool calling, auth on `routeAgentRequest`, version pinning, Pattern B re-export, **agent-invocation audit (RPC via `getAgentByName`/`@callable`, never `stub.fetch`)** | Any chat feature, agent backend, DO work, assistant-ui server side. Always runs the `stub.fetch()` anti-pattern scan (see `agents-sdk/references/agent-invocation-audit.md`) when touching agent code |

**Coordination helpers (generic infrastructure):**

| Agent | Model | Owns | When to dispatch |
|---|---|---|---|
| `context-manager` | sonnet | Shared state across the swarm — project metadata, agent interactions, decision log | Every swarm agent queries this first. Cache project state here so other agents don't re-investigate. |
| `multi-agent-coordinator` | opus | Coordinating concurrent agents, deadlock prevention, fault tolerance across 100+ agents | Multi-feature parallel work, three-way blocks (frontend+api+db), complex DAG execution |
| `task-distributor` | haiku | Queue management, load balancing, priority scheduling | Parallel work fan-out where multiple agents could pick up tasks |
| `error-coordinator` | sonnet | Distributed error handling, cascade prevention, recovery orchestration | Cross-service errors, failed deploys, cascading agent failures |

### Default dispatch table

Match the user's request to the right initial dispatch:

| User request shape | First dispatch | Then |
|---|---|---|
| "Build a new page that shows X" | `cf-frontend-engineer` | API/DB on demand if X needs new endpoints/tables |
| "Add a `<column>` to the `<table>` table" | `cf-database-engineer` | `cf-api-engineer` (schema → response), then `cf-frontend-engineer` (UI binding) |
| "Add a new endpoint `<verb> <path>`" | `cf-api-engineer` | `cf-frontend-engineer` to consume |
| "Build a chat feature for X" | **Parallel**: `cf-agents-sdk-engineer` + `cf-frontend-engineer` (with explicit wire-contract handoff) | `cf-api-engineer` for admin endpoints |
| "Add a new agent that does Y" | `cf-agents-sdk-engineer` | `cf-frontend-engineer` for any admin/chat surface |
| "Migrate from X to Y across the stack" | `multi-agent-coordinator` (it'll fan out) | follows the coordinator's plan |
| "Why did the deploy fail?" | `error-coordinator` | targeted stack engineer after diagnosis |
| "Rebuild this Stitch mockup" | `cf-frontend-engineer` | DB/API on demand for capabilities the mockup implies |

### The critical handoff: assistant-ui ↔ AIChatAgent

When the work touches a chat surface, **always dispatch `cf-frontend-engineer` and `cf-agents-sdk-engineer` in the same orchestration round** (parallel `Agent` calls in one message). They must negotiate the wire contract before either ships code.

The contract block flows **from `cf-agents-sdk-engineer` to `cf-frontend-engineer`**:

```
agent class name           → useAgent({ agent: '<class>' })
DO binding name            → matches wrangler.jsonc [[durable_objects.bindings]]
name param semantics       → almost always user ID (auth-gated)
auth credential format     → useAgent({ query: { token } })
tool catalog               → name + Zod arg schema + result schema + UI hint
state shape                → useAgent's onStateUpdate
AssistantCloud in play?    → if yes, frontend MUST switch to stateless useChatRuntime
```

If `cf-frontend-engineer` reports back that the contract is missing fields, loop back to `cf-agents-sdk-engineer` for a revised contract — do not let frontend invent the contract on its own. Inventing the contract is how auth gets skipped and how `agents` version drift slips in.

### Parallelism rules

- **Same dispatch round, no dependencies** → parallel `Agent` calls in a single message. Example: `cf-frontend-engineer` + `cf-agents-sdk-engineer` for chat work.
- **Pipeline (DB → API → UI)** → sequential, one at a time, each consuming the prior's output.
- **Anything you don't know how to coordinate** → dispatch `multi-agent-coordinator` to design the coordination graph first.

### Context-manager discipline

- Every swarm agent's first instruction is "query context-manager for project state." This means the **orchestrator** (you, cloudflare-jedi) should pre-populate context-manager with what the swarm needs to know:
  - Project framework versions (Astro, Hono, Drizzle, `agents`, `@cloudflare/ai-chat`)
  - AGENTS.md location + last-modified
  - Active branch + parent commit (per the branch-anchoring rule above)
  - In-flight wire contracts (chat agent → frontend)
  - Any blockers another agent has surfaced

- Dispatch `context-manager` to record this **before** the first stack engineer starts, then again **after** each engineer reports back so the next dispatch starts with current state.

### Orchestration tax controls still apply to swarm agents

The "Orchestration tax controls" rules above apply to **every** swarm dispatch:
- 3-minute silence → terminate, reclaim, finish directly
- Branch anchoring in every dispatch brief
- Strip repo noise before delegating
- No `// ... rest of code` — completeness mandate

### When NOT to dispatch

Inline (do it yourself) when:
- The change touches one file under ~50 lines
- The change is purely a bug fix in one layer (no cross-engineer coordination)
- The user has explicitly asked you to do it directly

Dispatch when:
- The change spans more than one layer (DB + API + UI)
- The change adds a new chat feature
- The change is a Stitch rebuild
- The user said "build" / "create" / "design" anything sized larger than a small edit

### Cross-references

- Stack engineers: `~/.claude/agents/cf-{frontend,api,database,agents-sdk}-engineer.md`
- Coordination helpers: `~/.claude/agents/{context-manager,multi-agent-coordinator,task-distributor,error-coordinator}.md`
- Existing delegation rules: `references/orchestration-tax.md`, `references/stitch-jules-orchestration.md`

---

## 🧠 Planning Package Decision Logic

Whenever the user sends a request — whether it's "add a new feature," "fix this bug," "let's plan X," or anything in between — after auditing the codebase and understanding what's involved, ask **two questions internally**:

> **Q1**: Should I prepare a planning package (`PRD.md`, `TASKS.json`, `PROMPT.md` for the coding agent) for this request?
> **Q2**: Will the frontend UX be impacted to deliver this request?

Then route based on the 2×2 matrix:

| Q1 (Plan?) | Q2 (UX impact?) | Action |
|---|---|---|
| **YES** | **YES** | **Auto-proceed** — generate full planning package + stitch artifacts. No approval needed. |
| **YES** | **NO** | Generate planning package only, no stitch artifacts. |
| **NO** | **YES** | **Ask the user** if stitch-skills should be utilized. If yes, generate full planning package + stitch artifacts. |
| **NO** | **NO** | Proceed normally — no planning package, no stitch artifacts. |

### Why auto-proceed on Q1=YES + Q2=YES?

The user's standing instruction is: *"if you think a planning package is helpful or necessary then the user agrees."* That same logic applies to stitch-skills artifacts when frontend UX is impacted. By the time the agent has decided a planning package is warranted, the agent has already done the audit work and concluded the request is meaty enough to need structure — the user has pre-approved both deliverables.

### Why ask on Q1=NO + Q2=YES?

If the request is small enough that a PRD isn't warranted but the frontend will still need new UX, fill in UX gaps, or add additional pages, the user might prefer to keep moving without a heavy artifact bundle. Ask once, structured, and proceed based on the answer. If they say yes, deliver the full planning package + stitch artifacts (same as Q1=YES + Q2=YES outcome).

### Triggers for "multiple stitch mockups are necessary"

If the request needs **more than one screen** or **more than one state** mocked up, default to invoking `stitch-skills` (specifically: `enhance-prompt` Phase 1–3 to map the surface, `taste-design` + `design-md` for DESIGN.md, `stitch-loop` to iterate, `react-components` to rebuild). Single-screen tweaks can skip the loop and use `stitch-design` directly.

### What gets delivered

When the matrix decides "auto-proceed" or the user says yes on the ask, deliver **all of these together** in one structured response:

**Planning package** (the implementation contract):
1. `PRD.md` — Product Requirements Document. Goal, motivation, scope, non-goals, capabilities consumed, page inventory, acceptance criteria.
2. `TASKS.json` — structured task list with IDs, titles, dependencies, estimated effort, agent assignments (Hono routes vs Drizzle schema vs Astro page vs React component, etc.).
3. `PROMPT.md` — the briefing for the coding agent that picks up the work. References the above two files. Includes the AGENTS.md absolute rules.

**Stitch artifacts** (the visual + UX contract — only if Q2=YES):
4. `.stitch/DESIGN.md` — Monolith profile (or refresh of an existing DESIGN.md) — see `design-md` + `taste-design`.
5. `.stitch/SITE.md` — site vision, sitemap, roadmap (use `stitch-loop/resources/site-template.md`).
6. `.stitch/baton-schema.md` — copy from `stitch-loop/resources/baton-schema.md` if not present.
7. `.stitch/site-template.md` — copy from `stitch-loop/resources/site-template.md` if not present.
8. **`.stitch/next-prompt.md`** — the baton, **one per page** in the gap-synthesis plan. Each baton includes:
   - `page` frontmatter
   - `orchestration` frontmatter (default: `current-agent`)
   - The verbatim Section 6 design block from DESIGN.md
   - Page structure
   - All states (DATA / EMPTY / LOADING / ERROR)
   - Mobile variant if layout diverges
   - Capabilities consumed (from Phase 1 inventory)

For blank-slate projects, the rebuild step (`react-components/SKILL.md` Branch C) defers to `shadcn/references/cloudflare-astro-setup.md` for the bootstrap mechanics — `pnpm dlx shadcn@latest init --template astro --preset radix-nova`, then `pnpm astro add cloudflare`, then drop in the templates from `shadcn/templates/`. If Durable Objects are part of the feature, see `shadcn/references/durable-objects.md` for the re-export pattern (the Astro+Cloudflare gotcha).

**The single open question** at the bottom of the response (always asked, even on auto-proceed):

> **Orchestration choice**: The Stitch loop can be driven by:
> 1. **current-agent** (default) — I (the current coding agent: Claude / Antigravity / Copilot / etc., whichever is running this session) generate one mockup at a time, present it, you review, I rebuild inline. Best for tight feedback loops and uncommitted working trees.
> 2. **jules** — I generate all mockups, write a comprehensive Jules brief covering the rebuild, spawn a Jules session, monitor and course-correct via `send_session_message`. Best for stepping away. **Note**: Jules requires the repo committed to Git first.
>
> Default: **current-agent**. Reply with the other if you'd prefer to delegate.

### Decision examples

| User request | Q1 (Plan?) | Q2 (UX?) | Outcome |
|---|---|---|---|
| "Refactor the agent retry logic" | NO | NO | Just do the work. No artifacts. |
| "Why is the items query 400ms?" | NO | NO | Investigate + answer. No artifacts. |
| "Add a new column to the items table" | NO | YES (table needs new column UI) | **Ask**: should I generate stitch artifacts for the column display + filter? |
| "Build the prompts management feature" | YES | YES | **Auto-proceed**: full PRD + TASKS + PROMPT + DESIGN.md + SITE.md + multiple next-prompts (one per screen) + ask orchestration only. |
| "Add a backup script to the deploy pipeline" | YES (deploy change is meaty) | NO | Generate planning package only. No stitch artifacts. |
| "Make the runs page sortable" | NO | YES (small UX) | **Ask**: should I generate stitch artifacts? (Likely no — too small for the loop. User decides.) |

---

## 🎯 UX-Workflow Confirmation (fires when Q2=YES)

Whenever the Q1×Q2 matrix above sets **Q2=YES** (the request impacts frontend UX), route through `stitch-orchestrator` for an explicit workflow confirmation before any Stitch work begins.

> **The agent's role here is senior UX researcher / design engineer.** You don't just generate mockups for what the user literally typed. You study the codebase, derive the full user journey, fill UX gaps proactively, lift components above stock primitives via `shoogle-mcp`, and present a complete vision. Justin is solo backend-heavy — carrying the UX is the agent's job.

### When this section fires

- After the Q1×Q2 matrix sets **Q2=YES** (in either auto-proceed `Q1=YES + Q2=YES` or ask `Q1=NO + Q2=YES`).
- Skipped entirely when Q2=NO (pure backend work needs no UX confirmation).

### What the agent does

1. **Classify intent** via `stitch-orchestrator/references/intent-classifier.md`. Read project signals (`.stitch/` exists?, `DESIGN.md` exists?, `src/pages/*` exists?) + user-intent keywords. Pick a recommended workflow + a one-sentence rationale.

2. **Present the confirmation prompt** via `AskUserQuestion` with 4 options: recommended workflow first, 2 adjacent alternatives, `no-ux` last. Template: `stitch-orchestrator/templates/ux-confirmation-prompt.md`. Full mechanics: `references/ux-confirmation-prompt.md`.

3. **Route based on the response**:

| Selected | Route to | Owner skill |
|---|---|---|
| `stitch-initiate` | Greenfield bootstrap | `stitch-initiate` |
| `stitch-audit` | Inline gap analysis | `stitch-orchestrator` (Step 4) |
| `stitch-ideate` | Variant exploration | `stitch-ideate` |
| `stitch-orchestrate` | Multi-page iterative build | `stitch-loop` |
| `stitch-screen` | Single screen | `stitch-design` |
| `no-ux` | Queue to `docs/backlog/queued-ux/${slug}.md` | `stitch-orchestrator` (Step 5) |

4. **For `no-ux`**: write `docs/backlog/queued-ux/${slug}.md` with frontmatter (queued_at, original_request, recommended_workflow, rationale, status: queued). `${slug}` = kebab-case from first 6 significant words of request, deduped with numeric suffix. Confirm queue write to user. Continue with the backend-only path. Full format: `references/ux-confirmation-prompt.md`.

### Why a confirmation prompt at all?

The Q1×Q2 matrix decides "do we generate artifacts?" — auto-proceed handles that. But **which UX workflow** (initiate vs audit vs ideate vs orchestrate vs screen vs no-ux) is a real designer-level decision auto-proceed cannot make. One AskUserQuestion tap is the minimum-friction way to get explicit alignment.

### Batched with orchestration choice

Present the UX workflow choice IN THE SAME RESPONSE as the existing current-agent-vs-Jules orchestration ask (from the Q1×Q2 matrix output). Two questions, one structured response — not two consecutive asks.

### Cross-references

- `stitch-orchestrator/SKILL.md` — intent classifier + the actual prompt mechanic.
- `stitch-orchestrator/references/workflow-routing.md` — canonical 6-workflow vocabulary.
- `stitch-orchestrator/templates/ux-confirmation-prompt.md` — AskUserQuestion template.
- `references/ux-confirmation-prompt.md` — cloudflare-jedi-side documentation + queued-backlog file format.

---

## Project Structure

```
my-app/
├── wrangler.jsonc                    # Bindings: D1, AI, KV, secrets, AI Gateway
├── worker-configuration.d.ts        # ⚠️ AUTO-GENERATED — never edit
├── tsconfig.json                    # Includes worker-configuration.d.ts
├── drizzle.config.ts
├── package.json                     # pnpm scripts
├── astro.config.mjs                 # @astrojs/cloudflare adapter
├── AGENTS.md                        # Jules briefing file — always kept up to date
├── .stitch/                         # Stitch artifacts (when Q2=YES)
│   ├── DESIGN.md                    # Monolith design system
│   ├── SITE.md                      # Site vision + sitemap + roadmap
│   ├── baton-schema.md              # Schema for next-prompt.md
│   ├── site-template.md             # Reusable site template
│   ├── next-prompt.md               # Active baton (one at a time)
│   └── designs/                     # Stitch-generated HTML + PNG (reference only)
├── docs/                            # Optional: PRD.md, TASKS.json, PROMPT.md (planning artifacts)
├── backend/
│   ├── db/
│   │   ├── index.ts                 # Drizzle client factory
│   │   ├── migrations/              # Auto-generated by drizzle-kit — never hand-edit
│   │   └── schemas/
│   │       ├── projects/            # Example domain
│   │       │   ├── backlog/
│   │       │   │   ├── epics.ts
│   │       │   │   ├── phases.ts
│   │       │   │   ├── sprints.ts
│   │       │   │   ├── stories.ts
│   │       │   │   ├── tasks.ts
│   │       │   │   ├── mappings.ts
│   │       │   │   └── index.ts     # re-exports everything in backlog/
│   │       │   ├── plans/
│   │       │   │   ├── requests.ts
│   │       │   │   ├── revisions.ts
│   │       │   │   ├── reverse_engineering.ts
│   │       │   │   └── index.ts     # re-exports everything in plans/
│   │       │   ├── todos.ts
│   │       │   └── index.ts         # re-exports backlog/, plans/, todos
│   │       └── index.ts             # re-exports ALL domain schemas
│   ├── ai/
│   │   ├── providers/
│   │   │   ├── workers-ai.ts        # Workers AI impl
│   │   │   ├── openai.ts            # OpenAI impl
│   │   │   ├── anthropic.ts         # Anthropic impl
│   │   │   ├── google.ts            # Google Gemini impl
│   │   │   └── index.ts             # single entrypoint: createModel()
│   │   └── agents/
│   │       └── ${agentName}/
│   │           ├── types.ts         # input/output types, zod schemas
│   │           ├── health.ts        # health check endpoint logic
│   │           ├── index.ts         # agent entrypoint, wires everything
│   │           └── methods/         # one file per capability
│   │               ├── someMethod.ts
│   │               └── index.ts
├── src/
│   ├── middleware.ts                # Routes /api/* + docs to Hono → Astro fallthrough
│   ├── hono/
│   │   ├── index.ts                 # OpenAPIHono app instance + doc routes
│   │   └── routes/                  # One file per feature domain
│   ├── worker.ts                    # Worker entry — exports DO classes + wraps routeAgentRequest before Astro/Hono
│   └── pages/
│       ├── index.astro
│       ├── chat.astro               # Mounts <AgentChat client:load /> — per-user `name` from auth context
│       ├── docs/
│       │   └── [...slug].astro      # Dynamic docs pages
│       └── _components/
│           ├── Navbar.astro
│           ├── Sidebar.tsx          # Collapsible React island
│           ├── ErrorLogger.tsx      # Global error handler (React island)
│           └── AgentChat.tsx        # assistant-ui + useAgentChat + useAISDKRuntime (Cloudflare Agents DO)
└── public/
```

---

## Architecture: Hono Inside Astro Middleware

Hono handles `/api/*`, `/openapi.json`, `/scalar`, `/swagger`.
Astro SSR handles all other routes. They share one Worker process.

```typescript
// src/middleware.ts
import { defineMiddleware } from 'astro:middleware'
import { app as honoApp } from './hono/index'

const HONO_PATHS = ['/api', '/openapi.json', '/scalar', '/swagger']

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url)
  const isHonoPath = HONO_PATHS.some(p => url.pathname.startsWith(p))

  if (isHonoPath) {
    // Pass Cloudflare runtime env to Hono
    return honoApp.fetch(context.request, context.locals.runtime.env)
  }

  return next()
})
```

```typescript
// src/hono/index.ts
import { OpenAPIHono } from '@hono/zod-openapi'
import { apiReference } from '@scalar/hono-api-reference'
import { swaggerUI } from '@hono/swagger-ui'
import { itemsRouter } from './routes/items'  // example

export const app = new OpenAPIHono<{ Bindings: Env }>()

app.route('/api/items', itemsRouter)

// Dynamic OpenAPI spec — never hardcode schemas here
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: { title: 'My App API', version: '1.0.0' },
})

app.get('/scalar', apiReference({ spec: { url: '/openapi.json' } }))
app.get('/swagger', swaggerUI({ url: '/openapi.json' }))
```

→ Full Hono route patterns + zod-openapi: `references/hono-openapi.md`

---

## Quick Reference Map

### Cloudflare-jedi internal references

| Task | Load this reference |
|---|---|
| TypeScript setup, Env, `wrangler types`, secret bindings | `references/worker-typescript.md` |
| Hono + zod-openapi routes, middleware, error handling | `references/hono-openapi.md` |
| D1 + Drizzle schema, migrations, drizzle-zod, OpenAPI types | `references/d1-drizzle.md` |
| Astro SSR, shadcn, Navbar, Sidebar, Docs route | `references/astro-frontend.md` |
| Agents SDK, AI Gateway, model providers, assistant-ui (Cloudflare Agents `AIChatAgent` DO + `useAgentChat` + `useAISDKRuntime` canonical pattern; stateless `useChat` fallback; tool calling; auth; version pinning) | `references/agents-ai-gateway.md` |
| Error logger, UX rules, gap-filling behavior, data tables, responsive layout | `references/ux-standards.md` |
| package.json scripts, wrangler.jsonc template, deploy pipeline | `references/deployment.md` |
| Jules MCP mechanics, AGENTS.md template, parallel work patterns | `references/stitch-jules-orchestration.md` |
| Modular schema folders, agent folder structure, provider modules, index.ts patterns | `references/modular-structure.md` |

### Sibling stitch-skills family (load these for any UX-impacting work)

| Topic | Load this skill |
|---|---|
| **UX-workflow intent router** — front door for every UX-touching request; classifies intent, presents the 4-option AskUserQuestion confirmation, routes to specialist or queues to backlog | `stitch-orchestrator/SKILL.md` |
| **Greenfield bootstrap** — audit codebase, derive personas + journeys + sitemap, author DESIGN.md + SITE.md + PRD + first baton | `stitch-initiate/SKILL.md` |
| **Variant exploration** — 3–5 directions for one screen via Stitch `generate_variants`, anti-slop enforced | `stitch-ideate/SKILL.md` |
| **Component-registry discovery** — query `https://mcp.shoogle.dev/mcp` for richer-than-stock shadcn blocks (data tables, multi-selects, command palettes, kanban); log picks to `.stitch/component-picks.md` | `shoogle-mcp/SKILL.md` |
| **Design taste profile** — Monolith spec, anti-pattern bans, alternative profiles | `taste-design/SKILL.md` |
| **DESIGN.md authoring** — analyze existing Stitch screens, surgical updates, Section 6 verbatim block | `design-md/SKILL.md` |
| **Stitch unified entry point** — workflow routing (text-to-design, edit-design, generate-design-md) | `stitch-design/SKILL.md` |
| **Prompt builder** — env investigation, capability inventory, gap synthesis, structured ask | `enhance-prompt/SKILL.md` (Phases 1–5) |
| **Stitch HTML → React rebuild** — Astro + React + shadcn default, branch decision tree, Jules brief | `react-components/SKILL.md` |
| **Official shadcn CLI/MCP + Cloudflare-Astro stack** — `npx shadcn@latest` workflow, components.json, presets, registries, `@astrojs/cloudflare` adapter, wrangler.jsonc for Workers + assets, Durable Object re-exports, React island directives | `shadcn/SKILL.md` |
| **shadcn/ui Monolith customization** — `cn()`, cva variants, no-borders patches, Monolith globals.css | `shadcn-ui/SKILL.md` |
| **Recharts via shadcn** — `<ChartContainer>`, OKLCH chart palette, label/grid contrast, per-chart-type code | `shadcn-ui/resources/charts.md` |
| **Cloudflare-Astro setup walkthrough** — bootstrap, `astro.config.ts`, wrangler.jsonc, package.json scripts, troubleshooting | `shadcn/references/cloudflare-astro-setup.md` |
| **Durable Objects on Astro+Cloudflare** — class declaration + binding + the re-export gotcha (Pattern A wrapper / Pattern B injection) | `shadcn/references/durable-objects.md` |
| **Stitch build loop** — baton, sitemap, iteration mechanics, Step 0 orchestration ask | `stitch-loop/SKILL.md` |
| **Reusable Monolith DESIGN.md** — drop-in starter | `taste-design/resources/DESIGN.md.monolith.template` |

---

## Onboarding Checklist for a New Project

1. Read `wrangler.jsonc` to understand all bindings
2. Run `wrangler types` to generate `worker-configuration.d.ts`
3. Load `references/worker-typescript.md`
4. If D1 binding present → load `references/d1-drizzle.md`
5. If building **any** frontend or UI mockup → load the stitch-skills family in this order:
   - `stitch-orchestrator/SKILL.md` (**always first** — the intent classifier + UX-workflow confirmation prompt; routes to the right specialist below)
   - `taste-design/SKILL.md` (Monolith profile + ban list)
   - `design-md/SKILL.md` (if there's an existing Stitch project to analyze)
   - `stitch-initiate/SKILL.md` (if greenfield — full bootstrap with audit + journey-map + DESIGN.md + first baton)
   - `enhance-prompt/SKILL.md` (env investigation + gap synthesis + Phase 0.5 shoogle component discovery)
   - `shoogle-mcp/SKILL.md` (registry discovery for richer-than-stock components — query before reaching for stock primitives)
   - `stitch-ideate/SKILL.md` (if exploring variants)
   - `stitch-design/SKILL.md` (workflow routing for single screens — downstream of orchestrator)
   - `stitch-loop/SKILL.md` (if running an iterative multi-page build) — and **ask the orchestration question (current-agent vs Jules) at Step 0 before generating anything**
   - `react-components/SKILL.md` (the rebuild step — includes Branch D for shoogle-aware picks)
   - `shadcn/SKILL.md` + `shadcn/references/cloudflare-astro-setup.md` + (if DOs are involved) `shadcn/references/durable-objects.md` (official shadcn CLI/MCP/registry workflow + `@astrojs/cloudflare` adapter setup + wrangler.jsonc for Workers+assets + DO re-export pattern + React island hydration directives)
   - `shadcn-ui/SKILL.md` + `shadcn-ui/resources/charts.md` (Monolith customization on top of shadcn — chart palette, no-borders rule, dark globals.css)
   - Plus `references/astro-frontend.md` and `references/stitch-jules-orchestration.md` for the Cloudflare/Jules layer
6. If AI / chat / agent feature → load `references/agents-ai-gateway.md`. Default to the Cloudflare Agents (`AIChatAgent` DO) + assistant-ui (`useAgentChat` → `useAISDKRuntime`) pattern. Pin `agents@0.12.4` and `@cloudflare/ai-chat@0.7.0` exactly. Authenticate the Worker before deploying; never ship the wildcard CORS or the unauthenticated `routeAgentRequest`. If Durable Objects appear, also load `shadcn/references/durable-objects.md` for the Astro re-export gotcha. **Whenever agent code is touched, run the agent-invocation anti-pattern scan and fix every hit (`getAgentByName`/`@callable` instead of `stub.fetch`) — playbook in `agents-sdk/references/agent-invocation-audit.md`.**
7. Always apply UX rules from `references/ux-standards.md` and the Monolith chart standards from `shadcn-ui/resources/charts.md`
8. Create or update `/AGENTS.md` in the project root before delegating anything to Jules — and re-update it whenever the rebuild introduces a new convention

> **Skill tagging**: Tagging `cloudflare-jedi` activates the full UX + frontend workflow for this project, with the stitch-skills family as siblings that compose cleanly. Tag specific stitch-skills (e.g. `taste-design`, `stitch-loop`) directly when you want to be explicit about which slice of the workflow you need.

---

## Orchestration: Plan → Stitch → Current-Agent-or-Jules → Cloudflare → Review

For any feature with both frontend and backend work, apply this order:

```
0. AUDIT     → Audit the codebase. Run the Q1×Q2 matrix (planning-package + UX-impact).
              Decide auto-proceed, ask, or skip.

1. ASK (if Q2=YES) → "current-agent (default) or Jules for orchestrating the Stitch loop?"
              Never assume. See stitch-loop/SKILL.md Step 0.

1.5 WORKFLOW-CHOICE (if Q2=YES) → Present the 4-option UX-workflow confirmation
              prompt via AskUserQuestion (stitch-initiate / stitch-audit /
              stitch-ideate / stitch-orchestrate / stitch-screen / no-ux —
              4 most relevant shown). Recommended workflow first with
              one-sentence rationale. Route to the chosen workflow's specialist
              skill, or queue to docs/backlog/queued-ux/${slug}.md on no-ux.
              See stitch-orchestrator/SKILL.md and references/ux-confirmation-prompt.md.
              BATCH steps 1 and 1.5 in the same structured response — don't ask twice.

2. INVESTIGATE → Read wrangler.jsonc, schemas, agents, providers, API routes,
                 AGENTS.md, existing components, globals.css. Map capabilities
                 and existing UX. Synthesize the gaps. (enhance-prompt/SKILL.md Phases 1–3)

3. PLAN      → If Q1=YES: generate PRD.md, TASKS.json, PROMPT.md.
              If Q2=YES: generate DESIGN.md (taste-design + design-md), SITE.md,
              baton-schema.md, site-template.md, and one next-prompt.md per page
              from the gap-synthesis plan.

4. STITCH    → Generate + review mockups for all pages and all states.
              Lock the Monolith designTheme (DARK / INTER / ROUND_EIGHT /
              #ffffff / saturation 1). Present to user. Get sign-off
              (or auto-proceed if Q1=Q2=YES).

5. REBUILD   → Stitch HTML is reference-only. Rebuild from the ground up:
              - Existing frontend with AGENTS.md → mirror exactly
              - Blank slate → Astro SSR + dark shadcn + Recharts on
                Worker + assets (rarely Pages)
              In current-agent mode (default), rebuild inline this session.
              In Jules mode, write the brief and spawn the session.
              (react-components/SKILL.md)

6. CLOUDFLARE → Handle Cloudflare-specific backend work in parallel
              (schema, migration, Hono route, wrangler.jsonc, deployment).

7. REVIEW    → If Jules opens a PR, review against the rebuild acceptance
              checklist (react-components/SKILL.md) and AGENTS.md.
              Course-correct via send_session_message.
              Then merge + deploy (pnpm run deploy).
```

This sequence preserves agent context for tasks that genuinely require Cloudflare expertise, while letting Jules carry the long-tail rebuild work when appropriate.

---

## UX Gap-Filling Behavior (Summary)

- Infer what features logically belong based on the full picture of the project.
- **Small effort gap** (sort/filter on table, loading skeleton, empty state, breadcrumb) → just implement it.
- **Large effort gap** (full auth, multi-tenancy, billing) → ask first with a one-line description.
- For Stitch-driven UX work, the deeper investigation (D1 schemas, agents, providers, API routes, existing UX) lives in `enhance-prompt/SKILL.md` Phases 1–3 — that's where capability-derived implicit UX gets surfaced. Justin is solo backend-heavy, so the agent is expected to carry the frontend vision and fill gaps proactively.
- Full rules in `references/ux-standards.md`.

---

## 🔗 Skill Family Cross-References — Data, Engineering, Product Management

> These skills live as standalone files in `~/.claude/skills/`. When a data skill (`sql`, `data-viz`, `data-analysis`) runs inside a Cloudflare-jedi project, it applies the shared **[Monolith / Cloudflare-Jedi data override](references/data-skill-override.md)** that encodes this stack's conventions. Always load these skills when their concern surfaces — they already know about Hono, Drizzle, D1, shadcn, the Monolith profile, and the `/docs` / `/standup` / `/architecture` page conventions.

### Data family (6 skills — consolidated)

These write to **Drizzle ORM on D1**, expose data via **Hono routes**, visualize with **shadcn charts on Recharts (Monolith OKLCH palette)**, and bias toward **exploratory autopilot with warm-start prompting** (see the shared override reference above).

| Skill | When to use |
|---|---|
| `sql` | Translate intent into Drizzle queries (never raw SQL in app code); dialect reference + analytical patterns |
| `data-analysis` | Full analytical lifecycle — profile a schema, answer questions (lookup → report), statistical methods, ML/advanced modeling, and QA an analysis before shipping |
| `data-viz` | Charts + dashboards (shadcn + Recharts). **Default deliverable shape for any data question** — routes to an Astro page backed by Hono+Drizzle, not a one-off HTML file |
| `data-context-extractor` | Capture domain knowledge into a reusable context skill for the warehouse |
| `data-engineering` | Pipelines, warehouses, streaming, and data-quality/contracts (Spark, dbt, Airflow, Great Expectations) |
| `data-storytelling` | Turn analysis results into a narrative that drives decisions |

### Engineering family (6 highlighted — each ties to a frontend page)

These six are not generic — they are **opinionated, frontend-page-backed** workflows that every Cloudflare-jedi worker must implement.

| Skill | Frontend surface | Backing |
|---|---|---|
| `deploy-checklist` | n/a (`package.json`) | One command: `pnpm run deploy` — preflight + migrate + deploy + verify |
| `documentation` | `/docs/*` | Maintained docs site (Getting Started, Concepts, API ref from `/openapi.json`, Architecture, Changelog, Runbooks). Updated every agent turn |
| `standup` | `/standup` | D1-backed feed of yesterday/today/blockers/upcoming. Agent posts every turn |
| `system-design` | `/architecture` | North-star architecture page. Read **before** writing code; updated when topology changes |
| `tech-debt` | `/admin/tech-debt` | D1-backed debt registry. Self-enforced anti-hardcoding sweep every turn |
| `testing-strategy` | `/health` | Health suite that runs in CI **and** in production via cron. Every binding gets a subcheck |

These four pages — `/docs`, `/standup`, `/architecture`, `/health` — are **mandatory standard delivery** on every Cloudflare-jedi worker.

### Product Management family (6 highlighted)

Pair these with the planning-package decision logic in section "🧠 Planning Package Decision Logic" above. When the agent decides a PRD/TASKS/PROMPT package is warranted, these skills produce the artifacts.

| Skill | Output |
|---|---|
| `product-brainstorming` | Sparring partner for problem-space exploration before any PRD |
| `write-spec` | Authors `docs/PRD.md` (the canonical PRD format used by this stack) |
| `sprint-planning` | Scopes work into committable sprint units; outputs `docs/TASKS.json` |
| `roadmap-update` | Maintains Now/Next/Later view; surfaces on `/admin/roadmap` |
| `stakeholder-update` | Generates exec/customer/engineering-flavored versions of the same progress |
| `synthesize-research` | Distills user research into themes that feed the next PRD |

Plus: `competitive-brief`, `metrics-review` (full PM folder, but the six above are the daily-use core).

### How they compose — typical turn

```
[user asks for X]
   ↓
cloudflare-jedi (this skill, sets stack expectations)
   ↓
system-design  (read /architecture first — does X fit the topology?)
   ↓
write-spec     (if X warrants a PRD)
   ↓
sprint-planning (break into TASKS.json)
   ↓
[implementation skills: drizzle/hono/agents-sdk/shadcn/stitch as needed]
   ↓
testing-strategy (extend /health, add Vitest + Playwright)
   ↓
documentation (update /docs)
   ↓
deploy-checklist (pnpm run deploy)
   ↓
standup (POST /api/standup with the turn's deliverables)
```


---

## Engineering Standards (apply whenever this skill produces code)

These are non-negotiable defaults for any code this skill writes or modifies:

- **Modularize aggressively — no monolithic files.** Split by responsibility into focused modules, components, and helpers. A single source file must stay well under **1,000 lines** (target ≤ ~400). If a file is approaching that, extract submodules/hooks/utilities *before* continuing. One giant file is a defect, not a deliverable.
- **Document heavily — heavy docstrings + comments.** Every module, class, function, and non-obvious block gets a docstring/comment stating its purpose, inputs, outputs, side effects, and any non-obvious decisions or tradeoffs. Prefer clear names *plus* docstrings over terse, comment-free code. Public/exported APIs always get a docstring.
