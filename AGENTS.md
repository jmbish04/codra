# AGENTS.md

Guidance for AI agents working in this repository.

## AI operations: everything routes through core-guardian (MANDATE)

**Codra holds no Workers AI (`env.AI`) binding and makes no direct provider
calls.** Every AI inference — the review models (OpenAI / Anthropic / Gemini /
Workers AI) **and** the codemode Durable Object agents — routes through the
**core-guardian** worker (`https://core-guardian.hacolby.workers.dev`), which
meters spend, enforces the `codra` project budget, and gates calls behind a
circuit breaker. This is non-negotiable: a direct provider call or a raw
`env.AI.run` is invisible to the budget and cannot be killed — the exact
aggressive-billing exposure this design removes.

- **Transport seam**: [`src/server/core/guardian-ai.ts`](src/server/core/guardian-ai.ts)
  wraps the org's canonical vendored client
  ([`src/lib/guardian/guardian-client.ts`](src/lib/guardian/guardian-client.ts)).
  Review-model calls go through `runGuardianInference(env, apiFormat, model, body)`
  → `POST /api/ai-router/run` with `project: "codra"`.
- **Workers AI in the AI SDK**: the codemode DOs use
  [`createGuardianWorkersAI(env)`](src/server/ai/guardian-workers-ai.ts) instead
  of `createWorkersAI({ binding: env.AI })`.
- **Auth**: two existing Secrets Store bindings — `AI_GATEWAY_TOKEN`
  (= `CLOUDFLARE_AI_GATEWAY_TOKEN`, the AI-router audience) and `WORKER_API_KEY`
  (usage / budget reads). No new secrets.
- **DO NOT** add an `ai` binding to [wrangler.jsonc](wrangler.jsonc), import a
  provider SDK, or `fetch` a provider (or the raw AI Gateway) directly. If a new
  code path needs inference, route it through guardian. Guardian already has the
  major providers configured; add the model there, not a bypass here.
- The contract is the live source of truth:
  `https://core-guardian.hacolby.workers.dev/openapi.json`.

Codra also **enforces this on every PR it sees** (regardless of review
settings): the always-on guardian-compliance check
([`src/server/core/guardian-compliance.ts`](src/server/core/guardian-compliance.ts))
flags any PR that adds AI inference not routed through core-guardian and comments
surgical integration steps. See that module's header for the detection rules.

## Platform: Cloudflare Workers + D1 only

Codra runs entirely on **Cloudflare Workers** with **Cloudflare D1 (SQLite)** as
its only database. There is **no Postgres, no Hyperdrive, and no `pg`/`postgres`
driver** anywhere in the runtime.

- The database binding is **`DB`** (a `d1_databases` binding in
  [wrangler.jsonc](wrangler.jsonc)). Access it through `getDb(env)` in
  [src/server/db/client.ts](src/server/db/client.ts), which uses
  `drizzle-orm/d1`.
- **Do not** add a Postgres/MySQL/Hyperdrive binding, a `DATABASE_URL`
  connection string, `drizzle-orm/postgres-js`, `pg`, or the `postgres` npm
  package. If a task seems to need an external relational DB, stop and ask —
  the answer is almost certainly D1 (or KV / Durable Objects for other shapes).
- Bundled Cloudflare **reference docs** under
  `src/server/skills/cloudflare/references/**` describe Hyperdrive/Postgres for
  general Cloudflare users. They are vendored documentation, **not** a
  description of this app's stack — do not treat them as a signal to wire
  Postgres into Codra.

## Database schema & migrations

- Drizzle schemas live in `src/server/db/schemas/**` (dialect: **sqlite**).
  `drizzle.config.ts` targets D1.
- Generate migrations with `npm run db:generate` (writes SQLite-dialect SQL to
  `db/migrations/d1/`).
- Apply them with `npm run migrate:local` (local D1) or `npm run migrate:remote`
  (remote D1 via `wrangler d1 migrations apply`).
- BLOB columns (e.g. `jobs.commit_sha`) are stored as byte arrays — see
  `hexToBytes`/`bytesToHex` in [src/server/db/jobs.ts](src/server/db/jobs.ts).

## Tests

- Run the suite with `npm test`. No external database is required.
- DB-backed specs use a fresh **in-memory D1 built on Node's `node:sqlite`** per
  `createTestEnv()` — see [test/d1-sqlite.ts](test/d1-sqlite.ts) and
  [test/helpers.ts](test/helpers.ts). The schema is applied from
  `db/migrations/d1/*.sql`.

## Webhooks & secrets

- GitHub webhook signatures are verified against the **`WORKER_API_KEY`**
  Secrets Store binding (`await env.WORKER_API_KEY.get()`), not a separate
  `GITHUB_WEBHOOK_SECRET`. The GitHub App's webhook secret must equal
  `WORKER_API_KEY`.

## Development & Commands

- **Build/Install**: `pnpm install`
- **Development Server**: `npm run dev`
- **Tests**: `npm test`
- **Linting**: (If applicable, generally part of standard npm checks). Follow the existing code style.

## Stack summary

- **Worker**: Cloudflare Workers, Hono, Wrangler
- **DB**: Cloudflare D1 (SQLite) via Drizzle ORM
- **Other bindings**: Cloudflare KV, Queues (+ DLQ), Durable Objects (no Workers
  AI binding — all inference routes through core-guardian)
- **AI**: all inference via **core-guardian** (see the AI-operations mandate above)
- **Dashboard**: React, Vite, Tailwind, Radix UI, Recharts

## URLs — never hardcode a base URL

The deployed base URL lives in one place: `env.APP_URL` (a `vars` entry in
[wrangler.jsonc](wrangler.jsonc)). Never hardcode a domain or a placeholder like
`codra.example.com`.

- Server: build links from `env.APP_URL` (e.g. via `FormatterService`).
- Tests: derive it — `const APP_URL = createTestEnv().APP_URL` — never a literal domain.

## Docs-gap Jules tasks & deploy workflow

- The review pipeline (`src/server/core/review.ts`) has two opt-out toggles in
  `config.review`: `jules.enabled` (docs-gap → Jules session, launched only
  on PR merge) and `deployWorkflow.enabled` (separate `codra/deploy-workflow-*`
  PR adding `.github/workflows/deploy.yml`). Both default to `true` — see
  `src/server/core/jules.ts`, `src/server/core/jules-docs-gap.ts`, and
  `src/server/core/deploy-workflow.ts`. The native review engine coordinates
  specialized reviewers (security, bugs, performance, correctness, quality, docs)
  with risk-tier-based fan-out, prompt caching, and a coordinator dedup pass;
  see `docs/architecture.md#review-engine` for the seam, engines, and config knobs.
  `review.engine` can also delegate a whole PR to `OpenCodeEngine` (Mac +
  Workers VPC/Tunnel) or `ComputerEngine` (all-Cloudflare, experimental) —
  see [docs/opencode-setup.md](docs/opencode-setup.md) for the operator
  runbook; both degrade to native automatically until provisioned.
- Auto-setting the `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN` Actions
  secrets (`src/server/core/github-secrets.ts`) requires the GitHub App's
  **Actions Secrets: write** permission; without it, Codra writes the secret
  names and setup steps into the deploy-workflow PR body instead.

## Gotchas catalog

Known hard-won gotchas live in [data/gotchas/](data/gotchas/) as
detection-signal + decisive-directive JSON (e.g. the D1 100-bound-param cap and
the FK-to-unseeded-parent 500). Add an entry when a non-obvious bug bites; seed
into the DB with `node scripts/ops/seed-gotchas.mjs`.
