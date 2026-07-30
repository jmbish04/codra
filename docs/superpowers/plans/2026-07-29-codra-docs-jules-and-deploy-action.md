# Codra docs-gap Jules tasks + deployment GitHub Action — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach Codra to (a) stage a Jules coding-agent task when a reviewed repo's docs are lacking and launch it once the PR merges, and (b) open a separate PR adding a Cloudflare deploy GitHub Action while setting the repo's deploy secrets.

**Architecture:** Two new best-effort steps run in the existing review pipeline (`runReview` in `src/server/core/review.ts`) right after `Standardization`. The docs-gap step writes a `staged` row to a new `jules_sessions` D1 table and comments on the PR; a new `merged === true` branch in the webhook handler launches the Jules REST session on merge. The deploy step opens a `codra/deploy-workflow-*` PR and encrypts+PUTs Actions secrets via the GitHub API (libsodium sealed box), degrading to PR-body instructions when the App lacks permission. A Jules-session card is added to the existing Codra Actions dashboard page.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, Drizzle ORM on D1, React (Vite) SPA, Vitest, `libsodium-wrappers` (new), Jules REST API (`https://jules.googleapis.com/v1alpha`), GitHub REST API.

## Global Constraints

- All new external calls (Jules REST, GitHub secrets/commits API, model calls) are best-effort: log + degrade, NEVER throw out of `runReview` or the webhook handler.
- Jules sessions launch ONLY on `pull_request.action === 'closed'` with `merged === true`. Never on close-without-merge.
- Secret values are read at call time via `getSecretStoreBinding` and NEVER logged or persisted.
- Jules REST auth header is `X-Goog-Api-Key: <key>` (NOT `Authorization: Bearer`). Base URL `https://jules.googleapis.com/v1alpha`.
- Jules source name format is exactly `sources/github/{owner}/{repo}`.
- Config toggles `review.jules.enabled` and `review.deployWorkflow.enabled` both default `true`.
- Docstring analysis covers extensions: `.ts .tsx .js .jsx .mjs .cjs .py .sql`.
- Tests are Vitest `.spec.ts` files in `test/`. Prefer pure-function tests. Per the repo's known vitest quirk, specs that import the full app/orchestrator can fail spuriously — verify integration wiring with `npm run typecheck` and `npm run build`, not app-import specs.
- Use existing helpers: `getSecretStoreBinding(env, name)` (`src/server/utils/secrets.ts`), `recordAgentAction` (`src/server/db/agent-actions.ts`), `updateJobStep` (`src/server/db/jobs.ts`), `getProjectContext` (`src/server/core/project-context.ts`), `CopyButton` (`src/client/components/ui/copy-button.tsx`).
- Never hand-roll the sealed-box crypto; use `libsodium-wrappers`' `crypto_box_seal`.
- Commit after every task with a conventional-commit message.

---

## File Structure

New:
- `src/server/core/docstrings.ts` — pure docstring-coverage analyzer (Task 1).
- `src/server/db/schemas/jules-sessions/index.ts` — Drizzle table (Task 2).
- `src/server/db/jules-sessions.ts` — DB helpers (Task 2).
- `src/server/services/jules.ts` — Jules REST client (Task 3).
- `src/server/core/jules-docs-gap.ts` — gap detection + prompt builder (Task 4).
- `src/server/core/jules.ts` — launch-on-merge orchestration (Task 7).
- `src/server/routes/api/jules-sessions.ts` — read API (Task 8).
- `src/server/core/github-secrets.ts` — sealed-box + set-secrets orchestration (Task 9).
- `src/server/core/deploy-workflow.ts` — deploy-PR gate + builder (Task 10).
- Tests: `test/docstrings.spec.ts`, `test/jules-sessions-db.spec.ts`, `test/jules-service.spec.ts`, `test/jules-docs-gap.spec.ts`, `test/config-jules-deploy.spec.ts`, `test/github-secrets.spec.ts`, `test/deploy-workflow.spec.ts`.

Modified:
- `src/server/db/schemas/index.ts` — export new schema (Task 2).
- `src/shared/schema.ts` — config toggles (Task 5).
- `src/server/core/review.ts` — two new pipeline steps (Tasks 6, 10).
- `src/server/routes/webhook.ts` — merge → launch Jules (Task 7).
- `src/server/core/github.ts` + `src/server/services/github.ts` — Actions public-key + put-secret (Task 9).
- `src/shared/api.ts` + `src/client/lib/api.ts` + `src/client/pages/actions.tsx` + `src/server/app.ts` (Task 8).
- `package.json` — `libsodium-wrappers` (Task 9).

---

## Task 1: Docstring coverage analyzer (pure)

**Files:**
- Create: `src/server/core/docstrings.ts`
- Test: `test/docstrings.spec.ts`

**Interfaces:**
- Produces: `analyzePrFileDocstrings(fileName: string, fileContent: string): DocstringAnalysisResult` and `type DocstringAnalysisResult = { fileName: string; totalFunctions: number; functionsWithDocstrings: number; functionsMissingDocstrings: string[]; requiresJulesTask: boolean }`. Also `analyzeChangedFiles(files: { path: string; content: string }[]): DocstringAnalysisResult[]` returning only results with `functionsMissingDocstrings.length > 0`.

- [ ] **Step 1: Write the failing test** — `test/docstrings.spec.ts`

```ts
import { describe, it, expect } from 'vitest';
import { analyzePrFileDocstrings, analyzeChangedFiles } from '@server/core/docstrings';

describe('analyzePrFileDocstrings', () => {
  it('flags a TS function missing JSDoc and counts one with it', () => {
    const src = [
      '/** does a thing */',
      'export function documented() { return 1; }',
      'export function undocumented() { return 2; }',
    ].join('\n');
    const r = analyzePrFileDocstrings('a.ts', src);
    expect(r.totalFunctions).toBe(2);
    expect(r.functionsWithDocstrings).toBe(1);
    expect(r.functionsMissingDocstrings).toEqual(['undocumented']);
  });

  it('detects Python docstrings under a def', () => {
    const src = ['def a():', '    """doc"""', '    return 1', 'def b():', '    return 2'].join('\n');
    const r = analyzePrFileDocstrings('x.py', src);
    expect(r.functionsWithDocstrings).toBe(1);
    expect(r.functionsMissingDocstrings).toEqual(['b']);
  });

  it('detects SQL function comments', () => {
    const src = ['-- comment', 'CREATE FUNCTION foo() RETURNS int AS $$ $$;', 'CREATE PROCEDURE bar() AS $$ $$;'].join('\n');
    const r = analyzePrFileDocstrings('s.sql', src);
    expect(r.functionsWithDocstrings).toBe(1);
    expect(r.functionsMissingDocstrings).toEqual(['bar']);
  });

  it('sets requiresJulesTask when missing outnumber documented', () => {
    const src = 'export function a(){}\nexport function b(){}\n/** d */\nexport function c(){}';
    expect(analyzePrFileDocstrings('a.ts', src).requiresJulesTask).toBe(true);
  });

  it('ignores unsupported extensions', () => {
    const r = analyzePrFileDocstrings('README.md', '# hi');
    expect(r.totalFunctions).toBe(0);
    expect(r.requiresJulesTask).toBe(false);
  });
});

describe('analyzeChangedFiles', () => {
  it('returns only files with missing docstrings', () => {
    const out = analyzeChangedFiles([
      { path: 'good.ts', content: '/** d */\nexport function a(){}' },
      { path: 'bad.ts', content: 'export function b(){}' },
      { path: 'note.md', content: 'x' },
    ]);
    expect(out.map((r) => r.fileName)).toEqual(['bad.ts']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/docstrings.spec.ts`
Expected: FAIL — module `@server/core/docstrings` not found.

- [ ] **Step 3: Write minimal implementation** — `src/server/core/docstrings.ts`

Port the analyzer from the spec verbatim, add `analyzeChangedFiles`, and a `// ponytail: regex heuristic, some false positives; upgrade to an AST parser only if noise warrants` comment.

