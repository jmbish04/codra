import type { AppBindings } from '@server/env';
import { queryRows } from './client';
import { defaultRepoConfig, jobDetailSchema, jobSummarySchema, repoConfigSchema, type RepoConfig } from '@shared/schema';

type JobRow = {
  id: string;
  installation_id: string;
  owner: string;
  repo: string;
  pr_number: number;
  pr_title: string | null;
  pr_author: string | null;
  commit_sha: string;
  base_sha: string;
  trigger: 'auto' | 'mention' | 'retry';
  status: 'queued' | 'running' | 'done' | 'failed';
  config_snapshot: { review?: RepoConfig['review'] } | null;
  check_run_id: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  verdict: 'approve' | 'comment' | 'request_changes' | null;
  file_count: number | null;
  comment_count: number | null;
  error_msg: string | null;
  head_ref: string | null;
  base_ref: string | null;
  summary_markdown: string | null;
  review_id: number | null;
  retry_of_job_id: string | null;
  summary_model: string | null;
  steps: JobStep[] | null;
};

type JobStep = {
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  error?: string | null;
};

type JobDetailRow = JobRow & {
  files_json: unknown[] | null;
};

function mapJob(row: JobRow) {
  return jobSummarySchema.parse({
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    prNumber: row.pr_number,
    prTitle: row.pr_title,
    prAuthor: row.pr_author,
    commitSha: row.commit_sha,
    trigger: row.trigger,
    status: row.status,
    verdict: row.verdict,
    fileCount: row.file_count ?? 0,
    commentCount: row.comment_count ?? 0,
    totalInputTokens: row.total_input_tokens ?? 0,
    totalOutputTokens: row.total_output_tokens ?? 0,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_msg,
    steps: row.steps ?? [],
  });
}

export async function insertJob(
  env: Pick<AppBindings, 'NEON_DATABASE_URL'>,
  input: {
    installationId: string;
    owner: string;
    repo: string;
    prNumber: number;
    prTitle: string | null;
    prAuthor: string | null;
    commitSha: string;
    baseSha: string;
    trigger: 'auto' | 'mention' | 'retry';
    headRef: string | null;
    baseRef: string | null;
    configSnapshot?: RepoConfig | null;
    retryOfJobId?: string | null;
  },
) {
  const [row] = await queryRows<JobRow>(
    env,
    `
      INSERT INTO jobs (
        installation_id,
        owner,
        repo,
        pr_number,
        pr_title,
        pr_author,
        commit_sha,
        base_sha,
        trigger,
        status,
        config_snapshot,
        head_ref,
        base_ref,
        retry_of_job_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued', $10::jsonb, $11, $12, $13::uuid)
      RETURNING *
    `,
    [
      input.installationId,
      input.owner,
      input.repo,
      input.prNumber,
      input.prTitle,
      input.prAuthor,
      input.commitSha,
      input.baseSha,
      input.trigger,
      JSON.stringify(input.configSnapshot ?? defaultRepoConfig),
      input.headRef,
      input.baseRef,
      input.retryOfJobId ?? null,
    ],
  );

  return mapJob(row);
}

