# Webhook Secret Fix, Delivery Transparency & Open-PR Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken GitHub webhook signature check, record every delivery with a definite outcome, surface it on a dashboard page, and add a one-click "Sync open PRs" action that recovers PRs missed while webhooks were failing.

**Architecture:** The webhook handler verifies HMAC against the `WORKER_API_KEY` Secrets Store binding, records each delivery *before* verification, and finalizes each row with a single `outcome` value at every exit. A new `/api/webhooks` router serves the list/detail views and a `sync` action that queries GitHub's open-PR list and enqueues review jobs for any PR head that has no job yet (idempotent). A new React page renders the deliveries table with an outcome filter and a payload drawer.

**Tech Stack:** Cloudflare Workers, Hono, Drizzle ORM on D1 (SQLite), React + react-router-dom, Vitest.

## Global Constraints

- Webhook HMAC secret source is **only** `await env.WORKER_API_KEY.get()` (via `getWorkerApiKey`). Do not read `GITHUB_WEBHOOK_SECRET` anywhere.
- Delivery recording must never break webhook processing — wrap every delivery DB write in try/catch and swallow (log) failures.
- The sync action must be idempotent: a PR head that already has a job is skipped.
- Tests run with `npm test`. **Prerequisite: Task 0 must land first** — at BASE the DB-backed specs are red because `createTestEnv().DB` is an empty stub. After Task 0, `createTestEnv` returns a real in-memory SQLite-backed D1 and the whole DB suite runs green. Follow existing patterns in `test/webhook-handling.spec.ts` and `test/helpers.ts` (`createTestEnv` sets `WORKER_API_KEY.get() => 'test-webhook-secret'`).
- Dashboard API routes live behind the existing `requireSession` + `requireCsrfHeader` middleware (already applied to `/api/*` in `app.ts`).
- New `insertJob` trigger value is `'sync'`; existing union is `'auto' | 'mention' | 'retry'`.

---

## Task 0: Repair the DB-backed test harness

**Why:** At BASE, every DB-touching spec (`webhook-handling`, `review-flow`, `model-service`, `api`, `resumable-queue` — 15 tests) fails with `TypeError: this.client.prepare is not a function`. Cause: `createTestEnv()` sets `DB: {} as any`, but `getDb` uses the `drizzle-orm/d1` driver, which calls `.prepare()` on the binding. The app is D1/SQLite; the `scripts/migrate.mjs` Postgres path is vestigial and never backed the app's `env.DB`. This task wires a real in-memory SQLite-backed D1 into the test env so the plan's TDD steps mean something.

**Files:**
- Modify: `test/helpers.ts` (build and inject a real D1 into `createTestEnv().DB`)
- Create: `test/d1-sqlite.ts` (a minimal D1 shim over `node:sqlite`)
- Modify: `test/setup.ts` (drop the Postgres/`TEST_DATABASE_URL` requirement now that tests use in-memory SQLite)
- Modify: `scripts/test.mjs` (stop invoking the Postgres `scripts/migrate.mjs`; keep env loading)
- Possibly modify: `package.json` (no new runtime dep — `node:sqlite` is built into Node ≥ 22.5; this repo runs Node 26)

**Interfaces:**
- Produces: `createD1(migrationsDir: string): D1Database` — a synchronous in-memory SQLite database exposing the subset of the D1 `D1Database` interface that `drizzle-orm/d1` uses: `prepare(sql) -> { bind(...params), all(), run(), first(colName?), raw() }`, plus `batch(statements)`, `exec(sql)`, and `dump()` (the latter can throw "unsupported"). `createTestEnv` calls it and assigns the result to `DB`.

### Approach

Use Node's built-in `node:sqlite` (`DatabaseSync`) — no native dependency. Apply the existing SQLite migration files from `db/migrations/d1/*.sql` (sorted by filename) at construction so the schema matches production. Each test env gets a fresh `:memory:` database.

**Critical D1 behaviors the shim must reproduce** (the existing tests depend on them):
- **BLOB round-trip as `number[]`.** `jobs.commit_sha`/`base_sha` are `blob` columns; the app writes them as `Array.from(hexToBytes(...))` (a `number[]`) and reads them back through `bytesToHex(row.commit_sha)`. Real D1 accepts a `number[]`/`ArrayBuffer` bind param for a BLOB and returns BLOB columns as `ArrayBuffer`/`number[]`. In the shim: when binding, convert a `number[]` param to a `Uint8Array` for `node:sqlite`; when reading, `node:sqlite` returns a `Uint8Array` for BLOB — return it as-is (confirm `bytesToHex` handles `Uint8Array`; it accepts `any` and iterates bytes). Verify with the `review-flow` tests, which insert and read jobs.
- **`.all()` returns `{ results, success, meta }`** in real D1, but `drizzle-orm/d1` accesses `.results`. Inspect how the installed `drizzle-orm/d1` session (`node_modules/.../src/d1/session.ts`) unwraps `.all()`/`.run()`/`.raw()`/`.first()` and match exactly those shapes. Do not guess — read that file.
- **`.run()`** must execute and return meta with `changes`/`last_row_id` where drizzle reads them.
- **`.raw()`** returns rows as arrays of column values (used by some drizzle paths).
- Parameter binding is positional (`?`). `node:sqlite` `StatementSync` supports positional params via `.all(...params)` / `.run(...params)` / `.get(...params)`.

Keep the shim minimal — implement only what `drizzle-orm/d1` actually calls (read the session source to enumerate it). Mark anything unsupported with a clear throw.

