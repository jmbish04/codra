import { getDb } from './client';
import {
  planningPackages, packageRevisions, revisionChangeItems, revisionTasks,
  revisionFileChanges, revisionCodeCards, revisionApiChanges, revisionMigrations,
  revisionDiagrams, packageTasks,
} from './schemas';
import { and, asc, desc, eq, max, ne } from 'drizzle-orm';

export type PackageRow = typeof planningPackages.$inferSelect;
export type RevisionRow = typeof packageRevisions.$inferSelect;

// Keep rows × columns under the D1 100-bound-param cap. Widest child (code cards)
// has 7 columns, so 10 rows = 70 params — safe for every child table.
// ponytail: fixed chunk of 10; only revisit if a child table grows past ~9 columns.
const CHUNK = 10;
/**
 * insertChunked
 */
async function insertChunked<T>(rows: T[], run: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await run(rows.slice(i, i + CHUNK));
}

/**
 * createPackage
 */
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

/**
 * getPackage
 */
export async function getPackage(env: Pick<Env, 'DB'>, id: string): Promise<PackageRow | null> {
  const db = getDb(env);
  return (await db.select().from(planningPackages).where(eq(planningPackages.id, id)).get()) ?? null;
}

/**
 * listPackages
 */
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

/**
 * updatePackage
 */
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

/**
 * Append a new immutable revision (header + all fielded children). Never
 * overwrites — a new plan is always a new revision, so prior content is never
 * lost to a hallucination or an "unchanged" shortcut.
 */
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

/**
 * getRevision
 */
export async function getRevision(
  env: Pick<Env, 'DB'>, packageId: string, revisionNumber: number,
): Promise<FullRevision | null> {
  const db = getDb(env);
  const rev = await db.select().from(packageRevisions)
    .where(and(eq(packageRevisions.package_id, packageId), eq(packageRevisions.revision_number, revisionNumber)))
    .get();
  if (!rev) return null;
  const [changeItems, tasks, fileChanges, codeCards, apiChanges, migrations, diagrams] = await Promise.all([
    db.select().from(revisionChangeItems).where(eq(revisionChangeItems.revision_id, rev.id)).orderBy(asc(revisionChangeItems.ordinal)).all(),
    db.select().from(revisionTasks).where(eq(revisionTasks.revision_id, rev.id)).orderBy(asc(revisionTasks.ordinal)).all(),
    db.select().from(revisionFileChanges).where(eq(revisionFileChanges.revision_id, rev.id)).orderBy(asc(revisionFileChanges.ordinal)).all(),
    db.select().from(revisionCodeCards).where(eq(revisionCodeCards.revision_id, rev.id)).orderBy(asc(revisionCodeCards.ordinal)).all(),
    db.select().from(revisionApiChanges).where(eq(revisionApiChanges.revision_id, rev.id)).orderBy(asc(revisionApiChanges.ordinal)).all(),
    db.select().from(revisionMigrations).where(eq(revisionMigrations.revision_id, rev.id)).orderBy(asc(revisionMigrations.ordinal)).all(),
    db.select().from(revisionDiagrams).where(eq(revisionDiagrams.revision_id, rev.id)).orderBy(asc(revisionDiagrams.ordinal)).all(),
  ]);
  return { ...rev, changeItems, tasks, fileChanges, codeCards, apiChanges, migrations, diagrams };
}

/**
 * listRevisions
 */
export async function listRevisions(env: Pick<Env, 'DB'>, packageId: string): Promise<RevisionRow[]> {
  const db = getDb(env);
  return db.select().from(packageRevisions).where(eq(packageRevisions.package_id, packageId))
    .orderBy(asc(packageRevisions.revision_number)).all();
}

/** Transition a revision's status (metadata only — content stays immutable). */
export async function setRevisionStatus(env: Pick<Env, 'DB'>, revisionId: string, status: string): Promise<void> {
  const db = getDb(env);
  await db.update(packageRevisions).set({ status }).where(eq(packageRevisions.id, revisionId));
}

/**
 * Accept one revision as the package's canonical plan: supersede every other
 * non-rejected revision, mark this one accepted, point the package at it, move
 * it to `in_progress`, and reconcile live task state. Content is never mutated.
 */
export async function acceptRevision(env: Pick<Env, 'DB'>, packageId: string, revisionId: string): Promise<void> {
  const db = getDb(env);
  const rev = await db.select().from(packageRevisions).where(eq(packageRevisions.id, revisionId)).get();
  if (!rev || rev.package_id !== packageId) throw new Error('revision not found for package');
  await db.update(packageRevisions).set({ status: 'superseded' })
    .where(and(eq(packageRevisions.package_id, packageId), ne(packageRevisions.status, 'rejected')));
  await db.update(packageRevisions).set({ status: 'accepted' }).where(eq(packageRevisions.id, revisionId));
  await updatePackage(env, packageId, { currentRevisionId: revisionId, status: 'in_progress' });
  await reconcilePackageTasks(env, packageId, rev.revision_number);
}

export type PackageTaskRow = typeof packageTasks.$inferSelect;

/**
 * Insert task_keys from the given revision that are missing in `package_tasks`
 * as `pending`. Existing rows are left untouched so live status/assignee survive
 * across revisions.
 */
export async function reconcilePackageTasks(
  env: Pick<Env, 'DB'>, packageId: string, revisionNumber: number,
): Promise<void> {
  const db = getDb(env);
  const rev = await getRevision(env, packageId, revisionNumber);
  if (!rev) return;
  const existing = new Set((await db.select({ k: packageTasks.task_key }).from(packageTasks)
    .where(eq(packageTasks.package_id, packageId)).all()).map((r) => r.k));
  const missing = rev.tasks.filter((t) => !existing.has(t.task_key));
  await insertChunked(missing, (b) => db.insert(packageTasks)
    .values(b.map((t) => ({ package_id: packageId, task_key: t.task_key }))));
}

/**
 * updateTask
 */
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

/**
 * listPackageTasks
 */
export async function listPackageTasks(env: Pick<Env, 'DB'>, packageId: string): Promise<PackageTaskRow[]> {
  const db = getDb(env);
  return db.select().from(packageTasks).where(eq(packageTasks.package_id, packageId))
    .orderBy(asc(packageTasks.task_key)).all();
}

export type PackageExport = { package: PackageRow; revisions: FullRevision[]; tasks: PackageTaskRow[] };

/** Fielded export of every revision for each supplied package id. Skips unknown ids. */
export async function exportPackages(env: Pick<Env, 'DB'>, planIds: string[]): Promise<PackageExport[]> {
  const out: PackageExport[] = [];
  for (const id of planIds) {
    const pkg = await getPackage(env, id);
    if (!pkg) continue;
    const revs = await listRevisions(env, id);
    /**
     * revisions
     */
    const revisions = (await Promise.all(revs.map((r) => getRevision(env, id, r.revision_number)))).filter(Boolean) as FullRevision[];
    out.push({ package: pkg, revisions, tasks: await listPackageTasks(env, id) });
  }
  return out;
}
