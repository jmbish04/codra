import { sqliteTable, text, integer, unique, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Planning packages — per-repo, fielded (no giant JSON blob), revision-safe plan
 * bundles produced and merged by multi-agent orchestration. See
 * docs/superpowers/specs/2026-08-02-planning-packages-design.md.
 *
 * Every revision is an immutable snapshot: a new plan is a new `package_revisions`
 * row plus new fielded child rows, so a model hallucination or an "unchanged"
 * shortcut in one revision never destroys earlier content.
 */

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

// Fielded children — one factory keeps id/revision_id/ordinal uniform.
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

/**
 * Live mutable task state, keyed per package (not per revision) so status and
 * assignee survive across revisions. Task *definitions* live in `revision_tasks`;
 * this holds progress. MCP `update_plan_task` and the orchestrator write here.
 */
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
