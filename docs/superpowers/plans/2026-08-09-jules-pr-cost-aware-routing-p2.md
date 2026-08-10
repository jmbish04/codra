# Cost-Aware External Jules PR Routing (P2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:** Route *external* Jules PRs (Jules PRs not tied to a Codra session) to AI review only when the repo opted in AND the PR's CI is failing or absent — never blindly.

**Architecture:** Three sub-slices. **P2a** adds an `external_jules_enabled` per-repo toggle (mirrors #36's `docstring_enabled`). **P2b** adds a `GitHubClient` CI-status read + `hasConfiguredCI`, and subscribes `check_run`/`workflow_run` events. **P2c** ties them together: recognize an external Jules PR, and on PR-open (opted-in + no CI → review now) or on a CI-completion failure webhook (→ review), create a normal `{codeReview:true}` review job. External Jules PRs are recognized on the fly (no persisted rows).

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, Drizzle + D1, vitest node:sqlite shim.

## Global Constraints

- Mirror #36's toggle pattern exactly for `external_jules_enabled` (see P2a spots). Default **off** (cost-safe).
- External Jules PRs are **not** persisted as `jules_sessions` rows; recognize them via `detectJulesTaskId` + a `findJulesSessionBySessionId` miss. `EXTERNAL_CI`/`EXTERNAL_MANUAL` is a routing decision, not a stored stamp.
- CI-presence uses the **repo's configured workflows** (`GET /repos/{o}/{r}/actions/workflows`), not the instantaneous PR check list (avoids the open-time race). "CI failing" comes from combined status + check-runs against the PR head SHA.
- Adding `check_run`/`workflow_run` requires adding them to `supportedGitHubWebhookEvents` first (the unsupported-event guard drops anything else).
- External-Jules routing does NOT go through `extractReviewRequest` (that only handles pull_request/issue_comment); it calls `insertJob` + `REVIEW_QUEUE.send` directly.
- `@codra-app review` continues to force a review regardless (already wired).
- Idempotency: guard new jobs with the existing `findActiveJobsForPr` / `findExistingJobForHead` before enqueuing. Never throw out of the webhook.
- Tests: `createTestEnv()` in-memory D1. Spell "jules". Verify `npx tsc --noEmit` + `npm run build` (app-import specs are flaky).

---

## P2a — `external_jules_enabled` toggle (parallel workstream A)

Mirror `docstring_enabled` across exactly these spots (verbatim anchors from the code map):

1. **Schema** `src/server/db/schemas/configs/index.ts`: add after `toolbox_enabled`:
   `external_jules_enabled: integer('external_jules_enabled', { mode: 'boolean' }).notNull().default(false),`
   Then `npm run db:generate` for the migration.
2. **`@shared/schema.ts` `repoConfigRecordSchema`**: add `externalJulesEnabled: z.boolean().default(false)` (find the record schema that lists `docstringEnabled`/`toolboxEnabled` and mirror).
3. **`src/server/db/repo-configs.ts`**:
   - `mapRepo` (7-24): add `externalJulesEnabled: Boolean(row.external_jules_enabled),`.
   - `getRepoConfigRecord` (182-217) select map: add `external_jules_enabled: repoConfigs.external_jules_enabled,`.
   - `listRepoConfigs` select map (the one with `docstring_enabled`/`toolbox_enabled`): add the same column.
   - `updateRepoConfigFlags` (94-120): add `externalJulesEnabled?: boolean` to the input and `if (input.externalJulesEnabled !== undefined) set.external_jules_enabled = input.externalJulesEnabled;`.
   - `resetAllRepoConfigs` (122-137): add `external_jules_enabled: false,` to the `.set({...})`.
4. **`src/server/core/config.ts`**: `CachedConfig` (5-10) add `externalJulesEnabled: boolean;`. In `loadRepoConfig` (66-114): cache-hit branch add `externalJulesEnabled: c.externalJulesEnabled ?? false,`; DB branch `const externalJulesEnabled = existing?.externalJulesEnabled ?? false;`; include in `finalConfig`.
5. **`src/server/core/review.ts` `RepoCheckFlags` (194-199)**: add `externalJulesEnabled: boolean;`.
6. **`src/server/routes/webhook.ts` `flags:` object (226-236)**: add `externalJulesEnabled: repoConfig.externalJulesEnabled,`.
7. **UI** (`src/client/pages/repos.tsx` + the PATCH schema/route that accepts `docstringEnabled`/`toolboxEnabled`): add an "External Jules PR review" switch per repo row + include `externalJulesEnabled` in `repoConfigPatchSchema` and the PATCH handler, mirroring the existing switches. (If the repo-settings UI is a separate component, mirror there.)

**Tests (P2a):** a D1 test that `updateRepoConfigFlags({ externalJulesEnabled: true })` then `getRepoConfigRecord` returns `externalJulesEnabled: true`, default false otherwise; `resetAllRepoConfigs` sets it false. Typecheck + build.

**Deliverable:** flag exists end-to-end, defaults off, no behavior change yet.

---

## P2b — CI signal infrastructure (parallel workstream B)

1. **`GitHubClient` CI read** (`src/server/core/github.ts`, follow the `getPullRequest` idiom — `withRetry` + `requestAndCheck` GET + JSON cast):
   ```ts
   /** Combined commit status + check-runs conclusion for a ref. */
   async getRefCiStatus(owner: string, repo: string, ref: string): Promise<{ hasChecks: boolean; failing: boolean }> {
     return withRetry(`getRefCiStatus ${owner}/${repo}@${ref}`, async () => {
       const [statusRes, checksRes] = await Promise.all([
         this.requestAndCheck(`${repoApiPath(owner, repo)}/commits/${encodeURIComponent(ref)}/status`),
         this.requestAndCheck(`${repoApiPath(owner, repo)}/commits/${encodeURIComponent(ref)}/check-runs`),
       ]);
       const status = (await statusRes.json()) as { state: 'success' | 'failure' | 'pending' | 'error'; total_count: number };
       const checks = (await checksRes.json()) as { total_count: number; check_runs: { conclusion: string | null; status: string }[] };
       const hasChecks = status.total_count > 0 || checks.total_count > 0;
       const failing = status.state === 'failure' || status.state === 'error'
         || checks.check_runs.some((r) => r.conclusion === 'failure' || r.conclusion === 'timed_out' || r.conclusion === 'cancelled');
       return { hasChecks, failing };
     });
   }

   /** Does the repo have ≥1 enabled Actions workflow? (CI-presence, race-free.) */
   async hasConfiguredCI(owner: string, repo: string): Promise<boolean> {
     return withRetry(`hasConfiguredCI ${owner}/${repo}`, async () => {
       const res = await this.requestAndCheck(`${repoApiPath(owner, repo)}/actions/workflows`);
       const body = (await res.json()) as { total_count: number; workflows: { state: string }[] };
       return (body.workflows ?? []).some((w) => w.state === 'active');
     }).catch(() => false);
   }
   ```
   Note the GitHub App needs "Checks: Read" + "Commit statuses: Read" + "Actions: Read" — document in the PR that these permissions must be enabled.
2. **Events + payload types** (`src/shared/github.ts`):
   - Add `'check_run'`, `'check_suite'`, `'workflow_run'` to `supportedGitHubWebhookEvents`.
   - Add payload types carrying the associated PR head SHAs, e.g.:
     ```ts
     export type CheckWebhookPayload = {
       action: string; // 'completed' etc.
       installation?: { id: number };
       repository: { owner: { login: string }; name: string };
       check_run?: { head_sha: string; conclusion: string | null; pull_requests: { number: number }[] };
       check_suite?: { head_sha: string; conclusion: string | null; pull_requests: { number: number }[] };
       workflow_run?: { head_sha: string; conclusion: string | null; pull_requests: { number: number }[] };
     };
     ```
     Add it to the `GitHubWebhookPayload` union.
3. **Webhook dispatch skeleton** (`src/server/routes/webhook.ts`): after the `star/watch/fork` block and before `pull_request`, add a branch:
   ```ts
   if (eventName === 'check_run' || eventName === 'check_suite' || eventName === 'workflow_run') {
     const p = payload as import('@shared/github').CheckWebhookPayload;
     const detail = p.check_run ?? p.check_suite ?? p.workflow_run;
     if (p.action !== 'completed' || !detail || (detail.conclusion !== 'failure' && detail.conclusion !== 'timed_out')) {
       return finish(202, { ok: true, ignored: true }, 'no_action');
     }
     // P2c fills in: for each detail.pull_requests[], route an external Jules PR to review.
     return finish(202, { ok: true, message: 'ci_failure_noted' }, 'no_action');
   }
   ```
   In P2b this branch just acks; P2c wires the routing into it.

**Tests (P2b):** unit-test `getRefCiStatus`/`hasConfiguredCI` parsing by injecting a fake `requestAndCheck` (or extract the pure parse into a helper and test that); event-union membership test. Typecheck + build.

---

## P2c — external routing (sequential, after P2a + P2b)

1. **Extend `classifyAndLinkJulesPr`** (`src/server/core/jules-pr.ts`) return type to a discriminated result:
   `Promise<{ kind: 'diverted' } | { kind: 'external'; taskId: string } | { kind: 'none' }>` — `diverted` for the Codra-linked case (unchanged behavior), `external` when a task id is present but no eligible Codra session, `none` otherwise. Update the P1 webhook call site: `if (link.kind === 'diverted') return finish(... 'jules_pr_diverted' ...)`.
2. **On-open external routing** (`src/server/routes/webhook.ts`, in the `pull_request` block, when `link.kind === 'external'`):
   ```ts
   if (link.kind === 'external' && repoFlags.externalJulesEnabled) {
     const gh = new GitHubClient(c.env, installationId);
     const hasCI = await gh.hasConfiguredCI(owner, repo).catch(() => true); // fail-safe: assume CI → wait
     if (!hasCI) { /* no CI → review now */ enqueueExternalReview(...); }
     // CI present → do nothing; wait for the check-failure webhook.
   }
   ```
   (Load `repoConfig`/flags before this — reorder so flags are available in the PR block, or call `loadRepoConfig` earlier.)
3. **On CI-failure** (the P2b `check_run`/`workflow_run` branch): for each `detail.pull_requests[]`, `getPullRequest` → `detectJulesTaskId(body/branch)`; if it's a Jules PR AND `findJulesSessionBySessionId` misses (external) AND repo `externalJulesEnabled` → `enqueueExternalReview`.
4. **`enqueueExternalReview` helper** (shared, e.g. in `jules-pr.ts` or webhook): `getPullRequest` for head/base SHA → `findActiveJobsForPr`/`findExistingJobForHead` guard → `insertJob({ trigger:'auto', scope:{codeReview:true,docstring:false,toolbox:false}, commitSha: pr.head.sha, baseSha: pr.base.sha, ... })` → `REVIEW_QUEUE.send({ jobId, deliveryId, phase:'prepare', requestId })`. Respect `MAX_AUTO_REVIEWS_PER_PR`.

**Tests (P2c):** `classifyAndLinkJulesPr` returns `external` for a Jules-PR-with-no-Codra-session; routing decision table (opted-out → no job; opted-in + no CI → job; opted-in + CI present on open → no job; CI-failure event + opted-in external → job; duplicate guard). Mock `GitHubClient` methods + a fake queue (as `test/jules-launch.spec.ts` does).

---

## Sequencing & split

- **P2a (cursor) ∥ P2b (agy)** — disjoint files, run simultaneously; each is additive with no behavior change, so they can't break each other. Merge both to the branch after verifying each.
- **P2c** — after A+B land; the behavior change, so it gets the dual cross-model review before merge.
- Ship P2a+P2b+P2c as one PR (they're one feature) OR P2a alone first if you want the toggle visible early.

## Self-review notes
- No `jules_sessions` schema/row changes (external PRs recognized on the fly) — avoids modeling external sessions in a Codra-staged schema.
- `external_jules_enabled` threading list is exhaustive (6 code spots + migration + UI) per the code map; missing any one makes the flag silently default-off downstream.
- Fail-safe defaults: `hasConfiguredCI` errors → assume CI present → wait (never eager-review on error); toggle default off; every webhook path returns `finish(...)` and never throws.