export async function listJobs(
  env: Pick<AppBindings, 'NEON_DATABASE_URL'>,
  query: {
    owner?: string;
    repo?: string;
    status?: string;
    verdict?: string;
    search?: string;
    limit: number;
    offset: number;
  },
) {
  const conditions: string[] = [];
  const params: any[] = [];

  if (query.owner) {
    params.push(query.owner);
    conditions.push(`owner = $${params.length}`);
  }
  if (query.repo) {
    params.push(query.repo);
    conditions.push(`repo = $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    conditions.push(`status = $${params.length}`);
  }
  if (query.verdict) {
    params.push(query.verdict);
    conditions.push(`verdict = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(pr_title ILIKE $${params.length} OR CAST(pr_number AS TEXT) LIKE $${params.length})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(query.limit);
  const limitIdx = params.length;
  params.push(query.offset);
  const offsetIdx = params.length;

  const rows = await queryRows<JobRow>(
    env,
    `
      SELECT *
      FROM jobs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `,
    params,
  );

  const [totalResult] = await queryRows<{ count: string }>(
    env,
    `
      SELECT COUNT(*) as count
      FROM jobs
      ${whereClause}
    `,
    params.slice(0, -2),
  );

  return {
    jobs: rows.map(mapJob),
    total: parseInt(totalResult.count, 10),
  };
}

export async function getJobForProcessing(env: Pick<AppBindings, 'NEON_DATABASE_URL'>, jobId: string) {
  const [row] = await queryRows<JobRow>(
    env,
    `
      SELECT *
      FROM jobs
      WHERE id = $1
      LIMIT 1
    `,
    [jobId],
  );

  return row ?? null;
}

export async function getJobDetail(env: Pick<AppBindings, 'NEON_DATABASE_URL'>, jobId: string) {
  const [row] = await queryRows<JobDetailRow>(
    env,
    `
      SELECT
        j.*,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', fr.id,
              'jobId', fr.job_id,
              'filePath', fr.file_path,
              'fileStatus', fr.file_status,
              'modelUsed', fr.model_used,
              'diffLineCount', fr.diff_line_count,
              'diffInput', fr.diff_input,
              'rawAiOutput', fr.raw_ai_output,
              'parsedComments', COALESCE(fr.parsed_comments, '[]'::jsonb),
              'inputTokens', fr.input_tokens,
              'outputTokens', fr.output_tokens,
              'durationMs', fr.duration_ms,
              'verdict', fr.verdict,
              'fileSummary', fr.file_summary,
              'errorMessage', fr.error_msg,
              'createdAt', fr.created_at
            )
            ORDER BY fr.created_at ASC
          ) FILTER (WHERE fr.id IS NOT NULL),
          '[]'::json
        ) AS files_json
      FROM jobs j
      LEFT JOIN file_reviews fr ON fr.job_id = j.id
      WHERE j.id = $1
      GROUP BY j.id
    `,
    [jobId],
  );

  if (!row) return null;

  return jobDetailSchema.parse({
    ...mapJob(row),
    baseSha: row.base_sha,
    headRef: row.head_ref,
    baseRef: row.base_ref,
    summaryMarkdown: row.summary_markdown,
    configSnapshot: repoConfigSchema.parse(row.config_snapshot ?? defaultRepoConfig),
    reviewId: row.review_id,
    retryOfJobId: row.retry_of_job_id,
    summaryModel: row.summary_model,
    files: row.files_json ?? [],
  });
}

export async function markJobRunning(env: Pick<AppBindings, 'NEON_DATABASE_URL'>, jobId: string) {
  await queryRows(
    env,
    `
      UPDATE jobs
      SET status = 'running',
          started_at = COALESCE(started_at, now())
      WHERE id = $1
    `,
    [jobId],
  );
}

export async function updateJobCheckRun(env: Pick<AppBindings, 'NEON_DATABASE_URL'>, jobId: string, checkRunId: number) {
  await queryRows(
    env,
    `
      UPDATE jobs
      SET check_run_id = $2
      WHERE id = $1
    `,
    [jobId, checkRunId],
  );
}

export async function completeJob(
  env: Pick<AppBindings, 'NEON_DATABASE_URL'>,
  jobId: string,
  input: {
    verdict: 'approve' | 'comment' | 'request_changes';
    fileCount: number;
    commentCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    summaryMarkdown: string;
    reviewId: number | null;
    summaryModel: string | null;
  },
) {
  await queryRows(
    env,
    `
      UPDATE jobs
      SET status = 'done',
          finished_at = now(),
          verdict = $2,
          file_count = $3,
          comment_count = $4,
          total_input_tokens = $5,
          total_output_tokens = $6,
          summary_markdown = $7,
          review_id = $8,
          summary_model = $9,
          error_msg = NULL
      WHERE id = $1
    `,
    [jobId, input.verdict, input.fileCount, input.commentCount, input.totalInputTokens, input.totalOutputTokens, input.summaryMarkdown, input.reviewId, input.summaryModel],
  );
}

export async function failJob(env: Pick<AppBindings, 'NEON_DATABASE_URL'>, jobId: string, errorMessage: string) {
  await queryRows(
    env,
    `
      UPDATE jobs
      SET status = 'failed',
          finished_at = now(),
          error_msg = $2
      WHERE id = $1
    `,
    [jobId, errorMessage],
  );
}

export async function updateJobFileCount(env: Pick<AppBindings, 'NEON_DATABASE_URL'>, jobId: string, fileCount: number) {
  await queryRows(
    env,
    `
      UPDATE jobs
      SET file_count = $2
      WHERE id = $1
    `,
    [jobId, fileCount],
  );
}

export async function findExistingJobForHead(
  env: Pick<AppBindings, 'NEON_DATABASE_URL'>,
  input: { owner: string; repo: string; prNumber: number; commitSha: string; trigger: 'auto' | 'mention' },
) {
  const [row] = await queryRows<JobRow>(
    env,
    `
      SELECT *
      FROM jobs
      WHERE owner = $1
        AND repo = $2
        AND pr_number = $3
        AND commit_sha = $4
        AND trigger = $5
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.owner, input.repo, input.prNumber, input.commitSha, input.trigger],
  );

  return row ? mapJob(row) : null;
}

export async function updateJobStep(
  env: Pick<AppBindings, 'NEON_DATABASE_URL'>,
  jobId: string,
  stepName: string,
  update: {
    status: 'pending' | 'running' | 'done' | 'failed';
    startedAt?: string | null;
    finishedAt?: string | null;
    error?: string | null;
  },
) {
  const [job] = await queryRows<JobRow>(env, 'SELECT steps FROM jobs WHERE id = $1', [jobId]);
  if (!job) return;

  let steps = (job.steps ?? []) as JobStep[];
  const stepIndex = steps.findIndex((s) => s.name === stepName);

  const now = new Date().toISOString();

  if (stepIndex === -1) {
    steps.push({
      name: stepName,
      status: update.status,
      startedAt: update.status === 'running' ? now : (update.startedAt ?? null),
      finishedAt: update.status === 'done' || update.status === 'failed' ? now : (update.finishedAt ?? null),
      error: update.error,
    });
  } else {
    steps[stepIndex] = {
      ...steps[stepIndex],
      status: update.status,
      startedAt: update.status === 'running' && !steps[stepIndex].startedAt ? now : (update.startedAt ?? steps[stepIndex].startedAt),
      finishedAt: update.status === 'done' || update.status === 'failed' ? now : (update.finishedAt ?? steps[stepIndex].finishedAt),
      error: update.error ?? steps[stepIndex].error,
    };
  }

  await queryRows(env, 'UPDATE jobs SET steps = $2 WHERE id = $1', [jobId, JSON.stringify(steps)]);
}
