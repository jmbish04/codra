# AGENTS.md

Guidance for AI agents working in this repository.

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
- **Linting**: `npm run typecheck`

## Stack summary

- **Worker**: Cloudflare Workers, Hono, Wrangler
- **DB**: Cloudflare D1 (SQLite) via Drizzle ORM
- **Other bindings**: Cloudflare KV, Queues (+ DLQ), Workers AI, Durable Objects
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
  `src/server/core/deploy-workflow.ts`.
- Auto-setting the `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN` Actions
  secrets (`src/server/core/github-secrets.ts`) requires the GitHub App's
  **Actions Secrets: write** permission; without it, Codra writes the secret
  names and setup steps into the deploy-workflow PR body instead.

## Gotchas catalog

Known hard-won gotchas live in [data/gotchas/](data/gotchas/) as
detection-signal + decisive-directive JSON (e.g. the D1 100-bound-param cap and
the FK-to-unseeded-parent 500). Add an entry when a non-obvious bug bites; seed
into the DB with `node scripts/ops/seed-gotchas.mjs`.