```ts
export interface DocstringAnalysisResult {
  fileName: string;
  totalFunctions: number;
  functionsWithDocstrings: number;
  functionsMissingDocstrings: string[];
  requiresJulesTask: boolean;
}

// ponytail: regex heuristic, some false positives; upgrade to an AST parser only if noise warrants.
export function analyzePrFileDocstrings(fileName: string, fileContent: string): DocstringAnalysisResult {
  const result: DocstringAnalysisResult = {
    fileName, totalFunctions: 0, functionsWithDocstrings: 0, functionsMissingDocstrings: [], requiresJulesTask: false,
  };
  const extension = fileName.split('.').pop()?.toLowerCase() || '';

  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(extension)) {
    const tsRegex = /(?:(\/\*\*[\s\S]*?\*\/)\s*)?(?:(?:export\s+|default\s+|async\s+)*function\s+([a-zA-Z0-9_$]+)|(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)\s*=>|[a-zA-Z0-9_$]+\s*=>|function\s*\())/g;
    let match: RegExpExecArray | null;
    while ((match = tsRegex.exec(fileContent)) !== null) {
      const hasDocstring = !!match[1];
      const funcName = match[2] || match[3];
      if (!funcName) continue;
      result.totalFunctions++;
      if (hasDocstring) result.functionsWithDocstrings++;
      else result.functionsMissingDocstrings.push(funcName);
    }
  } else if (extension === 'py') {
    const pyRegex = /^[ \t]*(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*(?:->[^:]+)?:[ \t]*(?:\r?\n[ \t]*(?:("""[\s\S]*?""")|('''[\s\S]*?''')))?/gm;
    let match: RegExpExecArray | null;
    while ((match = pyRegex.exec(fileContent)) !== null) {
      const funcName = match[1];
      const hasDocstring = !!match[2] || !!match[3];
      result.totalFunctions++;
      if (hasDocstring) result.functionsWithDocstrings++;
      else result.functionsMissingDocstrings.push(funcName);
    }
  } else if (extension === 'sql') {
    const sqlRegex = /(?:(\/\*[\s\S]*?\*\/|(?:--[^\n]*\n\s*)+)\s*)?CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+([a-zA-Z0-9_.]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = sqlRegex.exec(fileContent)) !== null) {
      const hasDocstring = !!match[1];
      const funcName = match[2];
      result.totalFunctions++;
      if (hasDocstring) result.functionsWithDocstrings++;
      else result.functionsMissingDocstrings.push(funcName);
    }
  }

  result.requiresJulesTask = result.functionsMissingDocstrings.length > result.functionsWithDocstrings;
  return result;
}

/** Analyze a set of changed files; returns only those with at least one missing docstring. */
export function analyzeChangedFiles(files: { path: string; content: string }[]): DocstringAnalysisResult[] {
  return files
    .map((f) => analyzePrFileDocstrings(f.path, f.content))
    .filter((r) => r.functionsMissingDocstrings.length > 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/docstrings.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/core/docstrings.ts test/docstrings.spec.ts
git commit -m "feat: docstring coverage analyzer for Jules docs tasks"
```

---

## Task 2: `jules_sessions` table + DB helpers + migration

**Files:**
- Create: `src/server/db/schemas/jules-sessions/index.ts`
- Modify: `src/server/db/schemas/index.ts`
- Create: `src/server/db/jules-sessions.ts`
- Test: `test/jules-sessions-db.spec.ts`

**Interfaces:**
- Produces:
  - `julesSessions` Drizzle table.
  - `type JulesSessionState = 'staged' | 'launched' | 'skipped' | 'error'`.
  - `stageJulesSession(env, input): Promise<Row>` where `input = { owner; repo; triggeringPrNumber; triggeringJobId?; prompt; gapSummary; prCommentId?: number | null }`. Upserts on non-terminal `(owner, repo, triggering_pr_number)`.
  - `listStagedJulesSessions(env, { owner; repo; prNumber }): Promise<Row[]>` (state === 'staged').
  - `markJulesLaunched(env, id, { sessionId; sessionUrl; sessionState }): Promise<void>`.
  - `markJulesOutcome(env, id, { state: 'skipped' | 'error'; errorMsg?: string; prCommentId?: number | null }): Promise<void>`.
  - `listJulesSessions(env, { owner?; repo?; limit; offset }): Promise<Row[]>`.
  - `Row` type = table `$inferSelect`.

- [ ] **Step 1: Write the failing test** — `test/jules-sessions-db.spec.ts`

Use the in-memory D1 harness like other db specs (`test/d1-sqlite.ts` / `test/helpers.ts`). Inspect an existing db spec (e.g. `test/webhook-deliveries.spec.ts`) for the exact harness import + how `env.DB` is provided, and follow it.

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestEnv } from './helpers'; // match the harness used by other db specs
import {
  stageJulesSession, listStagedJulesSessions, markJulesLaunched, markJulesOutcome, listJulesSessions,
} from '@server/db/jules-sessions';

describe('jules-sessions db', () => {
  let env: any;
  beforeEach(async () => { env = await makeTestEnv(); });

  it('stages, lists, launches, and reflects state', async () => {
    const row = await stageJulesSession(env, {
      owner: 'o', repo: 'r', triggeringPrNumber: 7, triggeringJobId: 'j1',
      prompt: 'P', gapSummary: 'gaps', prCommentId: 123,
    });
    expect(row.state).toBe('staged');

    const staged = await listStagedJulesSessions(env, { owner: 'o', repo: 'r', prNumber: 7 });
    expect(staged).toHaveLength(1);

    await markJulesLaunched(env, row.id, { sessionId: 'sid', sessionUrl: 'https://jules.google.com/session/sid', sessionState: 'QUEUED' });
    const afterLaunch = await listStagedJulesSessions(env, { owner: 'o', repo: 'r', prNumber: 7 });
    expect(afterLaunch).toHaveLength(0); // no longer 'staged'

    const all = await listJulesSessions(env, { limit: 10, offset: 0 });
    expect(all[0]).toMatchObject({ session_id: 'sid', state: 'launched' });
  });

  it('upserts an existing non-terminal staged row instead of duplicating', async () => {
    await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 9, prompt: 'A', gapSummary: 'g' });
    await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 9, prompt: 'B', gapSummary: 'g2' });
    const staged = await listStagedJulesSessions(env, { owner: 'o', repo: 'r', prNumber: 9 });
    expect(staged).toHaveLength(1);
    expect(staged[0].prompt).toBe('B');
  });

  it('marks skipped outcome', async () => {
    const row = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'P', gapSummary: 'g' });
    await markJulesOutcome(env, row.id, { state: 'skipped', errorMsg: 'not connected' });
    const all = await listJulesSessions(env, { limit: 10, offset: 0 });
    expect(all[0]).toMatchObject({ state: 'skipped', error_msg: 'not connected' });
  });
});
```

If `makeTestEnv`/harness naming differs, adapt the import to whatever `test/webhook-deliveries.spec.ts` uses (do not invent a helper).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/jules-sessions-db.spec.ts`
Expected: FAIL — `@server/db/jules-sessions` not found.

- [ ] **Step 3a: Write the schema** — `src/server/db/schemas/jules-sessions/index.ts`

```ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * A Jules coding-agent session Codra stages when it detects a documentation
 * gap during a PR review. Staged at review time; launched only once the
 * triggering PR merges (Jules starts from GitHub HEAD).
 */
export const julesSessions = sqliteTable('jules_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  owner: text('owner').notNull(),
  repo: text('repo').notNull(),
  triggering_pr_number: integer('triggering_pr_number').notNull(),
  triggering_job_id: text('triggering_job_id'),
  // 'staged' | 'launched' | 'skipped' | 'error'
  state: text('state').notNull().default('staged'),
  prompt: text('prompt').notNull(),
  gap_summary: text('gap_summary').notNull(),
  session_id: text('session_id'),
  session_url: text('session_url'),
  session_state: text('session_state'),
  error_msg: text('error_msg'),
  pr_comment_id: integer('pr_comment_id'),
});
```

- [ ] **Step 3b: Export from the barrel** — append to `src/server/db/schemas/index.ts`:

```ts
export * from './jules-sessions';
```

- [ ] **Step 3c: Write the helpers** — `src/server/db/jules-sessions.ts`

