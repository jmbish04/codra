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

## Stack summary

- **Worker**: Cloudflare Workers, Hono, Wrangler
- **DB**: Cloudflare D1 (SQLite) via Drizzle ORM
- **Other bindings**: Cloudflare KV, Queues (+ DLQ), Workers AI, Durable Objects
- **Dashboard**: React, Vite, Tailwind, Radix UI, Recharts
