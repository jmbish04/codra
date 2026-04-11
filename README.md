# Codra

Codra is a private PR review bot built for Cloudflare Workers, Hono, React, Queues, and Neon.

## Quick Start

1. `npm install`
2. Copy `.dev.vars.example` to `.dev.vars` and fill in local-only values
3. Create the Cloudflare KV and Queue resources referenced by [wrangler.jsonc](/C:/Users/devar/Dropbox/Documents/GitHub/codra/wrangler.jsonc)
4. Run the SQL in [db/migrations/001_initial.sql](/C:/Users/devar/Dropbox/Documents/GitHub/codra/db/migrations/001_initial.sql) against your Neon database
5. `npm run dev`

## Production Env And Secrets

Codra uses three configuration channels:

- `vars` in [wrangler.jsonc](/C:/Users/devar/Dropbox/Documents/GitHub/codra/wrangler.jsonc) for non-sensitive values that can live in source control
- Cloudflare Worker secrets for credentials and database URLs
- local `.dev.vars` for development-only secret injection when running `wrangler dev`

Do not put secrets into `vars`. Cloudflare's current guidance is to use Worker secrets for sensitive values and keep `.dev.vars` out of git.

### Non-sensitive `vars`

These values are committed in `wrangler.jsonc` because they are safe to expose and should remain consistent across deploys:

- `BOT_USERNAME`: GitHub app bot username used in outbound API calls
- `ENVIRONMENT`: deployment label such as `production`
- `GEMINI_MODEL`: default Gemini model name

If you later introduce staging or preview environments, keep each environment's non-secret values in Wrangler config and continue storing credentials as secrets.

### Required Worker secrets

Configure these with Wrangler before deploying:

- `APP_PRIVATE_KEY`: GitHub App private key PEM
- `GITHUB_APP_ID`: GitHub App ID
- `GITHUB_APP_WEBHOOK_SECRET`: webhook signature secret
- `GEMINI_API_KEY`: Gemini API key
- `NEON_DATABASE_URL`: Neon connection string
- `DASHBOARD_PASSWORD`: dashboard login password

Example commands:

```bash
npx wrangler secret put APP_PRIVATE_KEY
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_APP_WEBHOOK_SECRET
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put NEON_DATABASE_URL
npx wrangler secret put DASHBOARD_PASSWORD
```

For local development, put the same keys in `.dev.vars`. The checked-in [.dev.vars.example](/C:/Users/devar/Dropbox/Documents/GitHub/codra/.dev.vars.example) shows the expected shape without containing real credentials.

## Cloudflare Bindings

### Wrangler config

[wrangler.jsonc](/C:/Users/devar/Dropbox/Documents/GitHub/codra/wrangler.jsonc) is the source of truth for runtime bindings:

- `APP_KV`: KV namespace used for cached installation tokens, session state, and app config
- `REVIEW_QUEUE`: producer binding used to enqueue review jobs
- queue consumer config: binds the Worker as the consumer for `codra-review-jobs`
- `AI`: Workers AI binding
- `ASSETS`: static asset binding for the React app

When you change bindings, run `npm run build` so Wrangler regenerates [src/server/worker-env.d.ts](/C:/Users/devar/Dropbox/Documents/GitHub/codra/src/server/worker-env.d.ts).

### KV

Create the production KV namespace and set the resulting IDs in `wrangler.jsonc`.

```bash
npx wrangler kv namespace create APP_KV
npx wrangler kv namespace create APP_KV --preview
```

Then copy the returned IDs into:

- `kv_namespaces[].id`: production namespace ID
- `kv_namespaces[].preview_id`: preview/remote-dev namespace ID

Notes:

- `wrangler dev` uses local storage by default for KV, which is safer for day-to-day local development
- use remote development only when you explicitly need to exercise real Cloudflare-bound state
- this app stores cache-like and session-like data in KV, so use a dedicated namespace per environment instead of sharing one namespace across production and staging

### Queues

Codra uses one producer queue and one dead-letter queue:

- `codra-review-jobs`: primary queue
- `codra-review-dlq`: dead-letter queue for messages that exceed retry policy

Create them before deploying:

```bash
npx wrangler queues create codra-review-jobs
npx wrangler queues create codra-review-dlq
```

The current queue binding strategy in `wrangler.jsonc` is:

- producer binding `REVIEW_QUEUE` sends jobs to `codra-review-jobs`
- this Worker also consumes `codra-review-jobs`
- failed messages are routed to `codra-review-dlq`
- `max_batch_size` is `1` so review jobs execute in isolation
- `max_batch_timeout` is `5` seconds
- `max_retries` is `3`

Use distinct queue names per environment if you add staging, because sharing queues across environments makes retries and dead-letter handling much harder to reason about.

## Neon

`NEON_DATABASE_URL` must be stored as a secret, not a Wrangler var.

For the Worker runtime, use Neon's pooled connection string. Neon's current documentation recommends pooled connections for serverless and edge workloads, and those URLs include `-pooler` in the hostname.

Example shape:

```text
postgresql://<user>:<password>@<endpoint>-pooler.<region>.aws.neon.tech/<db>?sslmode=require&channel_binding=require
```

Operational guidance:

- use the pooled Neon URL for the deployed Worker runtime
- use a direct, non-pooled Neon connection for schema migrations if your migration tooling requires session-level behavior
- rotate the database password in Neon, then immediately update `NEON_DATABASE_URL` with `wrangler secret put`
- keep production and non-production data on separate Neon branches or databases

## Local Development

1. Copy `.dev.vars.example` to `.dev.vars`
2. Fill in local secrets
3. Confirm `wrangler.jsonc` points to the right Cloudflare account and binding IDs
4. Start the app with `npm run dev`

If you use `.dev.vars`, Wrangler will load local secrets for development. Keep that file untracked.

## Scripts

- `npm run dev` runs the client build watcher and `wrangler dev` together.
- `npm run build` builds the React SPA and refreshes Worker env types.
- `npm run test` runs the Vitest suite.
- `npm run deploy` builds and deploys the Worker.