```ts
import { getDb } from './client';
import { julesSessions } from './schemas';
import { and, desc, eq } from 'drizzle-orm';

export type JulesSessionState = 'staged' | 'launched' | 'skipped' | 'error';
export type JulesSessionRow = typeof julesSessions.$inferSelect;

export type StageJulesSessionInput = {
  owner: string;
  repo: string;
  triggeringPrNumber: number;
  triggeringJobId?: string | null;
  prompt: string;
  gapSummary: string;
  prCommentId?: number | null;
};

/** Insert a staged session, or update the existing non-terminal one for this PR. */
export async function stageJulesSession(env: Pick<Env, 'DB'>, input: StageJulesSessionInput): Promise<JulesSessionRow> {
  const db = getDb(env);
  const existing = await db.select().from(julesSessions)
    .where(and(
      eq(julesSessions.owner, input.owner),
      eq(julesSessions.repo, input.repo),
      eq(julesSessions.triggering_pr_number, input.triggeringPrNumber),
      eq(julesSessions.state, 'staged'),
    )).limit(1).all();

  if (existing.length > 0) {
    const [row] = await db.update(julesSessions)
      .set({
        prompt: input.prompt,
        gap_summary: input.gapSummary,
        triggering_job_id: input.triggeringJobId ?? existing[0].triggering_job_id,
        pr_comment_id: input.prCommentId ?? existing[0].pr_comment_id,
        updated_at: new Date().toISOString(),
      })
      .where(eq(julesSessions.id, existing[0].id))
      .returning();
    return row;
  }

  const [row] = await db.insert(julesSessions).values({
    owner: input.owner,
    repo: input.repo,
    triggering_pr_number: input.triggeringPrNumber,
    triggering_job_id: input.triggeringJobId ?? null,
    prompt: input.prompt,
    gap_summary: input.gapSummary,
    pr_comment_id: input.prCommentId ?? null,
  }).returning();
  return row;
}

export async function listStagedJulesSessions(
  env: Pick<Env, 'DB'>, q: { owner: string; repo: string; prNumber: number },
): Promise<JulesSessionRow[]> {
  const db = getDb(env);
  return db.select().from(julesSessions)
    .where(and(
      eq(julesSessions.owner, q.owner),
      eq(julesSessions.repo, q.repo),
      eq(julesSessions.triggering_pr_number, q.prNumber),
      eq(julesSessions.state, 'staged'),
    )).all();
}

export async function markJulesLaunched(
  env: Pick<Env, 'DB'>, id: string, v: { sessionId: string; sessionUrl: string; sessionState: string },
): Promise<void> {
  const db = getDb(env);
  await db.update(julesSessions).set({
    state: 'launched',
    session_id: v.sessionId,
    session_url: v.sessionUrl,
    session_state: v.sessionState,
    updated_at: new Date().toISOString(),
  }).where(eq(julesSessions.id, id));
}

export async function markJulesOutcome(
  env: Pick<Env, 'DB'>, id: string, v: { state: 'skipped' | 'error'; errorMsg?: string; prCommentId?: number | null },
): Promise<void> {
  const db = getDb(env);
  await db.update(julesSessions).set({
    state: v.state,
    error_msg: v.errorMsg ?? null,
    ...(v.prCommentId != null ? { pr_comment_id: v.prCommentId } : {}),
    updated_at: new Date().toISOString(),
  }).where(eq(julesSessions.id, id));
}

export async function listJulesSessions(
  env: Pick<Env, 'DB'>, q: { owner?: string; repo?: string; limit: number; offset: number },
): Promise<JulesSessionRow[]> {
  const db = getDb(env);
  const conds = [];
  if (q.owner) conds.push(eq(julesSessions.owner, q.owner));
  if (q.repo) conds.push(eq(julesSessions.repo, q.repo));
  const where = conds.length ? and(...conds) : undefined;
  return db.select().from(julesSessions)
    .where(where).orderBy(desc(julesSessions.created_at)).limit(q.limit).offset(q.offset).all();
}
```

- [ ] **Step 4: Run tests + generate migration**

