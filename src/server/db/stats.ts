import { getDb } from './client';
import { statsSchema } from '@shared/schema';
import { getModelUsageStats } from './file-reviews';
import { jobs, repositories } from './schemas';
import { count, sum, eq, desc, asc, sql } from 'drizzle-orm';

export async function getStats(env: Pick<Env, 'DB'>, days = 30) {
  const db = getDb(env);
  const parsedDays = Number(days);
  const safeDays = Number.isFinite(parsedDays) ? Math.trunc(parsedDays) : 30;
  const clampedDays = Math.min(Math.max(safeDays, 1), 365);
  
  const dayExpr = sql`strftime('%Y-%m-%d', ${jobs.created_at})`;

  const [totals, dailyRows, verdictRows, topRepos, modelRows] = await Promise.all([
    db.select({
      jobs: count(),
      input_tokens: sum(jobs.total_input_tokens),
      output_tokens: sum(jobs.total_output_tokens),
      comments: sum(jobs.comment_count),
    }).from(jobs).get(),

    db.select({
      day: sql<string>`${dayExpr}`,
      jobs: count(),
      input_tokens: sum(jobs.total_input_tokens),
      output_tokens: sum(jobs.total_output_tokens),
      comments: sum(jobs.comment_count),
    })
    .from(jobs)
    .where(sql`${jobs.created_at} >= datetime('now', '-' || ${clampedDays} || ' days')`)
    .groupBy(sql`${dayExpr}`)
    .orderBy(sql`${dayExpr} ASC`),

    db.select({
      verdict: jobs.verdict,
      count: count(),
    })
    .from(jobs)
    .groupBy(jobs.verdict)
    .orderBy(desc(count())),

    db.select({
      owner: repositories.owner,
      repo: repositories.repo,
      jobs: count(),
    })
    .from(jobs)
    .innerJoin(repositories, eq(jobs.repository_id, repositories.id))
    .groupBy(repositories.owner, repositories.repo)
    .orderBy(desc(count()), asc(repositories.owner), asc(repositories.repo))
    .limit(10),

    getModelUsageStats(env),
  ]);

  return statsSchema.parse({
    totals: {
      jobs: totals?.jobs ?? 0,
      inputTokens: Number(totals?.input_tokens ?? 0),
      outputTokens: Number(totals?.output_tokens ?? 0),
      comments: Number(totals?.comments ?? 0),
    },
    trend: dailyRows.map((row) => ({ 
      day: row.day, 
      jobs: row.jobs,
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      comments: Number(row.comments ?? 0)
    })),
    verdicts: verdictRows.map((row) => ({ verdict: row.verdict as 'approve' | 'comment' | null, count: row.count })),
    models: modelRows.map((row) => ({
      modelUsed: row.model_used,
      provider: row.model_provider ?? undefined,
      calls: row.calls,
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
    })),
    topRepos: topRepos.map((row) => ({ owner: row.owner, repo: row.repo, jobs: row.jobs })),
  });
}