- [ ] **Step 1: Read the drizzle-d1 session to learn the exact contract**

Read `node_modules/.pnpm/drizzle-orm@*/node_modules/src/d1/session.ts` (and `sqlite-core/session.ts`). Enumerate every method/property the session reads off the binding and off prepared statements (`prepare`, `bind`, `all`, `run`, `raw`, `first`, `batch`, `values`, result `.results`/`.meta` shapes). The shim implements exactly these.

- [ ] **Step 2: Write the shim `test/d1-sqlite.ts`**

Implement `createD1(migrationsDir)` over `node:sqlite`'s `DatabaseSync`:
- Open `new DatabaseSync(':memory:')`.
- Read `db/migrations/d1/*.sql`, sort by filename, split on `--> statement-breakpoint`, and `db.exec()` each statement.
- Return an object implementing the enumerated D1 surface, with the BLOB `number[]`↔`Uint8Array` conversions on bind and the result shapes drizzle expects.

- [ ] **Step 3: Wire it into `createTestEnv`**

In `test/helpers.ts`, replace `DB: {} as any` with `DB: createD1(path.resolve(process.cwd(), 'db/migrations/d1')) as any` (import `createD1` and `path`). Each `createTestEnv()` call gets a fresh in-memory DB — confirm tests that expect isolation still pass (they create their own env).

- [ ] **Step 4: Drop the Postgres requirement**

In `test/setup.ts`, remove `TEST_DATABASE_URL` (and the Postgres-specific keys `GITHUB_APP_WEBHOOK_SECRET` if it is not actually used by any test) from `REQUIRED_TEST_ENV_KEYS`, so the suite no longer demands a Postgres DB. In `scripts/test.mjs`, remove the `run(process.execPath, ['scripts/migrate.mjs'])` line (and the `TEST_DATABASE_URL` guard) — keep `loadEnvFiles()` and the `vitest run` invocation. Do not delete `scripts/migrate.mjs` itself (it is still used for real Postgres-free D1? no — leave it on disk untouched to minimize the diff).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all previously-passing logic tests still pass AND the 15 previously-failing DB tests now pass. Zero failures. If a DB test fails on a shim gap, fix the shim (usually a result-shape or BLOB mismatch) — do not modify the app code or the existing tests to accommodate the shim.

- [ ] **Step 6: Commit**

```bash
git add test/d1-sqlite.ts test/helpers.ts test/setup.ts scripts/test.mjs package.json pnpm-lock.yaml
git commit -m "test: back createTestEnv with an in-memory node:sqlite D1 so DB specs run"
```

(Note: `package.json`/`pnpm-lock.yaml` already carry an added `postgres` devDep from environment setup; leave it — `migrate.mjs` still imports it and it is harmless.)

---

## Task 1: Fix webhook signature secret source

The root-cause fix. `handleGitHubWebhook` reads `GITHUB_WEBHOOK_SECRET` (a plain env var that is unset/stale), so every delivery fails verification. Switch to the `WORKER_API_KEY` Secrets Store binding. The existing tests already sign payloads with `WORKER_API_KEY`, so this makes them pass.

**Files:**
- Modify: `src/server/routes/webhook.ts` (import + line 24)
- Test: `test/webhook-handling.spec.ts` (already exists; asserts valid signatures are accepted)

**Interfaces:**
- Consumes: `getWorkerApiKey(env: Env): Promise<string>` from `@server/utils/secrets`
- Produces: nothing new; behavior change only

- [ ] **Step 1: Confirm the existing webhook tests currently fail**

Run: `npm test`
Expected: `test/webhook-handling.spec.ts` fails (valid-signature cases rejected, because the handler reads an unset `GITHUB_WEBHOOK_SECRET`). Note the failing assertions.

- [ ] **Step 2: Replace the secret source in the handler**

In `src/server/routes/webhook.ts`, replace the import of `getSecret` usage and line 24.

Remove:
```ts
import { getSecret } from '@server/utils/secrets';
```
```ts
    const webhookSecret = getSecret(c.env, 'GITHUB_WEBHOOK_SECRET');
```

Add the import (or extend the existing secrets import) and the new lookup:
```ts
import { getWorkerApiKey } from '@server/utils/secrets';
```
```ts
    const webhookSecret = await getWorkerApiKey(c.env);
```

(Leave `getSecret` imported only if still used elsewhere in the file — it is not, so drop it.)

- [ ] **Step 3: Run the webhook tests**

