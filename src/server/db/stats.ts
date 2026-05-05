import type { AppBindings } from '@server/env';
import { queryRows } from './client';
import { statsSchema } from '@shared/schema';
import { getModelUsageStats } from './file-reviews';

export async function getStats(env: Pick<AppBindings, 'HYPERDRIVE'>, days = 30) {
  const parsedDays = Number(days);
  const safeDays = Number.isFinite(parsedDays) ? Math.trunc(parsedDays) : 30;
  const clampedDays = Math.min(Math.max(safeDays, 1), 365);
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
    queryRows<{ day: string; jobs: number; input_tokens: number; output_tokens: number; comments: number }>(
      env,
      `
        SELECT
          TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS day,
          COUNT(*)::int AS jobs,
          COALESCE(SUM(total_input_tokens), 0)::int AS input_tokens,
          COALESCE(SUM(total_output_tokens), 0)::int AS output_tokens,
          COALESCE(SUM(comment_count), 0)::int AS comments
        FROM jobs
        WHERE created_at >= now() - ($1::int * interval '1 day')
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY day ASC
      `,
      [clampedDays],
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
        SELECT r.owner, r.repo, COUNT(*)::int AS jobs
        FROM jobs j
        JOIN repositories r ON j.repository_id = r.id
        GROUP BY r.owner, r.repo
        ORDER BY jobs DESC, r.owner ASC, r.repo ASC
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
    trend: dailyRows.map((row) => ({ 
      day: row.day, 
      jobs: row.jobs,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      comments: row.comments
    })),
    verdicts: verdictRows.map((row) => ({ verdict: row.verdict, count: row.count })),
    models: modelRows.map((row) => ({
      modelUsed: row.model_used,
      provider: row.model_provider ?? undefined,
      calls: row.calls,
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
    })),
    topRepos: topRepos.map((row) => ({ owner: row.owner, repo: row.repo, jobs: row.jobs })),
  });
}
