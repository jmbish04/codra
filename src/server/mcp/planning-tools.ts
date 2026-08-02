/**
 * Planning-package MCP tool handlers as plain, node-testable functions.
 *
 * `GitHubLikeMCP.init()` (in agents/orchestrator.ts, a Workers-only module that
 * can't be imported under `environment:'node'`) registers thin wrappers around
 * these. Keeping the logic here means it is unit-tested against in-memory D1.
 *
 * These are the tools a coding agent uses mid-session and the orchestrator uses
 * to drive Jules: read across revisions, append a new immutable revision, and
 * keep task status/assignee current.
 */
import {
  createPackage, getPackage, listPackages,
  getRevision, listRevisions, listPackageTasks, updateTask, exportPackages,
  type PackageRow, type RevisionRow, type PackageTaskRow, type FullRevision, type PackageExport,
} from '@server/db/planning-packages';
import { upsertRevision, type UpsertRevisionInput } from '@server/services/planning-packages';
import { slugifyPackage } from '@server/utils/slug';

type Env2 = Pick<Env, 'DB' | 'PLANNING_ARTIFACTS'>;

/** Cap inlined transcript size (chars) so a huge dump can't blow the tool response. */
export const CONTEXT_INLINE_CAP = 700_000;

export async function mcpListPlanningPackages(
  env: Env2, args: { repo?: number; status?: string; limit?: number },
): Promise<{ packages: PackageRow[] }> {
  return { packages: await listPackages(env, { repositoryId: args.repo, status: args.status, limit: args.limit ?? 100 }) };
}

export type GetPackageResult =
  | { error: 'not_found' }
  | { package: PackageRow; revisions: RevisionRow[] | FullRevision[]; tasks: PackageTaskRow[]; context?: Record<string, string> };

export async function mcpGetPlanningPackage(
  env: Env2, args: { packageId: string; includeRevisions?: boolean; includeContext?: boolean },
): Promise<GetPackageResult> {
  const pkg = await getPackage(env, args.packageId);
  if (!pkg) return { error: 'not_found' };
  const [summaries, tasks] = await Promise.all([listRevisions(env, pkg.id), listPackageTasks(env, pkg.id)]);
  if (!args.includeRevisions) return { package: pkg, revisions: summaries, tasks };

  const full = (await Promise.all(summaries.map((r) => getRevision(env, pkg.id, r.revision_number)))).filter(Boolean) as FullRevision[];
  const result: GetPackageResult = { package: pkg, revisions: full, tasks };
  if (args.includeContext) {
    const context: Record<string, string> = {};
    for (const rev of full) {
      if (!rev.context_r2_key) continue;
      const obj = await env.PLANNING_ARTIFACTS.get(rev.context_r2_key);
      if (!obj) continue;
      const text = await obj.text();
      context[String(rev.revision_number)] = text.length > CONTEXT_INLINE_CAP
        ? `${text.slice(0, CONTEXT_INLINE_CAP)}\n\n[TRUNCATED — ${text.length} chars total]`
        : text;
    }
    result.context = context;
  }
  return result;
}

export async function mcpGetPlanningRevision(
  env: Env2, args: { packageId: string; revisionNumber: number },
): Promise<{ revision: FullRevision } | { error: 'not_found' }> {
  const rev = await getRevision(env, args.packageId, args.revisionNumber);
  return rev ? { revision: rev } : { error: 'not_found' };
}

export async function mcpCreatePlanningPackage(
  env: Env2, args: { repositoryId: number; title: string; slug?: string; promptMarkdown?: string; createdBy?: string },
): Promise<{ package: PackageRow }> {
  const pkg = await createPackage(env, {
    repositoryId: args.repositoryId, title: args.title, slug: slugifyPackage(args.slug ?? args.title),
    requestPromptJson: args.promptMarkdown ?? null, createdBy: args.createdBy ?? null,
  });
  return { package: pkg };
}

export async function mcpSubmitPlanningRevision(
  env: Env2, packageId: string, input: UpsertRevisionInput,
): Promise<{ revision: { id: string; revisionNumber: number } } | { error: 'not_found' }> {
  if (!(await getPackage(env, packageId))) return { error: 'not_found' };
  return { revision: await upsertRevision(env, packageId, input) };
}

export async function mcpExportPlanningPackages(
  env: Env2, args: { planIds: string[] },
): Promise<{ packages: PackageExport[] }> {
  return { packages: await exportPackages(env, args.planIds) };
}

export async function mcpUpdatePlanTask(
  env: Env2, args: { packageId: string; taskKey: string; status?: string; assignee?: string | null; prNumber?: number | null; notes?: string | null },
): Promise<{ ok: true; taskKey: string } | { error: 'not_found' }> {
  if (!(await getPackage(env, args.packageId))) return { error: 'not_found' };
  await updateTask(env, args.packageId, args.taskKey, {
    status: args.status, assignee: args.assignee, prNumber: args.prNumber, notes: args.notes,
  });
  return { ok: true, taskKey: args.taskKey };
}
