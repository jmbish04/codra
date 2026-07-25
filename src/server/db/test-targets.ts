import { getDb, parseJsonColumn } from './client';
import { testTargets } from './schemas';
import { and, asc, eq } from 'drizzle-orm';

export type TestTargetKind = 'api' | 'mcp' | 'frontend';
export type TestTargetStatus = 'pending' | 'passed' | 'failed' | 'blocked_auth' | 'skipped' | 'error';

export type TestTargetInput = {
  jobId: string;
  owner: string;
  repo: string;
  prNumber: number;
  kind: TestTargetKind;
  method?: string | null;
  target: string;
  reason?: string | null;
  params?: unknown;
};

export async function addTestTargets(env: Pick<Env, 'DB'>, targets: TestTargetInput[]) {
  if (targets.length === 0) return;
  const db = getDb(env);
  await db.insert(testTargets).values(
    targets.map((t) => ({
      job_id: t.jobId,
      owner: t.owner,
      repo: t.repo,
      pr_number: t.prNumber,
      kind: t.kind,
      method: t.method ?? null,
      target: t.target,
      reason: t.reason ?? null,
      params: t.params ?? null,
    })),
  );
}

export async function listTestTargetsForJob(env: Pick<Env, 'DB'>, jobId: string) {
  const db = getDb(env);
  const rows = await db.select().from(testTargets)
    .where(eq(testTargets.job_id, jobId))
    .orderBy(asc(testTargets.created_at))
    .all();
  return rows.map((r) => ({ ...r, params: parseJsonColumn(r.params, null), result: parseJsonColumn(r.result, null) }));
}

export async function listPendingTestTargetsForJob(env: Pick<Env, 'DB'>, jobId: string) {
  const db = getDb(env);
  const rows = await db.select().from(testTargets)
    .where(and(eq(testTargets.job_id, jobId), eq(testTargets.status, 'pending')))
    .all();
  return rows.map((r) => ({ ...r, params: parseJsonColumn(r.params, null) }));
}

/** Public-safe test report for a job: job info + all targets with results. */
export async function getTestReport(env: Pick<Env, 'DB'>, jobId: string) {
  if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
    return null;
  }
  const targets = await listTestTargetsForJob(env, jobId);
  if (targets.length === 0) return null;
  const first = targets[0];
  return {
    jobId,
    repo: `${first.owner}/${first.repo}`,
    prNumber: first.pr_number,
    targetCount: targets.length,
    targets: targets.map((t) => ({
      kind: t.kind,
      method: t.method,
      target: t.target,
      reason: t.reason,
      params: t.params,
      status: t.status,
      statusCode: t.status_code,
      result: t.result,
      screenshotUrl: t.screenshot_url,
      error: t.error,
    })),
  };
}

export async function updateTestTargetResult(
  env: Pick<Env, 'DB'>,
  id: string,
  patch: { status: TestTargetStatus; statusCode?: number | null; result?: unknown; screenshotUrl?: string | null; error?: string | null },
) {
  const db = getDb(env);
  await db.update(testTargets).set({
    status: patch.status,
    status_code: patch.statusCode ?? null,
    result: patch.result ?? null,
    screenshot_url: patch.screenshotUrl ?? null,
    error: patch.error ?? null,
  }).where(eq(testTargets.id, id));
}
