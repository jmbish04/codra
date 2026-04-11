import type { AppBindings } from '@server/env';
import { queryRows } from './client';
import { statsSchema } from '@shared/schema';
import { getModelUsageStats } from './file-reviews';

export async function getStats(env: Pick<AppBindings, 'NEON_DATABASE_URL'>) {
  const [[totals], dailyRows, verdictRows, topRepos, modelRows] = await Promise.all([
    queryRows<{
      jobs: number;
      input_tokens: number;
      output_tokens: number;
      comments: number;
    }>(
      env,
      `
        SELECT
          COUNT(*)::int AS jobs,
          COALESCE(SUM(total_input_tokens), 0)::int AS input_tokens,
          COALESCE(SUM(total_output_tokens), 0)::int AS output_tokens,
          COALESCE(SUM(comment_count), 0)::int AS comments
        FROM jobs
      `,
    ),
    queryRows<{ day: string; jobs: number }>(
      env,
      `
        SELECT
          TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS day,
          COUNT(*)::int AS jobs
        FROM jobs
        WHERE created_at >= now() - interval '30 days'
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY day ASC
      `,
    ),
    queryRows<{ verdict: 'approve' | 'comment' | null; count: number }>(
      env,
      `
        SELECT verdict, COUNT(*)::int AS count
        FROM jobs
        GROUP BY verdict
        ORDER BY count DESC
      `,
    ),
    queryRows<{ owner: string; repo: string; jobs: number }>(
      env,
      `
        SELECT owner, repo, COUNT(*)::int AS jobs
        FROM jobs
        GROUP BY owner, repo
        ORDER BY jobs DESC, owner ASC, repo ASC
        LIMIT 10
      `,
    ),
    getModelUsageStats(env),
  ]);

  return statsSchema.parse({
    totals: {
      jobs: totals?.jobs ?? 0,
      inputTokens: totals?.input_tokens ?? 0,
      outputTokens: totals?.output_tokens ?? 0,
      comments: totals?.comments ?? 0,
    },
    last30Days: dailyRows.map((row) => ({ day: row.day, jobs: row.jobs })),
    verdicts: verdictRows.map((row) => ({ verdict: row.verdict, count: row.count })),
    models: modelRows.map((row) => ({
      modelUsed: row.model_used,
      calls: row.calls,
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
    })),
    topRepos: topRepos.map((row) => ({ owner: row.owner, repo: row.repo, jobs: row.jobs })),
  });
}