Run: `npm test`
Expected: `test/webhook-handling.spec.ts` passes — valid signatures accepted, invalid rejected.

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/webhook.ts
git commit -m "fix: verify GitHub webhooks against WORKER_API_KEY secrets-store binding"
```

---

## Task 2: Add outcome columns to webhook_deliveries

Extend the schema so each delivery carries a finalized `outcome`, the codra `action` it triggered, and links to the PR/job. Generate the D1 migration.

**Files:**
- Modify: `src/server/db/schemas/webhooks/index.ts`
- Create: migration under the drizzle output dir (generated by `db:generate`)

**Interfaces:**
- Produces: `webhookDeliveries` columns `outcome: text NOT NULL default 'received'`, `action: text`, `pr_number: integer`, `job_id: text`, `error: text`

- [ ] **Step 1: Add the columns to the Drizzle table**

In `src/server/db/schemas/webhooks/index.ts`, extend the table:
```ts
export const webhookDeliveries = sqliteTable('webhook_deliveries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  received_at: text('received_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  repository_id: integer('repository_id').references(() => repositories.id),
  delivery_id: text('delivery_id').notNull().unique(),
  event_name: text('event_name').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  outcome: text('outcome').notNull().default('received'),
  action: text('action'),
  pr_number: integer('pr_number'),
  job_id: text('job_id'),
  error: text('error'),
});
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm run db:generate`
Expected: a new migration file is created adding the five columns. Inspect it — it should `ALTER TABLE webhook_deliveries ADD COLUMN ...` for each, with `outcome` defaulting to `'received'`.

- [ ] **Step 3: Apply locally to confirm it is valid**

Run: `pnpm run migrate:local`
Expected: migration applies with no error.

- [ ] **Step 4: Commit**

```bash
git add src/server/db/schemas/webhooks/index.ts db/
git commit -m "feat: add outcome/action/pr_number/job_id/error columns to webhook_deliveries"
```

(If the generated migration lands somewhere other than `db/`, add that path instead — check `drizzle.config.ts` `out`.)

---

## Task 3: Record every delivery and finalize its outcome

Move delivery recording to *before* signature verification, and finalize a single `outcome` at each exit point of `handleGitHubWebhook`. Add a `finalizeWebhookDelivery` db helper.

**Files:**
- Modify: `src/server/db/webhook-deliveries.ts` (add `finalizeWebhookDelivery`; make `recordWebhookDelivery` tolerate an unparsed payload)
- Modify: `src/server/routes/webhook.ts` (reorder + `finish()` wrapper)
- Test: `test/webhook-handling.spec.ts` (add outcome assertions)

**Interfaces:**
- Consumes: `recordWebhookDelivery(env, { deliveryId, eventName, owner, repo, payload }): Promise<boolean>` (existing)
- Produces:
  - `type DeliveryOutcome = 'received' | 'rejected_signature' | 'invalid_payload' | 'duplicate' | 'ignored_unsupported_event' | 'ignored_no_repository' | 'ignored_no_installation' | 'ignored_repo_disabled' | 'kb_updated' | 'job_created' | 'queued' | 'no_action' | 'error'`
  - `finalizeWebhookDelivery(env, deliveryId: string, patch: { outcome: DeliveryOutcome; action?: string; prNumber?: number; jobId?: string; error?: string }): Promise<void>`

- [ ] **Step 1: Write a failing test for outcome recording**

Add to `test/webhook-handling.spec.ts` (mirror the existing valid-signature test that produces a job). After posting a valid `pull_request` webhook that creates a job, query the delivery row and assert its outcome:
```ts
it('records job_created outcome for a PR that produces a review job', async () => {
  const payloadObj = createMockPRWebhook();
  const body = JSON.stringify(payloadObj);
  const signature = await signPayload(await getWorkerApiKey(env), body);
  const deliveryId = 'delivery-outcome-1';

  const res = await app.request('http://codra.test/webhook', {
    method: 'POST',
    headers: {
      'x-github-event': 'pull_request',
      'x-github-delivery': deliveryId,
      'x-hub-signature-256': signature,
    },
    body,
  }, env);
  expect(res.status).toBe(202);

  const { getWebhookDeliveryRow } = await import('@server/db/webhook-deliveries');
  const row = await getWebhookDeliveryRow(env, deliveryId);
  expect(row?.outcome).toBe('job_created');
  expect(row?.pr_number).toBe(payloadObj.pull_request.number);
  expect(row?.job_id).toBeTruthy();
});

