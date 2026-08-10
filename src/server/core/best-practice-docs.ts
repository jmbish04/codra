import { getDb, parseJsonColumn } from '@server/db/client';
import { listBestPractices } from '@server/db/best-practices';
import { recordBestPracticeDocs, type BestPracticeDocsPayload } from '@server/db/jobs';
import { fileReviews } from '@server/db/schemas';
import { fetchCloudflareDocResult, type CloudflareDocResult } from '@server/services/cloudflare-docs';
import type { BestPracticeCheck } from '@shared/schema';
import { eq } from 'drizzle-orm';

/**
 * Read all persisted per-file best_practice_checks for a job, tally pass/violation
 * per practice, fetch a static Cloudflare-docs snapshot for each violated
 * cloudflare-workers practice, and persist the aggregate on the job row.
 * Best-effort and non-blocking: any docs miss yields content: ''.
 */
export async function aggregateBestPracticeDocs(env: Pick<Env, 'DB'>, jobId: string): Promise<BestPracticeDocsPayload> {
  const db = getDb(env);
  const rows = await db.select({ checks: fileReviews.best_practice_checks })
    .from(fileReviews)
    .where(eq(fileReviews.job_id, jobId))
    .all();

  const tally = new Map<string, { passed: number; violated: number }>();
  for (const row of rows) {
    const checks = parseJsonColumn<BestPracticeCheck[]>(row.checks, []);
    for (const check of checks) {
      const current = tally.get(check.practice) ?? { passed: 0, violated: 0 };
      if (check.status === 'violation') current.violated += 1;
      else current.passed += 1;
      tally.set(check.practice, current);
    }
  }

  const checks = [...tally.entries()].map(([practice, counts]) => ({ practice, ...counts }));
  const violated = checks.filter((check) => check.violated > 0).map((check) => check.practice);

  // Gate CF-docs queries to cloudflare-workers practices only.
  const practices = await listBestPractices(env);
  const cloudflareWorkersPracticeNames = new Set(
    practices
      .filter((practice) => practice.infraId === 'cloudflare-workers')
      .map((practice) => practice.name),
  );
  const cfViolated = [...new Set(violated.filter((name) => cloudflareWorkersPracticeNames.has(name)))];

  const docs: CloudflareDocResult[] = [];
  for (const name of cfViolated) {
    try {
      docs.push(await fetchCloudflareDocResult(name));
    } catch {
      docs.push({ query: name, source: 'cloudflare-docs', content: '' });
    }
  }

  const payload: BestPracticeDocsPayload = { violated, checks, docs };
  await recordBestPracticeDocs(env, jobId, payload);
  return payload;
}
