# AGENTS.md — Codra conventions for AI agents

Rules for anyone (human or agent) changing this repo. Keep this file short; add a
rule only when a mistake actually happened.

## URLs — never hardcode a base URL

The deployed base URL lives in **one place**: `env.APP_URL` (a `vars` entry in
`wrangler.jsonc`, e.g. `https://codra.hacolby.workers.dev`). Do not hardcode a
domain, and never invent a placeholder like `codra.example.com`.

- **Server code:** build links from `env.APP_URL`. For PR/comment links use
  `FormatterService` (constructed with `env.APP_URL`) — `jobUrl(id)`,
  `commandFooter(botUsername)`, `formatReviewOverview(...)`. It normalizes a
  trailing slash, so pass `env.APP_URL` as-is.
- **Tests:** derive the expected URL from the env, never a literal domain:
  ```ts
  import { createTestEnv } from './helpers';
  const APP_URL = createTestEnv().APP_URL;
  expect(formatter.jobUrl('x')).toBe(`${APP_URL}/jobs/x`);
  ```

## Secrets — GitHub webhook auth

Inbound GitHub App webhooks are HMAC-verified against the **`WORKER_API_KEY`**
secrets-store binding (`await env.WORKER_API_KEY.get()`, helper
`getWorkerApiKey(env)`). There is **no** `GITHUB_WEBHOOK_SECRET`; do not add one
or list it in `wrangler.jsonc` `secrets.required`.

Read secrets-store bindings with `getSecretStoreBinding(env, NAME)` (async
`.get()`); read plain secret strings with `getSecret(env, NAME)`.

## Reviews run through the queue

PR reviews are driven end-to-end by `REVIEW_QUEUE` → `runReviewJob`
(`src/server/core/review.ts`). A webhook that creates a job **must** enqueue a
message (`phase: 'prepare'`). Do not fork a parallel review path in a Durable
Object — that is the bug that left jobs stuck in `queued`.
