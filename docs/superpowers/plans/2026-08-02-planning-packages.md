# Planning Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-repo "planning packages" to codra — immutable, fielded (no-blob), revision-safe plan bundles produced and merged by multi-agent orchestration (Jules-driven, codra-reviewed).

**Architecture:** D1/Drizzle fielded schema (header + immutable revision snapshots + fielded child tables + live task-state), Hono API incl. a public capability-gated read export, MCP tools in codemode, a `PlanAgent` Durable Object orchestrating Jules, programmatic `@google/jules-fleet` + `@google/jules-merge`, and React/Plate frontend.

**Tech Stack:** Cloudflare Workers, Hono, D1 + Drizzle ORM (sqlite dialect), Durable Objects, R2, `@google/jules-sdk` / `-fleet` / `-merge`, `@cloudflare/codemode`, React + Vite + `@udecode/plate`.

**Spec:** [docs/superpowers/specs/2026-08-02-planning-packages-design.md](../specs/2026-08-02-planning-packages-design.md)

## Global Constraints

- **D1 only.** DB binding is `DB`, accessed via `getDb(env)` (`drizzle-orm/d1`). No Postgres/Hyperdrive/`pg`.
- **Schema:** sqlite dialect, `text` uuid PKs via `crypto.randomUUID()` (`.$defaultFn`), `text` timestamps `default(sql`CURRENT_TIMESTAMP`)`. Modules under `src/server/db/schemas/**`, re-exported from `schemas/index.ts`.
- **Migrations:** `npm run db:generate` writes SQL to `db/migrations/d1/`; never hand-edit generated SQL.
- **D1 100-bound-param cap** (gotcha catalog): batch multi-row inserts so `rows × columns ≤ ~90`.
- **Never hardcode a base URL.** Use `env.APP_URL`.
- **Tests:** in-memory `node:sqlite` D1 via `createTestEnv()` (`test/helpers.ts`); run with `npm test`. No external DB.
- **MCP auth:** `verifyMcpAuth` (OAuth KV token or `WORKER_API_KEY` secrets-store). Session API guarded by `requireSession` + CSRF.

---

## Phase 1 — Data layer (THIS SESSION)

Deliverable: planning-package tables migrate cleanly and have tested query helpers enforcing revision immutability and task-state survival. (R2 binding deferred to P2, where ingestion first writes transcripts — a binding with no consumer is dead config.)

### Task 1: Schema module + migration

**Files:**
- Create: `src/server/db/schemas/planning-packages/index.ts`
- Modify: `src/server/db/schemas/index.ts` (add `export * from './planning-packages';`)
- Test: `test/planning-packages-db.spec.ts` (smoke only in this task)

**Interfaces:**
- Produces tables/exports: `planningPackages`, `packageRevisions`, `revisionChangeItems`, `revisionTasks`, `revisionFileChanges`, `revisionCodeCards`, `revisionApiChanges`, `revisionMigrations`, `revisionDiagrams`, `packageTasks`.

- [ ] **Step 1: Write the schema module**

```ts
// src/server/db/schemas/planning-packages/index.ts
import { sqliteTable, text, integer, unique, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const uuid = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`);