Run: `npx vitest run test/jules-sessions-db.spec.ts` → PASS.
Then generate the D1 migration from the schema:
Run: `npm run db:generate`
Expected: a new SQL file under `db/migrations/d1/` creating `jules_sessions`. Open it and confirm the table + columns match the schema.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schemas/jules-sessions/index.ts src/server/db/schemas/index.ts src/server/db/jules-sessions.ts test/jules-sessions-db.spec.ts db/migrations/d1
git commit -m "feat: jules_sessions table + db helpers + migration"
```

---

## Task 3: Jules REST client service

**Files:**
- Create: `src/server/services/jules.ts`
- Test: `test/jules-service.spec.ts`

**Interfaces:**
- Produces:
  - `type JulesSource = { name: string }`
  - `isRepoConnected(apiKey: string, owner: string, repo: string, fetchImpl?: typeof fetch): Promise<boolean>`
  - `startJulesSession(apiKey, opts, fetchImpl?): Promise<{ id: string; url: string; state: string }>` where `opts = { owner; repo; branch; prompt; title?: string }`.
  - Both throw `Error` with the HTTP status/body on non-2xx.
- Consumes: nothing from prior tasks.

- [ ] **Step 1: Write the failing test** — `test/jules-service.spec.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { isRepoConnected, startJulesSession } from '@server/services/jules';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('jules service', () => {
  it('detects a connected source and sends the api-key header', async () => {
    const f = vi.fn(async (url: any, init: any) => {
      expect(String(url)).toBe('https://jules.googleapis.com/v1alpha/sources');
      expect(init.headers['X-Goog-Api-Key']).toBe('K');
      return jsonResponse({ sources: [{ name: 'sources/github/o/r' }] });
    }) as unknown as typeof fetch;
    expect(await isRepoConnected('K', 'o', 'r', f)).toBe(true);
    expect(await isRepoConnected('K', 'o', 'other', f)).toBe(false);
  });

  it('starts a session and returns id + url', async () => {
    const f = vi.fn(async (url: any, init: any) => {
      expect(String(url)).toBe('https://jules.googleapis.com/v1alpha/sessions');
      const body = JSON.parse(init.body);
      expect(body.sourceContext.source).toBe('sources/github/o/r');
      expect(body.sourceContext.githubRepoContext.startingBranch).toBe('main');
      expect(body.prompt).toBe('do docs');
      return jsonResponse({ id: 'sid', name: 'sessions/sid', state: 'QUEUED', url: 'https://jules.google.com/session/sid' });
    }) as unknown as typeof fetch;
    const r = await startJulesSession('K', { owner: 'o', repo: 'r', branch: 'main', prompt: 'do docs', title: 'Docs' }, f);
    expect(r).toEqual({ id: 'sid', url: 'https://jules.google.com/session/sid', state: 'QUEUED' });
  });

  it('falls back to a constructed url when the response omits it', async () => {
    const f = (async () => jsonResponse({ id: 'sid', name: 'sessions/sid', state: 'QUEUED' })) as unknown as typeof fetch;
    const r = await startJulesSession('K', { owner: 'o', repo: 'r', branch: 'main', prompt: 'p' }, f);
    expect(r.url).toBe('https://jules.google.com/session/sid');
  });

  it('throws on non-2xx', async () => {
    const f = (async () => jsonResponse({ error: 'nope' }, 403)) as unknown as typeof fetch;
    await expect(startJulesSession('K', { owner: 'o', repo: 'r', branch: 'main', prompt: 'p' }, f)).rejects.toThrow(/403/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/jules-service.spec.ts` → FAIL (module missing).

- [ ] **Step 3: Write minimal implementation** — `src/server/services/jules.ts`

```ts
const JULES_BASE = 'https://jules.googleapis.com/v1alpha';

export type JulesSource = { name: string };

function headers(apiKey: string) {
  return { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey };
}

/** True if the owner/repo is a Jules-connected GitHub source. */
export async function isRepoConnected(
  apiKey: string, owner: string, repo: string, fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const res = await fetchImpl(`${JULES_BASE}/sources`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error(`Jules GET /sources ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { sources?: JulesSource[] };
  const target = `sources/github/${owner}/${repo}`;
  return (data.sources ?? []).some((s) => s.name === target);
}

/** Start a Jules session against a connected GitHub repo. */
export async function startJulesSession(
  apiKey: string,
  opts: { owner: string; repo: string; branch: string; prompt: string; title?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; url: string; state: string }> {
  const res = await fetchImpl(`${JULES_BASE}/sessions`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({
      prompt: opts.prompt,
      title: opts.title,
      sourceContext: {
        source: `sources/github/${opts.owner}/${opts.repo}`,
        githubRepoContext: { startingBranch: opts.branch },
      },
    }),
  });
  if (!res.ok) throw new Error(`Jules POST /sessions ${res.status}: ${await res.text()}`);
  const s = (await res.json()) as { id: string; state?: string; url?: string };
  return { id: s.id, url: s.url ?? `https://jules.google.com/session/${s.id}`, state: s.state ?? 'QUEUED' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/jules-service.spec.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/jules.ts test/jules-service.spec.ts
git commit -m "feat: Jules REST client (list sources, start session)"
```

---

## Task 4: Docs-gap detection + Jules prompt builder

**Files:**
- Create: `src/server/core/jules-docs-gap.ts`
- Test: `test/jules-docs-gap.spec.ts`

**Interfaces:**
- Consumes: `analyzeChangedFiles` (Task 1), `GitHubService` (existing), `ModelService` (existing).
- Produces:
  - `type DocsGapKind = 'agents' | 'readme' | 'frontend-docs' | 'docstrings'`
  - `type DocsGapItem = { kind: DocsGapKind; reason: string; docstrings?: { path: string; functions: string[] }[] }`
  - `type DocsGapReport = { items: DocsGapItem[]; summary: string }`
  - `evaluateDocsGaps(env, github, job, config): Promise<DocsGapReport>` — returns `{ items: [], summary: '' }` when no gaps. `job = { id; owner; repo; prNumber; headSha }`.
  - `buildJulesPrompt(report: DocsGapReport, repo: { owner: string; repo: string; defaultBranch: string; router?: string }): string` (pure).
  - `STALE_DAYS = 180`.

Design notes for the implementer:
- `evaluateDocsGaps` reuses data cheaply: fetch `AGENTS.md`, `CLAUDE.md`, `README.md`, and check for a `docs/` directory via the repo tree (`github.getRepoTree(owner, repo, headSha)` — filter tree paths starting with `docs/`). Use `github.getRepoFileWithRefOrNull(owner, repo, path, defaultBranch)`.
- Staleness: query the GitHub commits API for the file's last commit date. Add a `GitHubService.getFileLastCommitDate(owner, repo, path)` passthrough in this task if it doesn't exist (thin wrapper over `GET /repos/{o}/{r}/commits?path=<path>&per_page=1`, returning the ISO date or null). Keep it best-effort (null on failure). NOTE: verify whether `github.ts` already exposes a commits helper before adding; reuse if present.
- Docstrings: fetch the PR's changed files' contents (reuse the diff already available in the pipeline OR fetch blobs for changed paths at `headSha`), run `analyzeChangedFiles`, and only include files where `requiresJulesTask` is true OR that have missing docstrings — keep it to the changed set.
- The single AI call (optional refinement) judges "reflective/up-to-date" only for files that exist. Wrap in try/catch; on failure, use heuristic verdicts only. Reuse `model.callModel(config.model?.main || 'claude-3-5-sonnet-latest', {...}, SCHEMA)` with a small Zod/JSON schema `{ agents_needs_work, readme_needs_work, frontend_docs_needs_work, reasons }`. Add that schema to `src/server/models/schemas.ts` (`DOCS_GAP_SCHEMA`) following the existing `as const` JSON-schema pattern.
- `summary` is a short human string enumerating gap kinds (used in the PR comment + UI).

The test focuses on the PURE prompt builder + the heuristic branch with a fake github and the model call stubbed. Keep `evaluateDocsGaps` structured so the model call is skippable when a `skipModel` option/no key — but simplest: inject a fake `ModelService` whose `callModel` throws, forcing the heuristic path.

- [ ] **Step 1: Write the failing test** — `test/jules-docs-gap.spec.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildJulesPrompt, evaluateDocsGaps, STALE_DAYS } from '@server/core/jules-docs-gap';

describe('buildJulesPrompt', () => {
  it('spells out doc-suite + routing and lists docstring targets, never overwriting', () => {
    const p = buildJulesPrompt({
      items: [
        { kind: 'readme', reason: 'missing' },
        { kind: 'frontend-docs', reason: 'no docs/ suite' },
        { kind: 'docstrings', reason: '2 files', docstrings: [{ path: 'a.ts', functions: ['foo', 'bar'] }] },
      ],
      summary: 'README, docs suite, docstrings',
    }, { owner: 'o', repo: 'r', defaultBranch: 'main', router: 'react-router-dom createBrowserRouter' });

    expect(p).toContain('README.md');
    expect(p).toContain('docs/'); // doc suite layout
    expect(p).toMatch(/never (overwrite|delete|remove) .*existing docstring/i);
    expect(p).toContain('a.ts');
    expect(p).toContain('foo');
    expect(p).toContain('react-router-dom'); // routing spelled out
  });
});

describe('evaluateDocsGaps (heuristic path)', () => {
  const fakeGithub: any = {
    getRepoFileWithRefOrNull: async (_o: string, _r: string, path: string) => {
      if (path === 'README.md') return null;        // missing README
      if (path === 'AGENTS.md') return { content: 'x'.repeat(500), sha: 's' }; // present
      return null;
    },
    getRepoTree: async () => ({ tree: [{ type: 'blob', path: 'src/index.ts' }] }), // no docs/ dir
    getFileLastCommitDate: async () => null,
    getPullRequestDiff: async () => '',
  };
  const throwingModel: any = { callModel: async () => { throw new Error('no model'); } };

  it('flags a missing README and an absent docs suite, tolerates model failure', async () => {
    const report = await evaluateDocsGaps(
      { DB: {} } as any, fakeGithub,
      { id: 'j', owner: 'o', repo: 'r', prNumber: 3, headSha: 'sha' },
      { model: { main: null } } as any,
      throwingModel,
    );
    const kinds = report.items.map((i) => i.kind);
    expect(kinds).toContain('readme');
    expect(kinds).toContain('frontend-docs');
    expect(report.summary.length).toBeGreaterThan(0);
  });

  it('exports a stale-days threshold', () => { expect(STALE_DAYS).toBe(180); });
});
```

(If `evaluateDocsGaps`'s final signature takes the model via the `env`/`ModelService` internally rather than as a 5th arg, adjust the test to inject a fake accordingly — keep the model injectable for testing.)

- [ ] **Step 2: Run test to verify it fails** → module missing.

- [ ] **Step 3: Implement** `src/server/core/jules-docs-gap.ts`

Implement `evaluateDocsGaps` (heuristic + best-effort model refinement), `buildJulesPrompt`, and `STALE_DAYS = 180`. The prompt builder must include: the doc-suite layout (`docs/` index/TOC → subpages → nested), explicit routing setup instructions (from `repo.router`), the per-file docstring list, and the hard rule "never overwrite or delete existing docstrings; only add missing ones to the listed functions." Add a `// ponytail` note that docstring scope is the PR's changed files only. Wrap every network/model call so the function returns `{ items: [], summary: '' }` rather than throwing.

Add `DOCS_GAP_SCHEMA` to `src/server/models/schemas.ts`.
Add `GitHubService.getFileLastCommitDate` passthrough (and the `GitHubClient` method) if not already present.

- [ ] **Step 4: Run test to verify it passes** → PASS. Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/server/core/jules-docs-gap.ts test/jules-docs-gap.spec.ts src/server/models/schemas.ts src/server/core/github.ts src/server/services/github.ts
git commit -m "feat: docs-gap detection + Jules prompt builder"
```

---

## Task 5: Config toggles (`review.jules`, `review.deployWorkflow`)

**Files:**
- Modify: `src/shared/schema.ts` (`reviewConfigSchema` at :78 and the `repoConfigSchema` default at :112)
- Test: `test/config-jules-deploy.spec.ts`

**Interfaces:**
- Produces: `RepoConfig['review']['jules']` = `{ enabled: boolean }` and `RepoConfig['review']['deployWorkflow']` = `{ enabled: boolean }`, both defaulting `{ enabled: true }`.

- [ ] **Step 1: Write the failing test** — `test/config-jules-deploy.spec.ts`

```ts
import { describe, it, expect } from 'vitest';
import { repoConfigSchema } from '@shared/schema';

describe('repo config jules + deployWorkflow toggles', () => {
  it('defaults both to enabled', () => {
    const cfg = repoConfigSchema.parse({});
    expect(cfg.review.jules.enabled).toBe(true);
    expect(cfg.review.deployWorkflow.enabled).toBe(true);
  });
  it('respects an explicit opt-out', () => {
    const cfg = repoConfigSchema.parse({ review: { jules: { enabled: false } } });
    expect(cfg.review.jules.enabled).toBe(false);
    expect(cfg.review.deployWorkflow.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (`jules` undefined).

- [ ] **Step 3: Implement** — add to `reviewConfigSchema` right after the `exec` block (before the closing `})` at :109):

```ts
  jules: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  deployWorkflow: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
```

And mirror them in the `repoConfigSchema.review` default object (after the `exec: {...}` default at :134):

```ts
    jules: { enabled: true },
    deployWorkflow: { enabled: true },
```

- [ ] **Step 4: Run test + typecheck** → PASS; `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/schema.ts test/config-jules-deploy.spec.ts
git commit -m "feat: repo config toggles for jules + deployWorkflow (default on)"
```

---

## Task 6: Wire the "Docs Gap" pipeline step (stage + PR comment)

**Files:**
- Modify: `src/server/core/review.ts` (add a step after the `Standardization` block at :512-522)

**Interfaces:**
- Consumes: `evaluateDocsGaps`, `buildJulesPrompt` (Task 4); `stageJulesSession` (Task 2); `github.createIssueComment` (existing); `updateJobStep` (existing).

- [ ] **Step 1: Add the step** — after the Standardization `if` block (:522), insert:

```ts
  if (!hasCompletedStep(job, 'Docs Gap')) {
    try {
      await updateJobStep(env, job.id, 'Docs Gap', { status: 'running' });
      const config = (job.configSnapshot ?? defaultRepoConfig) as RepoConfig;
      if (config.review?.jules?.enabled !== false) {
        await evaluateAndStageJulesDocsTask(env, job, github, model, config);
      }
      await updateJobStep(env, job.id, 'Docs Gap', { status: 'done' });
    } catch (err) {
      logger.error('Failed to evaluate docs gap for Jules', err);
      await updateJobStep(env, job.id, 'Docs Gap', { status: 'failed', error: String(err) });
    }
  }
```

- [ ] **Step 2: Implement `evaluateAndStageJulesDocsTask`** in `review.ts` (near `standardizeRepository`):

```ts
async function evaluateAndStageJulesDocsTask(
  env: Env, job: PersistedReviewJob, github: GitHubService, model: ModelService, config: RepoConfig,
) {
  const pr = await github.getPullRequest(job.owner, job.repo, job.prNumber);
  const defaultBranch = (await github.getRepo(job.owner, job.repo)).default_branch;

  const report = await evaluateDocsGaps(
    env, github,
    { id: job.id, owner: job.owner, repo: job.repo, prNumber: job.prNumber, headSha: pr.head.sha },
    config, model,
  );
  if (report.items.length === 0) return;

  const prompt = buildJulesPrompt(report, {
    owner: job.owner, repo: job.repo, defaultBranch,
    router: 'react-router-dom createBrowserRouter (see src/client/main.tsx); match the repo\'s actual router',
  });

  const comment = await github.createIssueComment(job.owner, job.repo, job.prNumber,
    `📚 **Codra found documentation gaps**\n\n${report.summary}\n\nOnce this PR is **merged**, Codra will open a Jules agent session to address them. (Nothing happens if the PR is closed without merging.)`,
  ).catch(() => null);

  await stageJulesSession(env, {
    owner: job.owner, repo: job.repo,
    triggeringPrNumber: job.prNumber, triggeringJobId: job.id,
    prompt, gapSummary: report.summary,
    prCommentId: comment?.id ?? null,
  });
}
```

Add imports at the top of `review.ts`:
```ts
import { evaluateDocsGaps, buildJulesPrompt } from '@server/core/jules-docs-gap';
import { stageJulesSession } from '@server/db/jules-sessions';
```
(Confirm `github.createIssueComment` returns an object with a numeric `id`; if the passthrough returns the raw response, adjust to read `.id`.)

- [ ] **Step 3: Verify wiring** — `npm run typecheck` (PASS) and `npm run build` (PASS). No app-import spec (per the vitest quirk).

- [ ] **Step 4: Commit**

```bash
git add src/server/core/review.ts
git commit -m "feat: stage Jules docs task as a review step (comment: launches on merge)"
```

---

## Task 7: Launch staged Jules sessions on merge

**Files:**
- Create: `src/server/core/jules.ts`
- Modify: `src/server/routes/webhook.ts` (the `merged` branch at :141-163)
- Test: `test/jules-launch.spec.ts`

**Interfaces:**
- Consumes: `listStagedJulesSessions`, `markJulesLaunched`, `markJulesOutcome` (Task 2); `isRepoConnected`, `startJulesSession` (Task 3); `getSecretStoreBinding` (existing); a github object exposing `getRepo`, `createIssueComment`, `updateIssueComment`.
- Produces: `launchStagedJulesSessions(env, github, { owner; repo; prNumber; defaultBranch? }): Promise<number>` (count launched). Never throws.

- [ ] **Step 1: Write the failing test** — `test/jules-launch.spec.ts`

Because the function calls `getSecretStoreBinding(env, 'JULES_API_KEY')` and the Jules service, keep those injectable OR structure the function to read the key from `env.JULES_API_KEY.get()` (so a fake env with a `{ get }` binding works) and accept an optional `deps` param `{ isRepoConnected, startJulesSession }` defaulting to the real ones.

```ts
import { describe, it, expect, vi } from 'vitest';
import { launchStagedJulesSessions } from '@server/core/jules';
import * as db from '@server/db/jules-sessions';

function fakeEnv() { return { JULES_API_KEY: { get: async () => 'K' } } as any; }
function fakeGithub() {
  return {
    getRepo: async () => ({ default_branch: 'main' }),
    createIssueComment: vi.fn(async () => ({ id: 1 })),
    updateIssueComment: vi.fn(async () => ({ id: 1 })),
  } as any;
}

describe('launchStagedJulesSessions', () => {
  it('launches when the repo is a connected source', async () => {
    vi.spyOn(db, 'listStagedJulesSessions').mockResolvedValue([
      { id: 'row1', owner: 'o', repo: 'r', triggering_pr_number: 5, prompt: 'P', pr_comment_id: 9 } as any,
    ]);
    const marked = vi.spyOn(db, 'markJulesLaunched').mockResolvedValue();
    const deps = {
      isRepoConnected: async () => true,
      startJulesSession: async () => ({ id: 'sid', url: 'https://jules.google.com/session/sid', state: 'QUEUED' }),
    };
    const count = await launchStagedJulesSessions(fakeEnv(), fakeGithub(), { owner: 'o', repo: 'r', prNumber: 5 }, deps);
    expect(count).toBe(1);
    expect(marked).toHaveBeenCalledWith(expect.anything(), 'row1', expect.objectContaining({ sessionId: 'sid' }));
  });

  it('skips (not launched) when the repo is not connected', async () => {
    vi.spyOn(db, 'listStagedJulesSessions').mockResolvedValue([
      { id: 'row2', owner: 'o', repo: 'r', triggering_pr_number: 6, prompt: 'P', pr_comment_id: null } as any,
    ]);
    const outcome = vi.spyOn(db, 'markJulesOutcome').mockResolvedValue();
    const deps = { isRepoConnected: async () => false, startJulesSession: async () => { throw new Error('should not call'); } };
    const count = await launchStagedJulesSessions(fakeEnv(), fakeGithub(), { owner: 'o', repo: 'r', prNumber: 6 }, deps);
    expect(count).toBe(0);
    expect(outcome).toHaveBeenCalledWith(expect.anything(), 'row2', expect.objectContaining({ state: 'skipped' }));
  });

  it('never throws on internal failure', async () => {
    vi.spyOn(db, 'listStagedJulesSessions').mockRejectedValue(new Error('db down'));
    await expect(launchStagedJulesSessions(fakeEnv(), fakeGithub(), { owner: 'o', repo: 'r', prNumber: 1 })).resolves.toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → module missing.

- [ ] **Step 3: Implement** `src/server/core/jules.ts`

```ts
import { logger } from '@server/core/logger';
import { getSecretStoreBinding } from '@server/utils/secrets';
import { listStagedJulesSessions, markJulesLaunched, markJulesOutcome } from '@server/db/jules-sessions';
import { isRepoConnected as realIsRepoConnected, startJulesSession as realStartJulesSession } from '@server/services/jules';

type Deps = { isRepoConnected: typeof realIsRepoConnected; startJulesSession: typeof realStartJulesSession };
const DEFAULT_DEPS: Deps = { isRepoConnected: realIsRepoConnected, startJulesSession: realStartJulesSession };

type MergeGithub = {
  getRepo(owner: string, repo: string): Promise<{ default_branch: string }>;
  createIssueComment(owner: string, repo: string, issueNumber: number, body: string): Promise<{ id: number }>;
  updateIssueComment(owner: string, repo: string, commentId: number, body: string): Promise<unknown>;
};

/** On PR merge, launch any staged Jules docs sessions. Best-effort; never throws. */
export async function launchStagedJulesSessions(
  env: Env, github: MergeGithub, ctx: { owner: string; repo: string; prNumber: number; defaultBranch?: string },
  deps: Deps = DEFAULT_DEPS,
): Promise<number> {
  try {
    const staged = await listStagedJulesSessions(env, ctx);
    if (staged.length === 0) return 0;

    let apiKey = '';
    try { apiKey = await getSecretStoreBinding(env, 'JULES_API_KEY'); } catch { apiKey = ''; }
    if (!apiKey) {
      for (const row of staged) {
        await markJulesOutcome(env, row.id, { state: 'skipped', errorMsg: 'JULES_API_KEY not configured' }).catch(() => {});
      }
      return 0;
    }

    const connected = await deps.isRepoConnected(apiKey, ctx.owner, ctx.repo).catch(() => false);
    if (!connected) {
      for (const row of staged) {
        await markJulesOutcome(env, row.id, { state: 'skipped', errorMsg: 'Repo is not connected to the Jules GitHub app' }).catch(() => {});
        if (row.pr_comment_id != null) {
          await github.updateIssueComment(ctx.owner, ctx.repo, row.pr_comment_id,
            `📚 Codra wanted to open a Jules docs session, but **${ctx.owner}/${ctx.repo}** is not connected to Jules. Connect it at https://jules.google.com and re-run.`,
          ).catch(() => {});
        }
      }
      return 0;
    }

    const branch = ctx.defaultBranch ?? (await github.getRepo(ctx.owner, ctx.repo).then((r) => r.default_branch).catch(() => 'main'));

    let launched = 0;
    for (const row of staged) {
      try {
        const s = await deps.startJulesSession(apiKey, { owner: ctx.owner, repo: ctx.repo, branch, prompt: row.prompt, title: 'Codra: documentation improvements' });
        await markJulesLaunched(env, row.id, { sessionId: s.id, sessionUrl: s.url, sessionState: s.state });
        launched++;
        const body = `✅ **Jules session opened** to address the documentation gaps.\n\n- Session: ${s.url}\n- ID: \`${s.id}\``;
        if (row.pr_comment_id != null) await github.updateIssueComment(ctx.owner, ctx.repo, row.pr_comment_id, body).catch(() => {});
        else await github.createIssueComment(ctx.owner, ctx.repo, ctx.prNumber, body).catch(() => {});
      } catch (err) {
        logger.error('Failed to launch Jules session', err instanceof Error ? err : new Error(String(err)));
        await markJulesOutcome(env, row.id, { state: 'error', errorMsg: String(err) }).catch(() => {});
      }
    }
    return launched;
  } catch (err) {
    logger.error('launchStagedJulesSessions failed', err instanceof Error ? err : new Error(String(err)));
    return 0;
  }
}
```

- [ ] **Step 4: Wire into the webhook** — in `src/server/routes/webhook.ts`, inside the `if (prPayload.action === 'closed')` block, after the `cancelReviewsForClosedPr` call (:163) and before the `return finish(...)` (:164), add:

```ts
          if (merged) {
            const { launchStagedJulesSessions } = await import('@server/core/jules');
            const ghService = new GitHubService(c.env, installationId);
            c.executionCtx.waitUntil(
              launchStagedJulesSessions(c.env, ghService, { owner, repo, prNumber })
                .catch((err) => console.error('Jules launch on merge failed:', err)),
            );
          }
```

Add the import if not present: `import { GitHubService } from '@server/services/github';` (check existing imports in `webhook.ts` first; `GitHubClient` is already imported — `GitHubService` wraps it and exposes `getRepo`/`createIssueComment`/`updateIssueComment`). Use `waitUntil` so the webhook responds promptly while Jules launches in the background.

- [ ] **Step 5: Run tests + verify wiring**

Run: `npx vitest run test/jules-launch.spec.ts` → PASS.
Run: `npm run typecheck && npm run build` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/core/jules.ts src/server/routes/webhook.ts test/jules-launch.spec.ts
git commit -m "feat: launch staged Jules sessions when the triggering PR merges"
```

---

## Task 8: Jules-session read API + frontend card

**Files:**
- Create: `src/server/routes/api/jules-sessions.ts`
- Modify: `src/server/app.ts` (mount at :133-ish), `src/shared/api.ts`, `src/client/lib/api.ts`, `src/client/pages/actions.tsx`
- Test: `test/jules-sessions-api.spec.ts` (light — router shape) OR verify via typecheck/build.

**Interfaces:**
- Consumes: `listJulesSessions` (Task 2), `CopyButton` (existing).
- Produces: `GET /api/jules-sessions` → `{ sessions: JulesSessionDto[] }`; client `api.getJulesSessions(params)`; `type JulesSessionDto` in `src/shared/api.ts`.

- [ ] **Step 1: Add the shared DTO** — append to `src/shared/api.ts`:

```ts
export type JulesSessionDto = {
  id: string;
  created_at: string;
  owner: string;
  repo: string;
  triggering_pr_number: number;
  state: 'staged' | 'launched' | 'skipped' | 'error';
  prompt: string;
  gap_summary: string;
  session_id: string | null;
  session_url: string | null;
  session_state: string | null;
  error_msg: string | null;
};

export type JulesSessionsResponse = { sessions: JulesSessionDto[] };
```

- [ ] **Step 2: Add the router** — `src/server/routes/api/jules-sessions.ts`:

```ts
import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { listJulesSessions } from '@server/db/jules-sessions';

export function createJulesSessionsRouter() {
  const app = new Hono<AppEnv>();
  app.get('/', async (c) => {
    const q = c.req.query();
    const limit = Math.min(Number(q.limit) || 50, 200);
    const offset = Number(q.offset) || 0;
    const sessions = await listJulesSessions(c.env, {
      owner: q.owner || undefined, repo: q.repo || undefined, limit, offset,
    });
    return c.json({ sessions });
  });
  return app;
}
```

- [ ] **Step 3: Mount it** — in `src/server/app.ts`, import `createJulesSessionsRouter` alongside the other route imports (near :23) and add near :130:

```ts
  app.route('/api/jules-sessions', createJulesSessionsRouter());
```

- [ ] **Step 4: Add the client method** — in `src/client/lib/api.ts`, near `getAgentActions` (:229), add:

```ts
  getJulesSessions(params: Record<string, QueryValue> = {}) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') searchParams.set(key, String(value));
    }
    const query = searchParams.toString();
    return request<JulesSessionsResponse>(`/api/jules-sessions${query ? `?${query}` : ''}`);
  },
```

Import `JulesSessionsResponse` from `@shared/api` in `api.ts`.

- [ ] **Step 5: Render on the Actions page** — in `src/client/pages/actions.tsx`, add a second fetch + section above (or below) the existing actions list. Add state + effect:

```tsx
import { CopyButton } from '@client/components/ui/copy-button';
import type { AgentAction, JulesSessionDto } from '@shared/api';
// ...
const [jules, setJules] = useState<JulesSessionDto[]>([]);
useEffect(() => {
  api.getJulesSessions({ limit: 100 })
    .then((res) => setJules(res.sessions))
    .catch(() => { /* section just stays empty */ });
}, []);
```

And render (place before the agent-actions block):

```tsx
{jules.length > 0 && (
  <div className="space-y-3">
    <h2 className="text-sm font-medium text-muted-foreground">Jules documentation sessions</h2>
    {jules.map((s) => (
      <div key={s.id} className="rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant={s.state === 'launched' ? 'default' : 'secondary'}>{s.state}</Badge>
            <span className="font-mono text-sm">{s.owner}/{s.repo}</span>
            <span className="text-xs text-muted-foreground">triggered by PR #{s.triggering_pr_number}</span>
          </div>
          <span className="text-xs text-muted-foreground">{formatDateTime(s.created_at)}</span>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">{s.gap_summary}</p>
        {s.error_msg && <p className="mt-1 text-xs text-destructive">{s.error_msg}</p>}
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">Prompt sent to Jules</summary>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-secondary p-2 text-[11px]">{s.prompt}</pre>
        </details>
        {s.session_id && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CopyButton value={s.session_id} label="Copy session ID" copiedLabel="Copied" />
            {s.session_url && (
              <a href={s.session_url} target="_blank" rel="noopener noreferrer"
                 className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                Open in Jules <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        )}
      </div>
    ))}
  </div>
)}
```

(Confirm `CopyButton`'s prop names — spec says `value`, `label`, `copiedLabel`; adjust to the actual signature in `src/client/components/ui/copy-button.tsx`.)

- [ ] **Step 6: Verify** — `npm run typecheck && npm run build` → PASS. Optionally add a tiny router unit test if the harness supports it; otherwise rely on typecheck/build.

- [ ] **Step 7: Commit**

```bash
git add src/server/routes/api/jules-sessions.ts src/server/app.ts src/shared/api.ts src/client/lib/api.ts src/client/pages/actions.tsx
git commit -m "feat: Jules sessions API + dashboard card (copy id, open link)"
```

---

## Task 9: Sealed-box crypto + GitHub Actions secrets

**Files:**
- Modify: `package.json` (add `libsodium-wrappers` + `@types/libsodium-wrappers`)
- Create: `src/server/core/github-secrets.ts`
- Modify: `src/server/core/github.ts` (+ `src/server/services/github.ts` passthroughs)
- Test: `test/github-secrets.spec.ts`

**Interfaces:**
- Produces:
  - `sealSecret(publicKeyB64: string, secret: string): Promise<string>` (base64 sealed value).
  - `setRepoActionsSecrets(github, owner, repo, secrets: { name: string; value: string }[]): Promise<{ ok: boolean; set: string[]; reason?: string }>` — degrades (ok:false) on 403/404 without throwing.
  - `GitHubClient.getRepoActionsPublicKey(owner, repo): Promise<{ key_id: string; key: string }>`.
  - `GitHubClient.putRepoActionsSecret(owner, repo, name, encrypted_value, key_id): Promise<void>`.

- [ ] **Step 1: Add the dependency**

```bash
pnpm add libsodium-wrappers && pnpm add -D @types/libsodium-wrappers
```

(Use pnpm — the repo has `pnpm-lock.yaml`.)

- [ ] **Step 2: Write the failing test** — `test/github-secrets.spec.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import _sodium from 'libsodium-wrappers';
import { sealSecret, setRepoActionsSecrets } from '@server/core/github-secrets';
import { GitHubError } from '@server/core/github';

describe('sealSecret', () => {
  it('produces a value the matching private key can open', async () => {
    await _sodium.ready;
    const kp = _sodium.crypto_box_keypair();
    const pubB64 = _sodium.to_base64(kp.publicKey, _sodium.base64_variants.ORIGINAL);
    const sealedB64 = await sealSecret(pubB64, 'super-secret');
    const opened = _sodium.crypto_box_seal_open(
      _sodium.from_base64(sealedB64, _sodium.base64_variants.ORIGINAL), kp.publicKey, kp.privateKey,
    );
    expect(_sodium.to_string(opened)).toBe('super-secret');
  });
});

describe('setRepoActionsSecrets', () => {
  it('encrypts + PUTs each secret', async () => {
    await _sodium.ready;
    const kp = _sodium.crypto_box_keypair();
    const github: any = {
      getRepoActionsPublicKey: vi.fn(async () => ({ key_id: 'kid', key: _sodium.to_base64(kp.publicKey, _sodium.base64_variants.ORIGINAL) })),
      putRepoActionsSecret: vi.fn(async () => {}),
    };
    const res = await setRepoActionsSecrets(github, 'o', 'r', [
      { name: 'CLOUDFLARE_ACCOUNT_ID', value: 'acc' },
      { name: 'CLOUDFLARE_API_TOKEN', value: 'tok' },
    ]);
    expect(res.ok).toBe(true);
    expect(res.set).toEqual(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']);
    expect(github.putRepoActionsSecret).toHaveBeenCalledTimes(2);
  });

  it('degrades (ok:false) on a 403 permission error', async () => {
    const github: any = {
      getRepoActionsPublicKey: vi.fn(async () => { throw new GitHubError(403, 'no perms', '/x', 'forbidden'); }),
      putRepoActionsSecret: vi.fn(),
    };
    const res = await setRepoActionsSecrets(github, 'o', 'r', [{ name: 'X', value: 'y' }]);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/permission|403/i);
    expect(github.putRepoActionsSecret).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails** → module missing.

- [ ] **Step 4: Implement** `src/server/core/github-secrets.ts`

```ts
import _sodium from 'libsodium-wrappers';
import { GitHubError } from '@server/core/github';
import { logger } from '@server/core/logger';

/** Encrypt a secret value against a repo's base64 Actions public key (libsodium sealed box). */
export async function sealSecret(publicKeyB64: string, secret: string): Promise<string> {
  await _sodium.ready;
  const pub = _sodium.from_base64(publicKeyB64, _sodium.base64_variants.ORIGINAL);
  const sealed = _sodium.crypto_box_seal(_sodium.from_string(secret), pub);
  return _sodium.to_base64(sealed, _sodium.base64_variants.ORIGINAL);
}

type SecretsGithub = {
  getRepoActionsPublicKey(owner: string, repo: string): Promise<{ key_id: string; key: string }>;
  putRepoActionsSecret(owner: string, repo: string, name: string, encrypted_value: string, key_id: string): Promise<void>;
};

/** Set repo Actions secrets. Returns ok:false (no throw) when the App lacks permission. */
export async function setRepoActionsSecrets(
  github: SecretsGithub, owner: string, repo: string, secrets: { name: string; value: string }[],
): Promise<{ ok: boolean; set: string[]; reason?: string }> {
  try {
    const key = await github.getRepoActionsPublicKey(owner, repo);
    const set: string[] = [];
    for (const s of secrets) {
      const encrypted = await sealSecret(key.key, s.value);
      await github.putRepoActionsSecret(owner, repo, s.name, encrypted, key.key_id);
      set.push(s.name);
    }
    return { ok: true, set };
  } catch (err) {
    if (err instanceof GitHubError && (err.status === 403 || err.status === 404)) {
      logger.warn(`No permission to set Actions secrets on ${owner}/${repo} (status ${err.status})`);
      return { ok: false, set: [], reason: `GitHub App lacks Actions Secrets:write permission (HTTP ${err.status})` };
    }
    logger.error('setRepoActionsSecrets failed', err instanceof Error ? err : new Error(String(err)));
    return { ok: false, set: [], reason: String(err) };
  }
}
```

- [ ] **Step 5: Add the GitHubClient methods** — in `src/server/core/github.ts`, add (mirroring existing methods that use `withRetry` + `requestAndCheck` + `repoApiPath`):

```ts
  async getRepoActionsPublicKey(owner: string, repo: string) {
    return withRetry(`getRepoActionsPublicKey ${owner}/${repo}`, async () => {
      const res = await this.requestAndCheck(`${repoApiPath(owner, repo)}/actions/secrets/public-key`);
      return (await res.json()) as { key_id: string; key: string };
    });
  }

  async putRepoActionsSecret(owner: string, repo: string, name: string, encrypted_value: string, key_id: string) {
    return withRetry(`putRepoActionsSecret ${owner}/${repo} ${name}`, async () => {
      await this.requestAndCheck(`${repoApiPath(owner, repo)}/actions/secrets/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: JSON.stringify({ encrypted_value, key_id }),
      });
    });
  }
```

And add passthroughs in `src/server/services/github.ts`:

```ts
  async getRepoActionsPublicKey(owner: string, repo: string) {
    return this.client.getRepoActionsPublicKey(owner, repo);
  }
  async putRepoActionsSecret(owner: string, repo: string, name: string, encrypted_value: string, key_id: string) {
    return this.client.putRepoActionsSecret(owner, repo, name, encrypted_value, key_id);
  }
```

- [ ] **Step 6: Run tests + verify** — `npx vitest run test/github-secrets.spec.ts` → PASS. Then `npm run typecheck && npm run build` (confirm `libsodium-wrappers` bundles for the Worker; if the build complains about WASM, check `wrangler.jsonc` for `node_compat`/nodejs_compat and the vite worker config — libsodium-wrappers ships asm.js fallback that works without WASM flags).

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/server/core/github-secrets.ts src/server/core/github.ts src/server/services/github.ts test/github-secrets.spec.ts
git commit -m "feat: sealed-box encryption + GitHub Actions secrets client"
```

---

## Task 10: Deploy-workflow builder + PR + secret-setting, wired as a review step

**Files:**
- Create: `src/server/core/deploy-workflow.ts`
- Modify: `src/server/core/review.ts` (add a `Deploy Workflow` step after `Docs Gap`)
- Test: `test/deploy-workflow.spec.ts`

**Interfaces:**
- Consumes: `setRepoActionsSecrets` (Task 9), `getSecretStoreBinding` (existing), `recordAgentAction` (existing), `getDismissedStandards` (existing), and `GitHubService` (createBranch/createOrUpdateFileContents/createPullRequest/listPullRequests/getRef/getRepo/getRepoTree/getRepoFileWithRefOrNull).
- Produces:
  - `buildDeployWorkflowYaml(opts: { dbName: string | null; packageManager: 'pnpm' | 'npm' }): string` (pure).
  - `deployWorkflowNeeded(github, owner, repo, defaultBranch, headSha): Promise<boolean>` (worker repo + no existing deploy workflow).
  - `ensureDeployWorkflow(env, job, github, config): Promise<void>` (best-effort; gate → open PR → set secrets → record action).

- [ ] **Step 1: Write the failing test** — `test/deploy-workflow.spec.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildDeployWorkflowYaml, deployWorkflowNeeded } from '@server/core/deploy-workflow';

describe('buildDeployWorkflowYaml', () => {
  const yaml = buildDeployWorkflowYaml({ dbName: 'codra', packageManager: 'pnpm' });
  it('is manual (workflow_dispatch) with deploy/migrate/logs actions', () => {
    expect(yaml).toContain('workflow_dispatch:');
    expect(yaml).toContain('cloudflare/wrangler-action@v4');
    expect(yaml).toContain('d1 migrations apply codra --remote');
    expect(yaml).toContain('deployments list');
    expect(yaml).toContain('CLOUDFLARE_API_TOKEN');
    expect(yaml).toContain('CLOUDFLARE_ACCOUNT_ID');
  });
  it('ships the push-to-main auto-deploy block commented out', () => {
    // every line of the push trigger must be commented
    expect(yaml).toMatch(/#\s*on:\s*\n#\s*push:/);
    expect(yaml).not.toMatch(/^\s*on:\s*\n\s*push:/m);
  });
});

describe('deployWorkflowNeeded', () => {
  it('false when a deploy workflow already exists', async () => {
    const github: any = {
      getRepoFileWithRefOrNull: async (_o: string, _r: string, p: string) =>
        p === 'wrangler.jsonc' ? { content: '{}', sha: 's' } : null,
      getRepoTree: async () => ({ tree: [{ type: 'blob', path: '.github/workflows/deploy.yml' }] }),
    };
    expect(await deployWorkflowNeeded(github, 'o', 'r', 'main', 'sha')).toBe(false);
  });
  it('false when not a worker repo (no wrangler config)', async () => {
    const github: any = {
      getRepoFileWithRefOrNull: async () => null,
      getRepoTree: async () => ({ tree: [] }),
    };
    expect(await deployWorkflowNeeded(github, 'o', 'r', 'main', 'sha')).toBe(false);
  });
  it('true for a worker repo with no deploy workflow', async () => {
    const github: any = {
      getRepoFileWithRefOrNull: async (_o: string, _r: string, p: string) =>
        p === 'wrangler.jsonc' ? { content: '{ "name": "x" }', sha: 's' } : null,
      getRepoTree: async () => ({ tree: [{ type: 'blob', path: 'src/index.ts' }, { type: 'blob', path: '.github/workflows/ci.yml' }] }),
    };
    expect(await deployWorkflowNeeded(github, 'o', 'r', 'main', 'sha')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → module missing.

- [ ] **Step 3: Implement** `src/server/core/deploy-workflow.ts`

`buildDeployWorkflowYaml` returns exactly this template (fill `${dbName}` — if null, use `<YOUR_D1_DB_NAME>` and add a note comment; `${pm}` = `pnpm`/`npm`):

```yaml
name: Deploy (Cloudflare)

# Manual, on-demand operations. Auto-deploy on push to main is provided below,
# COMMENTED OUT — uncomment the `push` trigger to enable continuous deploys.
on:
  workflow_dispatch:
    inputs:
      action:
        description: "What to run"
        required: true
        default: deploy
        type: choice
        options:
          - deploy
          - migrate-db
          - check-logs
#  push:
#    branches: [main]

jobs:
  run:
    runs-on: ubuntu-latest
    name: Wrangler
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Deploy Worker
        if: ${{ github.event_name == 'push' || github.event.inputs.action == 'deploy' }}
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy

      - name: Apply remote D1 migrations
        if: ${{ github.event.inputs.action == 'migrate-db' }}
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: d1 migrations apply codra --remote

      - name: Check recent deployments / build status
        if: ${{ github.event.inputs.action == 'check-logs' }}
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deployments list
```

(The builder assembles this as a template string; the `${{ ... }}` GitHub expressions must be literal in the output — escape appropriately in the TS template. The `#`-prefixed `push:` lines satisfy the "commented out" test.)

`deployWorkflowNeeded`: return false unless a wrangler config file exists (`wrangler.jsonc`/`wrangler.json`/`wrangler.toml` via `getRepoFileWithRefOrNull` on the default branch), then list `.github/workflows/*` from the repo tree and return false if any path is `.github/workflows/deploy.yml`/`deploy.yaml` (extend to content-sniff `wrangler-action` only if needed — keep it to the filename check for v1, with a `// ponytail` note).

`ensureDeployWorkflow`:
1. If `config.review?.deployWorkflow?.enabled === false` → return.
2. `defaultBranch = (await github.getRepo(...)).default_branch`; `pr = await github.getPullRequest(...)` for `head.sha`.
3. `if (!(await deployWorkflowNeeded(...))) return;`
4. Respect dismissed standards (`getDismissedStandards`) for `.github/workflows/deploy.yml`.
5. Dedup: skip if an open PR on a `codra/deploy-workflow` branch exists (mirror the housekeeping dedup at `review.ts:1808-1816`).
6. Create branch `codra/deploy-workflow-${Date.now()}` from the default ref; commit `.github/workflows/deploy.yml` with `buildDeployWorkflowYaml({ dbName, packageManager: 'pnpm' })` (derive `dbName` from the wrangler config's `d1_databases[0].database_name` if parseable, else null).
7. Read `CLOUDFLARE_ACCOUNT_ID = await getSecretStoreBinding(env, 'CF_ACCOUNT_ID')` and `CLOUDFLARE_API_TOKEN = await getSecretStoreBinding(env, 'CF_API_TOKEN')` (both best-effort; skip secret-setting if either empty).
8. `const secretResult = await setRepoActionsSecrets(githubService, owner, repo, [...])`.
9. PR body: describe the workflow; if `secretResult.ok`, note "Codra set the `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` Actions secrets automatically." else append a **Manual step** section listing the two secret names + where to get them (Cloudflare dashboard → account ID; a scoped Workers API token) and `secretResult.reason`.
10. `recordAgentAction(env, { actionType: 'deploy-workflow', ..., files: ['.github/workflows/deploy.yml'], prNumber, prUrl, triggeringPrNumber: job.prNumber, triggeringJobId: job.id, summary })`.

Wrap the whole body in try/catch → log only.

- [ ] **Step 4: Wire the step into `review.ts`** — after the `Docs Gap` step block (Task 6), add:

```ts
  if (!hasCompletedStep(job, 'Deploy Workflow')) {
    try {
      await updateJobStep(env, job.id, 'Deploy Workflow', { status: 'running' });
      const config = (job.configSnapshot ?? defaultRepoConfig) as RepoConfig;
      if (config.review?.deployWorkflow?.enabled !== false) {
        await ensureDeployWorkflow(env, job, github, config);
      }
      await updateJobStep(env, job.id, 'Deploy Workflow', { status: 'done' });
    } catch (err) {
      logger.error('Failed to ensure deploy workflow', err);
      await updateJobStep(env, job.id, 'Deploy Workflow', { status: 'failed', error: String(err) });
    }
  }
```

Import `ensureDeployWorkflow` at the top of `review.ts`.

- [ ] **Step 5: Run tests + verify wiring**

Run: `npx vitest run test/deploy-workflow.spec.ts` → PASS.
Run: `npm run typecheck && npm run build` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/core/deploy-workflow.ts src/server/core/review.ts test/deploy-workflow.spec.ts
git commit -m "feat: separate deploy-workflow PR + auto-set Cloudflare Actions secrets"
```

---

## Task 11: Docs note + full verification

**Files:**
- Modify: `README.md` and/or `AGENTS.md` — a short section describing the two new behaviors + the `review.jules` / `review.deployWorkflow` toggles + the GitHub App's `Actions Secrets: write` permission requirement for auto-secret-setting.

- [ ] **Step 1:** Add a concise "Docs-gap Jules tasks & deploy workflow" section to `README.md` (what triggers each, that Jules launches on merge, how to opt out via config, and that auto-secret-setting needs the App permission — otherwise Codra writes the secret names into the PR body).

- [ ] **Step 2: Full verification**

```bash
npm run typecheck
npm run build
npx vitest run test/docstrings.spec.ts test/jules-sessions-db.spec.ts test/jules-service.spec.ts test/jules-docs-gap.spec.ts test/config-jules-deploy.spec.ts test/jules-launch.spec.ts test/github-secrets.spec.ts test/deploy-workflow.spec.ts
```

Expected: typecheck + build PASS; all new specs PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: document Jules docs tasks + deploy workflow behaviors"
```

---

## Self-Review Notes (coverage)

- Spec §Feature 1 detection → Tasks 1, 4. Staging + storage → Tasks 2, 6. Launch on merge → Task 7. Frontend → Task 8. ✅
- Spec §Feature 2 deploy PR → Task 10 (gate, YAML, dedup, dismissed). ✅
- Spec §Feature 3 secrets → Task 9 (crypto + client) + Task 10 (invocation + degradation). ✅
- Config toggles → Task 5. Pipeline steps → Tasks 6, 10. Env/`JULES_API_KEY` already present (no task needed). ✅
- Testing strategy → pure-function specs per task + typecheck/build for app-import-sensitive wiring (per the repo's vitest quirk). ✅

## Known adjustment points for the implementer (verify against live code)

- Confirm `GitHubService.createIssueComment` return shape exposes numeric `id` (Task 6/7). If not, add a thin passthrough or read the raw response's `id`.
- Confirm the in-memory D1 test harness entry point (`test/helpers.ts` / `test/d1-sqlite.ts`) and match its API in Task 2's spec.
- Confirm `CopyButton` prop names (Task 8).
- Confirm `libsodium-wrappers` bundles cleanly for the Worker (Task 9 step 6); if WASM is an issue, its asm.js build is the fallback (no config change expected).
- `deployWorkflowNeeded` uses a filename check for the existing-workflow gate; upgrade to content-sniffing `wrangler-action` only if false negatives appear (ponytail ceiling).