it('records rejected_signature for a bad signature', async () => {
  const body = JSON.stringify(createMockPRWebhook());
  const res = await app.request('http://codra.test/webhook', {
    method: 'POST',
    headers: {
      'x-github-event': 'pull_request',
      'x-github-delivery': 'delivery-rejected-1',
      'x-hub-signature-256': 'sha256=deadbeef',
    },
    body,
  }, env);
  expect(res.status).toBe(401);

  const { getWebhookDeliveryRow } = await import('@server/db/webhook-deliveries');
  const row = await getWebhookDeliveryRow(env, 'delivery-rejected-1');
  expect(row?.outcome).toBe('rejected_signature');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `getWebhookDeliveryRow` does not exist yet and outcomes are not recorded.

- [ ] **Step 3: Extend the delivery db module**

In `src/server/db/webhook-deliveries.ts`:

Add the outcome type export at the top:
```ts
export type DeliveryOutcome =
  | 'received'
  | 'rejected_signature'
  | 'invalid_payload'
  | 'duplicate'
  | 'ignored_unsupported_event'
  | 'ignored_no_repository'
  | 'ignored_no_installation'
  | 'ignored_repo_disabled'
  | 'kb_updated'
  | 'job_created'
  | 'queued'
  | 'no_action'
  | 'error';
```

`recordWebhookDelivery` already accepts `payload: unknown` — leave it; when recording before JSON parse, pass the raw string. Change nothing in its body.

Add the finalizer and a row reader:
```ts
export async function finalizeWebhookDelivery(
  env: Pick<Env, 'DB'>,
  deliveryId: string,
  patch: { outcome: DeliveryOutcome; action?: string; prNumber?: number; jobId?: string; error?: string },
) {
  const db = getDb(env);
  await db.update(webhookDeliveries)
    .set({
      outcome: patch.outcome,
      action: patch.action ?? null,
      pr_number: patch.prNumber ?? null,
      job_id: patch.jobId ?? null,
      error: patch.error ?? null,
    })
    .where(eq(webhookDeliveries.delivery_id, deliveryId));
}

export async function getWebhookDeliveryRow(
  env: Pick<Env, 'DB'>,
  deliveryId: string,
) {
  const db = getDb(env);
  return db.select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.delivery_id, deliveryId))
    .limit(1)
    .get();
}
```

- [ ] **Step 4: Reorder recording and add the `finish` wrapper in the handler**

In `src/server/routes/webhook.ts`, restructure `handleGitHubWebhook`:

1. After reading `eventName`, `deliveryId`, `signature`, `rawBody`, return 400 directly if `eventName`/`deliveryId` missing (cannot record without an id).
2. Record immediately (raw body as payload), capturing whether it was new:
```ts
const inserted = await recordWebhookDelivery(c.env, {
  deliveryId,
  eventName,
  owner: null,
  repo: null,
  payload: rawBody,
}).catch(() => true); // never block on record failure

const finish = async (
  status: 200 | 202 | 401 | 500,
  body: Record<string, unknown>,
  outcome: import('@server/db/webhook-deliveries').DeliveryOutcome,
  extra?: { action?: string; prNumber?: number; jobId?: string; error?: string },
) => {
  await finalizeWebhookDelivery(c.env, deliveryId, { outcome, ...extra }).catch(() => {});
  return c.json(body, status);
};
```
3. If `!inserted` → `return finish(202, { ok: true, duplicate: true }, 'duplicate')`.
4. Signature check: on failure `return finish(401, { ok:false, error:'Invalid webhook signature.' }, 'rejected_signature')`.
5. JSON parse failure → `return finish(400 as any, ...)` — but 400 is not in the union; instead return `jsonError` directly after finalizing: `await finalizeWebhookDelivery(c.env, deliveryId, { outcome: 'invalid_payload' }).catch(()=>{}); return jsonError('Invalid webhook JSON payload.', 400);`
6. Replace every remaining `return c.json(...)`:
   - no repository → `finish(202, {...}, 'ignored_no_repository')`
   - unsupported event → `finish(202, {...}, 'ignored_unsupported_event')`
   - star/watch/fork success → `finish(202, { ok:true, message:'kb_updated' }, 'kb_updated', { action: 'kb_update' })`
   - no installation → `finish(202, {...}, 'ignored_no_installation')`
   - repo disabled → `finish(202, {...}, 'ignored_repo_disabled')`
   - job created path → `finish(202, { ok:true, message:'delegated_to_repo_agent', job }, 'job_created', { action: 'review', prNumber: extracted.prNumber, jobId: job.id })`
   - existing-job duplicate → `finish(202, {...}, 'job_created', { action:'review', prNumber: extracted.prNumber, jobId: existingJob.id })`
   - queue fallback (`REVIEW_QUEUE.send`) → `finish(202, { ok:true, message:'queued' }, 'queued', { action: 'queued' })`
   - reaching the end without any of the above (extracted null / no commit) → `finish(202, { ok:true, ignored:true }, 'no_action')`
7. Wrap the body from the JSON-parse step onward in `try { ... } catch (err) { return finish(500, { ok:false }, 'error', { error: err instanceof Error ? err.message : String(err) }); }`.

Once the repository/owner are known you may optionally re-run `recordWebhookDelivery` is unnecessary — the row exists; `finalizeWebhookDelivery` handles updates. Repository linkage stays null for the initial insert (acceptable; the list view derives repo from payload — see Task 6).

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS — both new outcome tests, plus the existing signature/dedup tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/db/webhook-deliveries.ts src/server/routes/webhook.ts test/webhook-handling.spec.ts
git commit -m "feat: record every webhook delivery with a finalized outcome"
```

---

## Task 4: List open pull requests from GitHub

Add a paginated `listOpenPullRequests` method to `GitHubClient` — the data source for the sync action.

**Files:**
- Modify: `src/server/core/github.ts` (new method on `GitHubClient`)
- Test: `test/github-open-prs.spec.ts` (new)

**Interfaces:**
- Produces:
  ```ts
  listOpenPullRequests(owner: string, repo: string): Promise<Array<{
    number: number;
    title: string;
    authorLogin: string | null;
    headSha: string;
    headRef: string;
    baseSha: string;
    baseRef: string;
  }>>
  ```

- [ ] **Step 1: Write a failing test**

Create `test/github-open-prs.spec.ts`. Mock `fetch`/`request` at the boundary the client uses. Follow the mocking style already in `test/webhook-handling.spec.ts` (which stubs `GitHubClient`). Here, instead test the real method by stubbing the private `request` via a subclass or by mocking global `fetch`. Minimal version — stub `fetch`:
```ts
import { GitHubClient } from '@server/core/github';
import { createTestEnv } from './helpers';
import { vi } from 'vitest';

it('maps open PRs from the GitHub pulls endpoint', async () => {
  const env = createTestEnv();
  const client = new GitHubClient(env, '123');
  vi.spyOn(client as any, 'getInstallationToken').mockResolvedValue('tok');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([
    { number: 210, title: 'Feat X', user: { login: 'alice' },
      head: { sha: 'aaa', ref: 'feat-x' }, base: { sha: 'bbb', ref: 'main' } },
  ]), { status: 200, headers: { 'content-type': 'application/json' } }));

  const prs = await client.listOpenPullRequests('acme', 'core-remodel');
  expect(prs).toEqual([{
    number: 210, title: 'Feat X', authorLogin: 'alice',
    headSha: 'aaa', headRef: 'feat-x', baseSha: 'bbb', baseRef: 'main',
  }]);
  vi.restoreAllMocks();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `listOpenPullRequests` is not a function.

- [ ] **Step 3: Implement the method**

In `src/server/core/github.ts`, add to the `GitHubClient` class (mirror the pagination style of `fetchAllPages` in `services/sync/github-sync.ts` and the existing `request`/`requestAndCheck` helpers). Use `state=open&per_page=100` and follow the `Link: rel="next"` header:
```ts
async listOpenPullRequests(owner: string, repo: string) {
  return withRetry(`listOpenPullRequests ${owner}/${repo}`, async () => {
    const out: Array<{ number: number; title: string; authorLogin: string | null; headSha: string; headRef: string; baseSha: string; baseRef: string; }> = [];
    let path: string | null = `${repoApiPath(owner, repo)}/pulls?state=open&per_page=100`;
    while (path) {
      const response = await this.requestAndCheck(path);
      const page = await response.json() as any[];
      for (const pr of page) {
        out.push({
          number: pr.number,
          title: pr.title,
          authorLogin: pr.user?.login ?? null,
          headSha: pr.head.sha,
          headRef: pr.head.ref,
          baseSha: pr.base.sha,
          baseRef: pr.base.ref,
        });
      }
      const link = response.headers.get('link');
      const next = link?.match(/<([^>]+)>;\s*rel="next"/);
      path = next ? next[1] : null;
    }
    return out;
  });
}
```
Confirm `requestAndCheck` returns the raw `Response` (it does per `getPullRequestDiff` usage) and that `repoApiPath` is in scope in the file.

- [ ] **Step 4: Run the test**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/core/github.ts test/github-open-prs.spec.ts
git commit -m "feat: add GitHubClient.listOpenPullRequests"
```

---

## Task 5: Open-PR sync service and endpoint

Add a trigger-agnostic head-job check, an `'sync'` trigger, the sync service, and `POST /api/webhooks/sync`.

**Files:**
- Modify: `src/server/db/jobs.ts` (add `findAnyJobForHead`; extend `insertJob` trigger union with `'sync'`)
- Create: `src/server/services/sync/pr-sync.ts` (the sync logic)
- Create: `src/server/routes/api/webhooks.ts` (router with `POST /sync`)
- Modify: `src/server/app.ts` (register `/api/webhooks`)
- Test: `test/pr-sync.spec.ts` (new)

**Interfaces:**
- Consumes: `GitHubClient.listOpenPullRequests` (Task 4); `insertJob`, `supersedeOlderJobs` (existing); `loadRepoConfig` (existing)
- Produces:
  - `findAnyJobForHead(env, { owner, repo, prNumber, commitSha }): Promise<{ id: string } | null>`
  - `syncOpenPullRequests(env, opts?: { repoFilter?: { owner: string; repo: string } }): Promise<{ repos: Array<{ owner: string; repo: string; openPrs: number; enqueued: number; skipped: number; errors: number }>; totalEnqueued: number }>`

- [ ] **Step 1: Write a failing test for idempotent sync**

Create `test/pr-sync.spec.ts`. Seed one enabled repo (insert into `repositories` + `repo_configs`), stub `listOpenPullRequests` to return one PR, run sync twice, assert the first enqueues 1 and the second enqueues 0.
```ts
import { syncOpenPullRequests } from '@server/services/sync/pr-sync';
import { createTestEnv } from './helpers';
import { vi } from 'vitest';

it('enqueues missing open PRs once and is idempotent', async () => {
  const env = createTestEnv();
  // Seed an enabled repo (helper inserts into repositories + repo_configs)
  const { seedEnabledRepo } = await import('./helpers');
  await seedEnabledRepo(env, { installationId: 123, owner: 'acme', repo: 'core-remodel' });

  const gh = await import('@server/core/github');
  vi.spyOn(gh.GitHubClient.prototype, 'listOpenPullRequests').mockResolvedValue([
    { number: 210, title: 'X', authorLogin: 'a', headSha: 'aa', headRef: 'f', baseSha: 'bb', baseRef: 'main' },
  ]);

  const first = await syncOpenPullRequests(env);
  expect(first.totalEnqueued).toBe(1);
  const second = await syncOpenPullRequests(env);
  expect(second.totalEnqueued).toBe(0);
  vi.restoreAllMocks();
});
```
Add a `seedEnabledRepo` helper to `test/helpers.ts` that inserts a row into `repositories` and a matching `repo_configs` row with `enabled: true` using the drizzle db from `getDb(env)`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `syncOpenPullRequests` / `seedEnabledRepo` not defined.

- [ ] **Step 3: Add `findAnyJobForHead` and the `'sync'` trigger**

In `src/server/db/jobs.ts`, extend the `insertJob` trigger union:
```ts
trigger: 'auto' | 'mention' | 'retry' | 'sync';
```
Add a trigger-agnostic head check (copy `findExistingJobForHead` but drop the `eq(jobs.trigger, ...)` clause and return just the id):
```ts
export async function findAnyJobForHead(
  env: Pick<Env, 'DB'>,
  input: { owner: string; repo: string; prNumber: number; commitSha: string },
) {
  const db = getDb(env);
  const res = await db.select({ id: jobs.id })
    .from(jobs)
    .innerJoin(repositories, eq(jobs.repository_id, repositories.id))
    .where(and(
      eq(repositories.owner, input.owner),
      eq(repositories.repo, input.repo),
      eq(jobs.pr_number, input.prNumber),
      eq(jobs.commit_sha, Array.from(hexToBytes(input.commitSha))),
    ))
    .orderBy(desc(jobs.created_at))
    .limit(1)
    .get();
  return res ?? null;
}
```

- [ ] **Step 4: Implement the sync service**

Create `src/server/services/sync/pr-sync.ts`:
```ts
import { getDb } from '@server/db/client';
import { repositories, repoConfigs } from '@server/db/schemas';
import { eq, and } from 'drizzle-orm';
import { GitHubClient } from '@server/core/github';
import { loadRepoConfig } from '@server/core/config';
import { insertJob, supersedeOlderJobs, findAnyJobForHead } from '@server/db/jobs';
import { logger } from '@server/core/logger';

export async function syncOpenPullRequests(
  env: Env,
  opts?: { repoFilter?: { owner: string; repo: string } },
) {
  const db = getDb(env);
  const rows = await db.select({
    installation_id: repositories.installation_id,
    owner: repositories.owner,
    repo: repositories.repo,
  })
    .from(repoConfigs)
    .innerJoin(repositories, eq(repoConfigs.repository_id, repositories.id))
    .where(
      opts?.repoFilter
        ? and(eq(repositories.owner, opts.repoFilter.owner), eq(repositories.repo, opts.repoFilter.repo), eq(repoConfigs.enabled, true))
        : eq(repoConfigs.enabled, true),
    )
    .all();

  const summary = { repos: [] as Array<{ owner: string; repo: string; openPrs: number; enqueued: number; skipped: number; errors: number }>, totalEnqueued: 0 };

  for (const row of rows) {
    const installationId = String(row.installation_id);
    const client = new GitHubClient(env, installationId);
    const stat = { owner: row.owner, repo: row.repo, openPrs: 0, enqueued: 0, skipped: 0, errors: 0 };
    try {
      const prs = await client.listOpenPullRequests(row.owner, row.repo);
      stat.openPrs = prs.length;
      const config = await loadRepoConfig(env, { installationId, owner: row.owner, repo: row.repo });
      if (config.enabled === false) { summary.repos.push(stat); continue; }

      for (const pr of prs) {
        try {
          const existing = await findAnyJobForHead(env, { owner: row.owner, repo: row.repo, prNumber: pr.number, commitSha: pr.headSha });
          if (existing) { stat.skipped++; continue; }
          const job = await insertJob(env, {
            installationId,
            owner: row.owner,
            repo: row.repo,
            prNumber: pr.number,
            prTitle: pr.title,
            prAuthor: pr.authorLogin,
            commitSha: pr.headSha,
            baseSha: pr.baseSha,
            trigger: 'sync',
            headRef: pr.headRef,
            baseRef: pr.baseRef,
            configSnapshot: config.parsedJson,
          });
          await supersedeOlderJobs(env, { installationId, owner: row.owner, repo: row.repo, prNumber: pr.number, newJobId: job.id });
          const agentId = env.RepoAgent.idFromName(`${row.owner}/${row.repo}`);
          const agent = env.RepoAgent.get(agentId);
          await agent.fetch(new Request('https://repoagent/sync-job', {
            method: 'POST',
            body: JSON.stringify({ jobId: job.id }),
          })).catch((e: unknown) => logger.error('pr-sync agent dispatch failed', e instanceof Error ? e : new Error(String(e))));
          stat.enqueued++;
          summary.totalEnqueued++;
        } catch (e) {
          stat.errors++;
          logger.error(`pr-sync PR ${row.owner}/${row.repo}#${pr.number} failed`, e instanceof Error ? e : new Error(String(e)));
        }
      }
    } catch (e) {
      stat.errors++;
      logger.error(`pr-sync repo ${row.owner}/${row.repo} failed`, e instanceof Error ? e : new Error(String(e)));
    }
    summary.repos.push(stat);
  }
  return summary;
}
```
Confirm the `RepoAgent` DO handles a POST it does not recognize gracefully; if its existing `/webhook` route is the only entrypoint, reuse the queue instead: `await env.REVIEW_QUEUE.send({ jobId: job.id, deliveryId: crypto.randomUUID(), phase: 'prepare', requestId: crypto.randomUUID() })` — matching the shape used in `routes/api/jobs.ts` retry. **Use the queue path** (`REVIEW_QUEUE.send`) rather than a new DO route to avoid touching the DO; replace the `agent.fetch(...)` block above with the queue send.

- [ ] **Step 5: Create the webhooks router with the sync endpoint**

Create `src/server/routes/api/webhooks.ts`:
```ts
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '@server/env';
import { syncOpenPullRequests } from '@server/services/sync/pr-sync';

export function createWebhooksRouter() {
  const app = new Hono<AppEnv>();

  app.post('/sync', async (c) => {
    const repoParam = c.req.query('repo');
    let repoFilter: { owner: string; repo: string } | undefined;
    if (repoParam) {
      const [owner, repo] = repoParam.split('/');
      if (!owner || !repo) return c.json({ ok: false, error: 'repo must be owner/name' }, 400);
      repoFilter = { owner, repo };
    }
    const summary = await syncOpenPullRequests(c.env, { repoFilter });
    return c.json({ ok: true, ...summary }, 202);
  });

  return app;
}
```

- [ ] **Step 6: Register the router**

In `src/server/app.ts`, add the import and route (next to the other `/api/*` routes):
```ts
import { createWebhooksRouter } from '@server/routes/api/webhooks';
```
```ts
  app.route('/api/webhooks', createWebhooksRouter());
```

- [ ] **Step 7: Run the tests**

Run: `npm test`
Expected: PASS — first sync enqueues 1, second enqueues 0.

- [ ] **Step 8: Commit**

```bash
git add src/server/db/jobs.ts src/server/services/sync/pr-sync.ts src/server/routes/api/webhooks.ts src/server/app.ts test/pr-sync.spec.ts test/helpers.ts
git commit -m "feat: add open-PR sync action to recover missed reviews"
```

---

## Task 6: Delivery list & detail API

Add `GET /api/webhooks` (filterable list) and `GET /api/webhooks/:id` (full row) to the router from Task 5.

**Files:**
- Modify: `src/server/db/webhook-deliveries.ts` (add `listWebhookDeliveries`, `getWebhookDeliveryById`)
- Modify: `src/server/routes/api/webhooks.ts` (add the two GET routes)
- Test: `test/webhook-deliveries-list.spec.ts` (new)

**Interfaces:**
- Produces:
  - `listWebhookDeliveries(env, q: { outcome?: string; event?: string; owner?: string; repo?: string; limit: number; offset: number }): Promise<{ items: Array<{ id: string; received_at: string; event_name: string; outcome: string; action: string | null; pr_number: number | null; job_id: string | null; error: string | null; owner: string | null; repo: string | null }>; total: number }>`
  - `getWebhookDeliveryById(env, id: string): Promise<{ ...row; payload: unknown } | null>`

- [ ] **Step 1: Write a failing test**

Create `test/webhook-deliveries-list.spec.ts`. Insert two delivery rows (one `job_created`, one `rejected_signature`) via `recordWebhookDelivery` + `finalizeWebhookDelivery`, then assert the list returns both and the `outcome` filter narrows to one.
```ts
import { recordWebhookDelivery, finalizeWebhookDelivery, listWebhookDeliveries } from '@server/db/webhook-deliveries';
import { createTestEnv } from './helpers';

it('lists deliveries and filters by outcome', async () => {
  const env = createTestEnv();
  await recordWebhookDelivery(env, { deliveryId: 'd1', eventName: 'pull_request', owner: null, repo: null, payload: '{}' });
  await finalizeWebhookDelivery(env, 'd1', { outcome: 'job_created', action: 'review', prNumber: 5, jobId: 'j1' });
  await recordWebhookDelivery(env, { deliveryId: 'd2', eventName: 'pull_request', owner: null, repo: null, payload: '{}' });
  await finalizeWebhookDelivery(env, 'd2', { outcome: 'rejected_signature' });

  const all = await listWebhookDeliveries(env, { limit: 50, offset: 0 });
  expect(all.total).toBeGreaterThanOrEqual(2);

  const onlyJobs = await listWebhookDeliveries(env, { outcome: 'job_created', limit: 50, offset: 0 });
  expect(onlyJobs.items.every((r) => r.outcome === 'job_created')).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `listWebhookDeliveries` not defined.

- [ ] **Step 3: Implement the db functions**

In `src/server/db/webhook-deliveries.ts` add (owner/repo derived by left-joining `repositories` on `repository_id`, which may be null — payload also carries repo, but the list can show null/repo from the join):
```ts
import { desc, eq, and, sql } from 'drizzle-orm';
import { repositories, webhookDeliveries } from './schemas';

export async function listWebhookDeliveries(
  env: Pick<Env, 'DB'>,
  q: { outcome?: string; event?: string; owner?: string; repo?: string; limit: number; offset: number },
) {
  const db = getDb(env);
  const conds = [];
  if (q.outcome) conds.push(eq(webhookDeliveries.outcome, q.outcome));
  if (q.event) conds.push(eq(webhookDeliveries.event_name, q.event));
  if (q.owner) conds.push(eq(repositories.owner, q.owner));
  if (q.repo) conds.push(eq(repositories.repo, q.repo));
  const where = conds.length ? and(...conds) : undefined;

  const items = await db.select({
    id: webhookDeliveries.id,
    received_at: webhookDeliveries.received_at,
    event_name: webhookDeliveries.event_name,
    outcome: webhookDeliveries.outcome,
    action: webhookDeliveries.action,
    pr_number: webhookDeliveries.pr_number,
    job_id: webhookDeliveries.job_id,
    error: webhookDeliveries.error,
    owner: repositories.owner,
    repo: repositories.repo,
  })
    .from(webhookDeliveries)
    .leftJoin(repositories, eq(webhookDeliveries.repository_id, repositories.id))
    .where(where)
    .orderBy(desc(webhookDeliveries.received_at))
    .limit(q.limit)
    .offset(q.offset)
    .all();

  const totalRow = await db.select({ c: sql<number>`count(*)` })
    .from(webhookDeliveries)
    .leftJoin(repositories, eq(webhookDeliveries.repository_id, repositories.id))
    .where(where)
    .get();

  return { items, total: totalRow?.c ?? 0 };
}

export async function getWebhookDeliveryById(env: Pick<Env, 'DB'>, id: string) {
  const db = getDb(env);
  const row = await db.select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, id))
    .limit(1)
    .get();
  return row ? { ...row, payload: parseJsonColumn(row.payload, null) } : null;
}
```
`parseJsonColumn` is already imported at the top of the file (used by `getWebhookDelivery`).

- [ ] **Step 4: Add the GET routes**

In `src/server/routes/api/webhooks.ts`:
```ts
import { listWebhookDeliveries, getWebhookDeliveryById } from '@server/db/webhook-deliveries';
```
```ts
  app.get('/', async (c) => {
    const q = c.req.query();
    const limit = Math.min(Number(q.limit) || 50, 200);
    const offset = Number(q.offset) || 0;
    const result = await listWebhookDeliveries(c.env, {
      outcome: q.outcome || undefined,
      event: q.event || undefined,
      owner: q.owner || undefined,
      repo: q.repo || undefined,
      limit,
      offset,
    });
    return c.json(result);
  });

  app.get('/:id', async (c) => {
    const row = await getWebhookDeliveryById(c.env, c.req.param('id'));
    if (!row) return c.json({ ok: false, error: 'Delivery not found.' }, 404);
    return c.json({ delivery: row });
  });
```
Order matters in Hono: register `/sync` and `/` and `/:id` such that `/sync` (POST) and `/:id` (GET) do not collide — they differ by method and the literal `sync` only matches POST, so GET `/:id` is fine.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/db/webhook-deliveries.ts src/server/routes/api/webhooks.ts test/webhook-deliveries-list.spec.ts
git commit -m "feat: add webhook delivery list and detail API"
```

---

## Task 7: Webhooks dashboard page

Add the React page: filterable table, outcome badges, payload drawer, and the "Sync open PRs" button. Wire the route and nav.

**Files:**
- Create: `src/client/pages/webhooks.tsx`
- Modify: `src/client/main.tsx` (lazy import + route under `AppShell`)
- Modify: `src/client/components/layout/app-shell.tsx` (nav link)
- Test: manual (frontend has no unit harness for pages; verify via `npm run build` typecheck + a dev smoke check)

**Interfaces:**
- Consumes: `GET /api/webhooks`, `GET /api/webhooks/:id`, `POST /api/webhooks/sync`

- [ ] **Step 1: Build the page component**

Create `src/client/pages/webhooks.tsx`. Follow the data-fetching and layout patterns already used in `src/client/pages/jobs.tsx` (same fetch helper, table, and toast utilities — open that file and reuse its imports/hooks rather than inventing new ones). The page must:
- Fetch `GET /api/webhooks` with the current filters (outcome/event/repo) into state.
- Render a table: columns Time (`received_at`), Event, Repo (`owner/repo` or `—`), Outcome (badge), Detail (PR number linked to `/jobs/{job_id}` when `job_id` present, else action or error).
- Provide outcome filter chips covering the taxonomy classes: All, Job created (`job_created`), No action (`no_action`), Ignored (`ignored_*` — client-side group), Rejected (`rejected_signature`,`invalid_payload`), Error (`error`). For grouped filters, request the specific `outcome` per chip; the "Ignored" chip may fetch without server filter and filter client-side by `outcome.startsWith('ignored')`.
- Badge color: green for `job_created`/`kb_updated`/`queued`; gray for `no_action`/`ignored_*`; red for `rejected_signature`/`invalid_payload`/`error`.
- Row click → open a drawer/dialog that calls `GET /api/webhooks/:id` and shows pretty-printed `payload`, `outcome`, `error`, and a job link.
- Header button "Sync open PRs" → `POST /api/webhooks/sync`, disable while pending, then toast `` `Enqueued ${totalEnqueued} review(s)` `` and refresh the list.

Use the project's existing UI primitives (badge, button, dialog/drawer, table) from `src/client/components` — check what `jobs.tsx` imports and match it. Include the CSRF header exactly as other mutating client calls do (inspect an existing `POST` in `jobs.tsx` for the header pattern).

- [ ] **Step 2: Wire the route**

In `src/client/main.tsx`, add the lazy import alongside the others and a child route under the `AppShell` element:
```ts
const WebhooksPage = lazy(() => import('./pages/webhooks'));
```
```tsx
      { path: 'webhooks', element: withSuspense(WebhooksPage) },
```

- [ ] **Step 3: Add the nav link**

In `src/client/components/layout/app-shell.tsx`, add to the `links` array (import a suitable icon from `lucide-react`, e.g. `Webhook`):
```ts
  { to: '/webhooks', label: 'Webhooks', icon: Webhook, end: false },
```

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 5: Smoke-test in dev**

Run: `npm run dev`
Open `/webhooks`. Confirm the table renders, filter chips work, a row opens the drawer with payload, and the "Sync open PRs" button returns a summary toast. (If no deliveries exist yet, trigger one by opening/pushing a PR on an enabled repo, or run the sync.)

- [ ] **Step 6: Commit**

```bash
git add src/client/pages/webhooks.tsx src/client/main.tsx src/client/components/layout/app-shell.tsx
git commit -m "feat: add webhook deliveries dashboard page with open-PR sync"
```

---

## Rollout (after all tasks land)

1. Deploy: `npm run deploy` (builds, runs `migrate:remote`, `wrangler deploy`).
2. In the GitHub App settings, set the webhook secret equal to the `WORKER_API_KEY` value.
3. Open a test PR on an enabled repo; confirm a new delivery records `outcome = job_created` on `/webhooks`.
4. Click **Sync open PRs** to enqueue reviews for `core-remodel` #203–#210 and any other open PRs missed during the outage.

## Self-Review Notes

- **Spec coverage:** Part 1 → Task 1; Part 2 schema → Task 2, flow → Task 3; Part 3 client → Task 4, service/endpoint → Task 5; Part 4 API → Task 6, frontend → Task 7. All spec sections covered.
- **Idempotence:** Task 5 uses `findAnyJobForHead` (trigger-agnostic) so re-runs enqueue nothing — matches the "scream if I have to click each one" requirement: one button, safe to repeat.
- **Dispatch decision:** Task 5 Step 4 resolves to the `REVIEW_QUEUE.send` path (not a new DO route), reusing the exact message shape from `routes/api/jobs.ts` retry — no Durable Object changes.
- **Type consistency:** `DeliveryOutcome` defined once in Task 3 and reused in Tasks 3/6; `listOpenPullRequests` shape defined in Task 4 and consumed unchanged in Task 5; `insertJob` trigger union extended once in Task 5 and used there.