export const planningPackages = sqliteTable('planning_packages', {
  id: uuid(),
  repository_id: integer('repository_id', { mode: 'number' }).notNull(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  // draft | planning | in_progress | pr_submitted | merged | rejected
  status: text('status').notNull().default('draft'),
  current_revision_id: text('current_revision_id'),
  request_prompt_json: text('request_prompt_json'),
  created_by: text('created_by'),
  created_at: createdAt(),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  unique().on(t.repository_id, t.slug),
  index('idx_pkg_repo_status_created').on(t.repository_id, t.status, t.created_at),
]);

export const packageRevisions = sqliteTable('package_revisions', {
  id: uuid(),
  package_id: text('package_id').notNull(),
  revision_number: integer('revision_number', { mode: 'number' }).notNull(),
  // jules | merge | orchestrator | human | coding_agent
  source: text('source').notNull(),
  jules_session_id: text('jules_session_id'),
  // proposed | superseded | accepted | rejected
  status: text('status').notNull().default('proposed'),
  summary: text('summary'),
  problem: text('problem'),
  approach: text('approach'),
  verification: text('verification'),
  prd_markdown: text('prd_markdown'),
  design_brief_markdown: text('design_brief_markdown'),
  prompt_markdown: text('prompt_markdown'),
  context_r2_key: text('context_r2_key'),
  context_bytes: integer('context_bytes', { mode: 'number' }),
  context_sha256: text('context_sha256'),
  context_coverage_note: text('context_coverage_note'),
  created_by: text('created_by'),
  created_at: createdAt(),
}, (t) => [
  unique().on(t.package_id, t.revision_number),
  index('idx_rev_pkg_created').on(t.package_id, t.created_at),
]);

// Fielded children — one factory keeps them uniform.
const childBase = () => ({
  id: uuid(),
  revision_id: text('revision_id').notNull(),
  ordinal: integer('ordinal', { mode: 'number' }).notNull(),
});

export const revisionChangeItems = sqliteTable('revision_change_items', {
  ...childBase(),
  kind: text('kind').notNull(),
  text: text('text').notNull(),
}, (t) => [index('idx_change_items_rev').on(t.revision_id, t.ordinal)]);

export const revisionTasks = sqliteTable('revision_tasks', {
  ...childBase(),
  task_key: text('task_key').notNull(),
  workstream: text('workstream'),
  phase: integer('phase', { mode: 'number' }),
  title: text('title').notNull(),
  description: text('description'),
  target_path: text('target_path'),
  change_type: text('change_type'),
  depends_on: text('depends_on'), // JSON string[] of task_keys
}, (t) => [index('idx_rev_tasks_rev').on(t.revision_id, t.ordinal)]);

export const revisionFileChanges = sqliteTable('revision_file_changes', {
  ...childBase(),
  path: text('path').notNull(),
  change_type: text('change_type').notNull(), // add | modify | delete
  note: text('note'),
}, (t) => [index('idx_file_changes_rev').on(t.revision_id, t.ordinal)]);

export const revisionCodeCards = sqliteTable('revision_code_cards', {
  ...childBase(),
  file_path: text('file_path'),
  language: text('language'),
  intent: text('intent'),
  content: text('content').notNull(), // FULL code — anti-truncation
}, (t) => [index('idx_code_cards_rev').on(t.revision_id, t.ordinal)]);

export const revisionApiChanges = sqliteTable('revision_api_changes', {
  ...childBase(),
  method: text('method').notNull(),
  path: text('path').notNull(),
  description: text('description'),
}, (t) => [index('idx_api_changes_rev').on(t.revision_id, t.ordinal)]);

export const revisionMigrations = sqliteTable('revision_migrations', {
  ...childBase(),
  tag: text('tag'),
  sql: text('sql').notNull(),
}, (t) => [index('idx_migrations_rev').on(t.revision_id, t.ordinal)]);

export const revisionDiagrams = sqliteTable('revision_diagrams', {
  ...childBase(),
  caption: text('caption'),
  mermaid: text('mermaid').notNull(),
}, (t) => [index('idx_diagrams_rev').on(t.revision_id, t.ordinal)]);

export const packageTasks = sqliteTable('package_tasks', {
  id: uuid(),
  package_id: text('package_id').notNull(),
  task_key: text('task_key').notNull(),
  // pending | in_progress | in_review | blocked | deferred | done
  status: text('status').notNull().default('pending'),
  assignee: text('assignee'),
  pr_number: integer('pr_number', { mode: 'number' }),
  notes: text('notes'),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [unique().on(t.package_id, t.task_key)]);
```

- [ ] **Step 2: Export from the barrel**

Add to `src/server/db/schemas/index.ts`: `export * from './planning-packages';`

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new `db/migrations/d1/00NN_*.sql` creating the 10 tables + a `meta/` snapshot update. Inspect it — 10 `CREATE TABLE`, the two `unique` constraints, the indexes.

- [ ] **Step 4: Write a smoke test**

```ts
// test/planning-packages-db.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '@server/db/client';
import { planningPackages } from '@server/db/schemas';
import { createTestEnv } from './helpers';

describe('planning-packages schema', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('migrates and accepts a package row', async () => {
    const db = getDb(env);
    const [row] = await db.insert(planningPackages)
      .values({ repository_id: 1, slug: 'feature-abc', title: 'Feature ABC' }).returning();
    expect(row.status).toBe('draft');
    expect(row.id).toMatch(/[0-9a-f-]{36}/);
  });
});
```

- [ ] **Step 5: Run the test**

Run: `npm test -- planning-packages-db`
Expected: PASS (in-memory D1 applies the new migration automatically).

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schemas/planning-packages/index.ts src/server/db/schemas/index.ts db/migrations/d1 test/planning-packages-db.spec.ts
git commit -m "feat(planning): fielded planning-package D1 schema + migration"
```

### Task 2: Package + revision query helpers

**Files:**
- Create: `src/server/db/planning-packages.ts`
- Test: `test/planning-packages-db.spec.ts` (extend)

**Interfaces:**
- Consumes: `getDb(env)`, schema tables from Task 1.
- Produces:
  - `createPackage(env, { repositoryId, slug, title, requestPromptJson?, createdBy? }): Promise<PackageRow>`
  - `getPackage(env, id): Promise<PackageRow | null>`
  - `listPackages(env, { repositoryId?, status?, limit?, offset? }): Promise<PackageRow[]>`
  - `updatePackage(env, id, patch: Partial<{ title, status, requestPromptJson, currentRevisionId }>): Promise<void>`
  - `RevisionInput` type (scalar fields + `changeItems[]`, `tasks[]`, `fileChanges[]`, `codeCards[]`, `apiChanges[]`, `migrations[]`, `diagrams[]`)
  - `createRevision(env, packageId, input: RevisionInput): Promise<{ id: string; revisionNumber: number }>` — inserts an immutable revision + all fielded children (chunked), returns identity.
  - `getRevision(env, packageId, revisionNumber): Promise<FullRevision | null>` — header + all children arrays.
  - `listRevisions(env, packageId): Promise<RevisionRow[]>`

- [ ] **Step 1: Write failing tests for create/get package + revision immutability**

```ts
// append to test/planning-packages-db.spec.ts
import {
  createPackage, getPackage, listPackages, updatePackage,
  createRevision, getRevision, listRevisions,
} from '@server/db/planning-packages';

describe('planning-packages helpers', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('creates and lists packages by repo + status', async () => {
    const p = await createPackage(env, { repositoryId: 1, slug: 'abc', title: 'ABC' });
    expect(p.status).toBe('draft');
    await createPackage(env, { repositoryId: 1, slug: 'xyz', title: 'XYZ' });
    const drafts = await listPackages(env, { repositoryId: 1, status: 'draft' });
    expect(drafts).toHaveLength(2);
    expect(await getPackage(env, p.id)).toMatchObject({ slug: 'abc' });
  });

  it('appends immutable revisions with monotonic numbers and full children', async () => {
    const p = await createPackage(env, { repositoryId: 1, slug: 'abc', title: 'ABC' });

    const r1 = await createRevision(env, p.id, {
      source: 'jules', problem: 'P1',
      codeCards: [{ filePath: 'a.ts', language: 'ts', intent: 'add', content: 'export const a = 1;' }],
      tasks: [{ taskKey: 'T1', title: 'do a', phase: 1 }],
      changeItems: [{ kind: 'add', text: 'new file a.ts' }],
    });
    expect(r1.revisionNumber).toBe(1);

    const r2 = await createRevision(env, p.id, { source: 'jules', problem: 'P2 revised' });
    expect(r2.revisionNumber).toBe(2);

    // r1 content untouched by r2 — nothing lost
    const got = await getRevision(env, p.id, 1);
    expect(got?.problem).toBe('P1');
    expect(got?.codeCards[0].content).toBe('export const a = 1;');
    expect(got?.tasks[0].task_key).toBe('T1');
    expect(await listRevisions(env, p.id)).toHaveLength(2);
  });

  it('updates package status and current revision pointer', async () => {
    const p = await createPackage(env, { repositoryId: 1, slug: 'abc', title: 'ABC' });
    const r = await createRevision(env, p.id, { source: 'jules' });
    await updatePackage(env, p.id, { status: 'planning', currentRevisionId: r.id });
    expect(await getPackage(env, p.id)).toMatchObject({ status: 'planning', current_revision_id: r.id });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- planning-packages-db`
Expected: FAIL (`createPackage` not exported).

- [ ] **Step 3: Implement the helpers**

```ts
// src/server/db/planning-packages.ts
import { getDb } from './client';
import {
  planningPackages, packageRevisions, revisionChangeItems, revisionTasks,
  revisionFileChanges, revisionCodeCards, revisionApiChanges, revisionMigrations,
  revisionDiagrams,
} from './schemas';
import { and, asc, desc, eq, max } from 'drizzle-orm';

export type PackageRow = typeof planningPackages.$inferSelect;
export type RevisionRow = typeof packageRevisions.$inferSelect;

// Keep rows × columns under the D1 100-bound-param cap. Widest child (code cards)
// has 7 columns, so 10 rows = 70 params — safe for every child table.
const CHUNK = 10;
async function insertChunked<T>(rows: T[], run: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await run(rows.slice(i, i + CHUNK));
}

export async function createPackage(env: Pick<Env, 'DB'>, input: {
  repositoryId: number; slug: string; title: string; requestPromptJson?: string | null; createdBy?: string | null;
}): Promise<PackageRow> {
  const db = getDb(env);
  const [row] = await db.insert(planningPackages).values({
    repository_id: input.repositoryId, slug: input.slug, title: input.title,
    request_prompt_json: input.requestPromptJson ?? null, created_by: input.createdBy ?? null,
  }).returning();
  return row;
}

export async function getPackage(env: Pick<Env, 'DB'>, id: string): Promise<PackageRow | null> {
  const db = getDb(env);
  return (await db.select().from(planningPackages).where(eq(planningPackages.id, id)).get()) ?? null;
}

export async function listPackages(env: Pick<Env, 'DB'>, q: {
  repositoryId?: number; status?: string; limit?: number; offset?: number;
}): Promise<PackageRow[]> {
  const db = getDb(env);
  const conds = [];
  if (q.repositoryId != null) conds.push(eq(planningPackages.repository_id, q.repositoryId));
  if (q.status) conds.push(eq(planningPackages.status, q.status));
  return db.select().from(planningPackages)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(planningPackages.created_at))
    .limit(q.limit ?? 100).offset(q.offset ?? 0).all();
}

export async function updatePackage(env: Pick<Env, 'DB'>, id: string, patch: {
  title?: string; status?: string; requestPromptJson?: string | null; currentRevisionId?: string | null;
}): Promise<void> {
  const db = getDb(env);
  const set: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.requestPromptJson !== undefined) set.request_prompt_json = patch.requestPromptJson;
  if (patch.currentRevisionId !== undefined) set.current_revision_id = patch.currentRevisionId;
  await db.update(planningPackages).set(set).where(eq(planningPackages.id, id));
}

export type RevisionInput = {
  source: string;
  julesSessionId?: string | null;
  status?: string;
  summary?: string | null; problem?: string | null; approach?: string | null; verification?: string | null;
  prdMarkdown?: string | null; designBriefMarkdown?: string | null; promptMarkdown?: string | null;
  context?: { r2Key: string; bytes: number; sha256: string; coverageNote?: string | null } | null;
  createdBy?: string | null;
  changeItems?: Array<{ kind: string; text: string }>;
  tasks?: Array<{ taskKey: string; workstream?: string | null; phase?: number | null; title: string; description?: string | null; targetPath?: string | null; changeType?: string | null; dependsOn?: string[] }>;
  fileChanges?: Array<{ path: string; changeType: string; note?: string | null }>;
  codeCards?: Array<{ filePath?: string | null; language?: string | null; intent?: string | null; content: string }>;
  apiChanges?: Array<{ method: string; path: string; description?: string | null }>;
  migrations?: Array<{ tag?: string | null; sql: string }>;
  diagrams?: Array<{ caption?: string | null; mermaid: string }>;
};

export async function createRevision(
  env: Pick<Env, 'DB'>, packageId: string, input: RevisionInput,
): Promise<{ id: string; revisionNumber: number }> {
  const db = getDb(env);
  // Monotonic per package. PlanAgent serializes writes per package, so the
  // select-then-insert race is not reachable in practice.
  // ponytail: select-max + insert; add a retry loop only if concurrent writers appear.
  const prev = await db.select({ n: max(packageRevisions.revision_number) })
    .from(packageRevisions).where(eq(packageRevisions.package_id, packageId)).get();
  const revisionNumber = (prev?.n ?? 0) + 1;

  const [rev] = await db.insert(packageRevisions).values({
    package_id: packageId, revision_number: revisionNumber, source: input.source,
    jules_session_id: input.julesSessionId ?? null, status: input.status ?? 'proposed',
    summary: input.summary ?? null, problem: input.problem ?? null, approach: input.approach ?? null,
    verification: input.verification ?? null, prd_markdown: input.prdMarkdown ?? null,
    design_brief_markdown: input.designBriefMarkdown ?? null, prompt_markdown: input.promptMarkdown ?? null,
    context_r2_key: input.context?.r2Key ?? null, context_bytes: input.context?.bytes ?? null,
    context_sha256: input.context?.sha256 ?? null, context_coverage_note: input.context?.coverageNote ?? null,
    created_by: input.createdBy ?? null,
  }).returning();
  const rid = rev.id;
  const ord = <T>(xs: T[] | undefined) => (xs ?? []).map((x, i) => ({ x, i }));

  await insertChunked(ord(input.changeItems), (b) => db.insert(revisionChangeItems)
    .values(b.map(({ x, i }) => ({ revision_id: rid, ordinal: i, kind: x.kind, text: x.text }))));
  await insertChunked(ord(input.tasks), (b) => db.insert(revisionTasks)
    .values(b.map(({ x, i }) => ({ revision_id: rid, ordinal: i, task_key: x.taskKey, workstream: x.workstream ?? null, phase: x.phase ?? null, title: x.title, description: x.description ?? null, target_path: x.targetPath ?? null, change_type: x.changeType ?? null, depends_on: x.dependsOn ? JSON.stringify(x.dependsOn) : null }))));
  await insertChunked(ord(input.fileChanges), (b) => db.insert(revisionFileChanges)
    .values(b.map(({ x, i }) => ({ revision_id: rid, ordinal: i, path: x.path, change_type: x.changeType, note: x.note ?? null }))));
  await insertChunked(ord(input.codeCards), (b) => db.insert(revisionCodeCards)
    .values(b.map(({ x, i }) => ({ revision_id: rid, ordinal: i, file_path: x.filePath ?? null, language: x.language ?? null, intent: x.intent ?? null, content: x.content }))));
  await insertChunked(ord(input.apiChanges), (b) => db.insert(revisionApiChanges)
    .values(b.map(({ x, i }) => ({ revision_id: rid, ordinal: i, method: x.method, path: x.path, description: x.description ?? null }))));
  await insertChunked(ord(input.migrations), (b) => db.insert(revisionMigrations)
    .values(b.map(({ x, i }) => ({ revision_id: rid, ordinal: i, tag: x.tag ?? null, sql: x.sql }))));
  await insertChunked(ord(input.diagrams), (b) => db.insert(revisionDiagrams)
    .values(b.map(({ x, i }) => ({ revision_id: rid, ordinal: i, caption: x.caption ?? null, mermaid: x.mermaid }))));

  return { id: rid, revisionNumber };
}

export type FullRevision = RevisionRow & {
  changeItems: (typeof revisionChangeItems.$inferSelect)[];
  tasks: (typeof revisionTasks.$inferSelect)[];
  fileChanges: (typeof revisionFileChanges.$inferSelect)[];
  codeCards: (typeof revisionCodeCards.$inferSelect)[];
  apiChanges: (typeof revisionApiChanges.$inferSelect)[];
  migrations: (typeof revisionMigrations.$inferSelect)[];
  diagrams: (typeof revisionDiagrams.$inferSelect)[];
};

export async function getRevision(
  env: Pick<Env, 'DB'>, packageId: string, revisionNumber: number,
): Promise<FullRevision | null> {
  const db = getDb(env);
  const rev = await db.select().from(packageRevisions)
    .where(and(eq(packageRevisions.package_id, packageId), eq(packageRevisions.revision_number, revisionNumber)))
    .get();
  if (!rev) return null;
  const byOrd = (tbl: any) => db.select().from(tbl).where(eq(tbl.revision_id, rev.id)).orderBy(asc(tbl.ordinal)).all();
  const [changeItems, tasks, fileChanges, codeCards, apiChanges, migrations, diagrams] = await Promise.all([
    byOrd(revisionChangeItems), byOrd(revisionTasks), byOrd(revisionFileChanges), byOrd(revisionCodeCards),
    byOrd(revisionApiChanges), byOrd(revisionMigrations), byOrd(revisionDiagrams),
  ]);
  return { ...rev, changeItems, tasks, fileChanges, codeCards, apiChanges, migrations, diagrams } as FullRevision;
}

export async function listRevisions(env: Pick<Env, 'DB'>, packageId: string): Promise<RevisionRow[]> {
  const db = getDb(env);
  return db.select().from(packageRevisions).where(eq(packageRevisions.package_id, packageId))
    .orderBy(asc(packageRevisions.revision_number)).all();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- planning-packages-db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/planning-packages.ts test/planning-packages-db.spec.ts
git commit -m "feat(planning): package + immutable-revision query helpers"
```

### Task 3: Live task-state helpers (reconcile + update) + package export

**Files:**
- Modify: `src/server/db/planning-packages.ts`
- Test: `test/planning-packages-db.spec.ts` (extend)

**Interfaces:**
- Consumes: `getRevision`, `listRevisions`, schema `packageTasks`.
- Produces:
  - `reconcilePackageTasks(env, packageId, revisionNumber): Promise<void>` — insert task_keys from that revision that are missing in `package_tasks` as `pending`; never touch existing rows' status.
  - `updateTask(env, packageId, taskKey, patch: { status?, assignee?, prNumber?, notes? }): Promise<void>` — upsert live state.
  - `listPackageTasks(env, packageId): Promise<PackageTaskRow[]>`
  - `exportPackages(env, planIds: string[]): Promise<PackageExport[]>` — for each id: package header + every revision fully fielded + live tasks. Skips unknown ids.

- [ ] **Step 1: Write failing tests**

```ts
// append to test/planning-packages-db.spec.ts
import { reconcilePackageTasks, updateTask, listPackageTasks, exportPackages } from '@server/db/planning-packages';

describe('planning-packages task state + export', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('reconciles task state and preserves status across a new revision', async () => {
    const p = await createPackage(env, { repositoryId: 1, slug: 'abc', title: 'ABC' });
    const r1 = await createRevision(env, p.id, { source: 'jules', tasks: [{ taskKey: 'T1', title: 'a' }, { taskKey: 'T2', title: 'b' }] });
    await reconcilePackageTasks(env, p.id, r1.revisionNumber);
    await updateTask(env, p.id, 'T1', { status: 'done', assignee: 'agent-x', prNumber: 42 });

    // new revision adds T3, redefines T1 — live status must survive
    const r2 = await createRevision(env, p.id, { source: 'merge', tasks: [{ taskKey: 'T1', title: 'a2' }, { taskKey: 'T3', title: 'c' }] });
    await reconcilePackageTasks(env, p.id, r2.revisionNumber);

    const tasks = await listPackageTasks(env, p.id);
    const byKey = Object.fromEntries(tasks.map((t) => [t.task_key, t]));
    expect(byKey.T1).toMatchObject({ status: 'done', assignee: 'agent-x', pr_number: 42 });
    expect(byKey.T3).toMatchObject({ status: 'pending' });
    expect(tasks).toHaveLength(3); // T1, T2, T3
  });

  it('exports fielded packages by id and skips unknown ids', async () => {
    const p = await createPackage(env, { repositoryId: 1, slug: 'abc', title: 'ABC' });
    await createRevision(env, p.id, { source: 'jules', codeCards: [{ content: 'full code here' }] });
    const out = await exportPackages(env, [p.id, 'does-not-exist']);
    expect(out).toHaveLength(1);
    expect(out[0].package.slug).toBe('abc');
    expect(out[0].revisions[0].codeCards[0].content).toBe('full code here');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- planning-packages-db`
Expected: FAIL (`reconcilePackageTasks` not exported).

- [ ] **Step 3: Implement**

```ts
// append to src/server/db/planning-packages.ts
import { packageTasks } from './schemas';

export type PackageTaskRow = typeof packageTasks.$inferSelect;

export async function reconcilePackageTasks(
  env: Pick<Env, 'DB'>, packageId: string, revisionNumber: number,
): Promise<void> {
  const db = getDb(env);
  const rev = await getRevision(env, packageId, revisionNumber);
  if (!rev) return;
  const existing = new Set((await db.select({ k: packageTasks.task_key }).from(packageTasks)
    .where(eq(packageTasks.package_id, packageId)).all()).map((r) => r.k));
  const missing = rev.tasks.filter((t) => !existing.has(t.task_key));
  await insertChunked(missing.map((t) => t), (b) => db.insert(packageTasks)
    .values(b.map((t) => ({ package_id: packageId, task_key: t.task_key }))));
}

export async function updateTask(
  env: Pick<Env, 'DB'>, packageId: string, taskKey: string,
  patch: { status?: string; assignee?: string | null; prNumber?: number | null; notes?: string | null },
): Promise<void> {
  const db = getDb(env);
  const set: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.assignee !== undefined) set.assignee = patch.assignee;
  if (patch.prNumber !== undefined) set.pr_number = patch.prNumber;
  if (patch.notes !== undefined) set.notes = patch.notes;
  await db.insert(packageTasks)
    .values({ package_id: packageId, task_key: taskKey, status: patch.status ?? 'pending', assignee: patch.assignee ?? null, pr_number: patch.prNumber ?? null, notes: patch.notes ?? null })
    .onConflictDoUpdate({ target: [packageTasks.package_id, packageTasks.task_key], set });
}

export async function listPackageTasks(env: Pick<Env, 'DB'>, packageId: string): Promise<PackageTaskRow[]> {
  const db = getDb(env);
  return db.select().from(packageTasks).where(eq(packageTasks.package_id, packageId))
    .orderBy(asc(packageTasks.task_key)).all();
}

export type PackageExport = { package: PackageRow; revisions: FullRevision[]; tasks: PackageTaskRow[] };

export async function exportPackages(env: Pick<Env, 'DB'>, planIds: string[]): Promise<PackageExport[]> {
  const out: PackageExport[] = [];
  for (const id of planIds) {
    const pkg = await getPackage(env, id);
    if (!pkg) continue;
    const revs = await listRevisions(env, id);
    const revisions = (await Promise.all(revs.map((r) => getRevision(env, id, r.revision_number)))).filter(Boolean) as FullRevision[];
    out.push({ package: pkg, revisions, tasks: await listPackageTasks(env, id) });
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- planning-packages-db`
Expected: PASS (all task-3 specs green).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors in `src/server/db/planning-packages.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/server/db/planning-packages.ts test/planning-packages-db.spec.ts
git commit -m "feat(planning): live task-state reconcile/update + fielded export"
```

---

## Phase 2 — Ingestion API + R2 (own plan)

Deliverable: HTTP CRUD + revision append + public capability-gated export. Gets its own bite-sized plan. Task outline:

1. Add R2 binding `PLANNING_ARTIFACTS` to `wrangler.jsonc`; `npm run types`; add `MemoryR2` to `test/helpers.ts` and wire into `createTestEnv`.
2. `src/server/services/planning-packages.ts` — `upsertRevision` service: stream `context` → R2 (`planning/<pkg>/<rev>.md`, sha256, dedupe skip), then `createRevision`. Shared by HTTP + MCP.
3. `src/server/routes/api/planning-packages.ts` (Hono) — the §4.1 session routes; mount in `app.ts` inside `/api/*`.
4. Public export: `src/server/routes/public-planning.ts` — `POST /api/public/planning-packages/export`; mount **before** the `/api/*` guard (like `/reviews`); validate ids exist, return only supplied ids, basic rate-limit via `APP_KV`.
5. Tests: auth gating, revision append via HTTP, public export returns fielded JSON and rejects enumeration.

## Phase 3 — MCP tools (own plan)

Add the §5 tools in `GitHubLikeMCP.init()` (`src/server/agents/orchestrator.ts`) with Zod schemas, calling the Phase-2 service + Phase-1 helpers; mark writes `requiresApproval` in `GithubConnector` (`src/server/agents/codemode/github.ts`) so they surface in codemode. Tools: `list_planning_packages`, `get_planning_package`, `get_planning_revision`, `create_planning_package`, `submit_planning_revision`, `export_planning_packages`, `update_plan_task`. Tests: each handler against in-memory D1.

## Phase 4 — `PlanAgent` Durable Object (own plan)

New DO orchestrating Jules per §6. `wrangler.jsonc` migration `v4` (`new_sqlite_classes: ["PlanAgent"]`); re-export from `src/server/index.ts`; binding `PlanAgent`. State machine: startPlanning → ingestPlan → reviewLoop (orchestrator LLM via model service, `send_reply` re-assign, bounded) → merge (hand Jules the public export curl) → accept (mark revision accepted, set `current_revision_id`, `reconcilePackageTasks`, advance status). Wire `POST /orchestrate` + the FE button to the DO.

## Phase 5 — Jules fleet + merge services (own plan)

`src/server/services/jules-fleet.ts` (Analyze/Dispatch/Merge handlers + `createFleetOctokit` + `SessionDispatcher`→jules-sdk) and `src/server/services/jules-merge.ts` (scan/get/stage/push/merge + `createMergeOctokit`). Routes `/api/jules/fleet/*`, `/api/jules/merge/*` + MCP tools. Optional opt-in cron hook in `scheduled()` gated by a `repo_configs` toggle. Add deps `@google/jules-fleet`, `@google/jules-merge`.

## Phase 6 — Frontend (own plan)

Pages in `src/client/pages/`: `/planning/new` (repo dropdown + reused `plate-editor.tsx` + debounced autosave PATCH + Submit-to-Jules), `/planning` (by-repo groups, date DESC, status filter incl. Drafts), `/planning/:id` (revision-history selector, preview change list, live task board, code cards / api / migrations / diagrams, transcript link, orchestrate/merge controls). Register in `main.tsx` + both SPA allowlists (`app.ts`, `wrangler.jsonc run_worker_first`).

---

## Self-Review

- **Spec coverage:** §3 schema → P1 T1; §3.2–3.4 helpers/immutability/task-state → P1 T2–T3; §4 API + public export → P2; §5 MCP → P3; §6 orchestration → P4; §7 fleet/merge → P5; §8 frontend → P6; §9 testing → per-task specs. All covered.
- **Placeholders:** none — P1 (the executable phase) has full code; P2–P6 are explicitly deferred to their own plans per the writing-plans scope check (dependent subsystems, each independently testable).
- **Type consistency:** `createRevision` returns `{ id, revisionNumber }`; `reconcilePackageTasks`/`getRevision` take `(packageId, revisionNumber)`; `RevisionInput` field names match the child-table columns. Consistent across tasks.
- **Deviation from spec:** R2 binding moved from P1 to P2 (no consumer in P1). Noted in P1 deliverable line.
