import type { AppBindings } from '@server/env';
import { parseJsonColumn, queryRows } from './client';
import { defaultRepoConfig, jobDetailSchema, jobSummarySchema, repoConfigSchema, type RepoConfig } from '@shared/schema';
import { getOrCreateRepository } from './repositories';

export type JobRow = {
  id: string;
  installation_id: string;
  owner: string;
  repo: string;
  pr_number: number;
  pr_title: string | null;
  pr_author: string | null;
  commit_sha: ByteaValue;
  base_sha: ByteaValue;
  trigger: 'auto' | 'mention' | 'retry';
  status: 'queued' | 'running' | 'done' | 'failed' | 'superseded';
  config_snapshot: { review?: RepoConfig['review']; model?: RepoConfig['model'] } | string | null;
  check_run_id: number | null;
  check_run_completed_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  recovery_count: number | null;
  last_queue_message_at: string | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  verdict: 'approve' | 'comment' | null;
  file_count: number | null;
  comment_count: number | null;
  error_msg: string | null;
  head_ref: string | null;
  base_ref: string | null;
  summary_markdown: string | null;
  review_id: number | null;
  retry_of_job_id: string | null;
  summary_model: string | null;
  overall_confidence_score: number | null;
  steps: JobStep[] | string | null;
};

type JobStep = {
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  error?: string | null;
};

type JobDetailRow = JobRow & {
  files_json: unknown[] | string | null;
};

type ByteaValue = ArrayBuffer | ArrayBufferView | string;

export type JobLeaseClaim =
  | { status: 'claimed'; row: JobRow }
  | { status: 'busy'; row: JobRow; retryAfterSeconds: number }
  | { status: 'terminal'; row: JobRow }
  | { status: 'missing' };

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(value: ByteaValue) {
  if (typeof value === 'string') {
    return value.startsWith('\\x') ? value.slice(2).toLowerCase() : value.toLowerCase();
  }

  const bytes = ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function mapJob(row: JobRow) {
  return jobSummarySchema.parse({
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    installationId: row.installation_id,
    prNumber: row.pr_number,
    prTitle: row.pr_title,
    prAuthor: row.pr_author,
    commitSha: bytesToHex(row.commit_sha),
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
    overallConfidenceScore: row.overall_confidence_score,
    steps: parseJsonColumn(row.steps, []),
    checkRunId: row.check_run_id,
    configSnapshot: row.config_snapshot ? repoConfigSchema.parse(parseJsonColumn(row.config_snapshot, defaultRepoConfig)) : null,
    retryOfJobId: row.retry_of_job_id,
  });
}

export async function insertJob(
  env: Pick<AppBindings, 'HYPERDRIVE'>,
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
  const repositoryId = await getOrCreateRepository(env, {
    installationId: input.installationId,
    owner: input.owner,
    repo: input.repo,
  });

  const [row] = await queryRows<JobRow>(
    env,
    `
      WITH inserted AS (
        INSERT INTO jobs (
          repository_id,
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8::jsonb, $9, $10, $11::uuid)
        RETURNING *
      )
      SELECT i.*, r.owner, r.repo, r.installation_id
      FROM inserted i
      JOIN repositories r ON i.repository_id = r.id
    `,
    [
      repositoryId,
      input.prNumber,
      input.prTitle,
      input.prAuthor,
      hexToBytes(input.commitSha),
      hexToBytes(input.baseSha),
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
  env: Pick<AppBindings, 'HYPERDRIVE'>,
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
    conditions.push(`r.owner = $${params.length}`);
  }
  if (query.repo) {
    params.push(query.repo);
    conditions.push(`r.repo = $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    conditions.push(`j.status = $${params.length}`);
  }
  if (query.verdict) {
    params.push(query.verdict);
    conditions.push(`j.verdict = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(j.pr_title ILIKE $${params.length} OR CAST(j.pr_number AS TEXT) LIKE $${params.length})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(query.limit);
  const limitIdx = params.length;
  params.push(query.offset);
  const offsetIdx = params.length;

  const rows = await queryRows<JobRow>(
    env,
    `
      SELECT j.*, r.owner, r.repo, r.installation_id
      FROM jobs j
      JOIN repositories r ON j.repository_id = r.id
      ${whereClause}
      ORDER BY j.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `,
    params,
  );

  const [totalResult] = await queryRows<{ count: string }>(
    env,
    `
      SELECT COUNT(*) as count
      FROM jobs j
      JOIN repositories r ON j.repository_id = r.id
      ${whereClause}
    `,
    params.slice(0, -2),
  );

  return {
    jobs: rows.map(mapJob),
    total: parseInt(totalResult.count, 10),
  };
}

export async function getJobForProcessing(env: Pick<AppBindings, 'HYPERDRIVE'>, jobId: string) {
  if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
    return null;
  }
  const [row] = await queryRows<JobRow>(
    env,
    `
      SELECT j.*, r.owner, r.repo, r.installation_id
      FROM jobs j
      JOIN repositories r ON j.repository_id = r.id
      WHERE j.id = $1
      LIMIT 1
    `,
    [jobId],
  );

  return row ?? null;
}

export async function getJobDetail(env: Pick<AppBindings, 'HYPERDRIVE'>, jobId: string) {
  if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
    return null;
  }

  const [row] = await queryRows<JobDetailRow>(
    env,
    `
      SELECT
        j.*,
        r.owner,
        r.repo,
        r.installation_id,
        COALESCE(
          (
            SELECT JSON_AGG(
              JSON_BUILD_OBJECT(
                'id', fr.id,
                'jobId', fr.job_id,
                'filePath', fr.file_path,
                'fileStatus', fr.file_status,
                'modelUsed', fr.model_used,
                'diffLineCount', fr.diff_line_count,
                'diffInput', fr.diff_input,
                'rawAiOutput', fr.raw_ai_output,
                'inputTokens', fr.input_tokens,
                'outputTokens', fr.output_tokens,
                'durationMs', fr.duration_ms,
                'verdict', fr.verdict,
                'fileSummary', fr.file_summary,
                'errorMessage', fr.error_msg,
                'createdAt', fr.created_at,
                'parsedComments', COALESCE(
                  (
                    SELECT JSON_AGG(
                      JSON_BUILD_OBJECT(
                        'path', rc.path,
                        'line', rc.line,
                        'position', rc.position,
                        'severity', rc.severity,
                        'category', rc.category,
                        'title', rc.title,
                        'body', rc.body,
                        'codeSuggestion', rc.code_suggestion
                      )
                      ORDER BY rc.id ASC
                    ) FROM review_comments rc WHERE rc.file_review_id = fr.id
                  ),
                  '[]'::json
                )
              )
              ORDER BY fr.created_at ASC
            )
            FROM file_reviews fr
            WHERE fr.job_id = j.id
          ),
          '[]'::json
        ) AS files_json
      FROM jobs j
      JOIN repositories r ON j.repository_id = r.id
      WHERE j.id = $1
    `,
    [jobId],
  );

  if (!row) return null;

  return jobDetailSchema.parse({
    ...mapJob(row),
    baseSha: bytesToHex(row.base_sha),
    headRef: row.head_ref,
    baseRef: row.base_ref,
    summaryMarkdown: row.summary_markdown,
    configSnapshot: repoConfigSchema.parse(parseJsonColumn(row.config_snapshot, defaultRepoConfig)),
    reviewId: row.review_id,
    retryOfJobId: row.retry_of_job_id,
    summaryModel: row.summary_model,
    files: parseJsonColumn(row.files_json, []),
  });
}

export async function startJobProcessing(env: Pick<AppBindings, 'HYPERDRIVE'>, jobId: string, stepName: string) {
  const now = new Date().toISOString();
  const rows = await queryRows<{ id: string }>(
    env,
    `
      UPDATE jobs
      SET status = 'running',
          started_at = COALESCE(started_at, now()),
          steps = COALESCE(steps, '[]'::jsonb) || jsonb_build_array(
            jsonb_build_object(
              'name', $2::text,
              'status', 'running',
              'startedAt', $3::text,
              'finishedAt', NULL,
              'error', NULL
            )
          )
      WHERE id = $1
        AND status = 'queued'
      RETURNING id
    `,
    [jobId, stepName, now],
  );

  return rows.length > 0;
}

export async function claimJobLease(
  env: Pick<AppBindings, 'HYPERDRIVE'>,
  jobId: string,
  leaseOwner: string,
  leaseSeconds: number,
): Promise<JobLeaseClaim> {
  const [claimed] = await queryRows<JobRow>(
    env,
    `
      WITH claimed AS (
        UPDATE jobs
        SET status = CASE WHEN status = 'queued' THEN 'running' ELSE status END,
            started_at = COALESCE(started_at, now()),
            lease_owner = $2,
            lease_expires_at = now() + ($3 || ' seconds')::interval,
            heartbeat_at = now(),
            last_queue_message_at = now()
        WHERE id = $1
          AND status IN ('queued', 'running')
          AND (
            lease_expires_at IS NULL
            OR lease_expires_at < now()
            OR lease_owner = $2
          )
        RETURNING *
      )
      SELECT c.*, r.owner, r.repo, r.installation_id
      FROM claimed c
      JOIN repositories r ON c.repository_id = r.id
    `,
    [jobId, leaseOwner, String(leaseSeconds)],
  );

  if (claimed) {
    return { status: 'claimed', row: claimed };
  }

  const row = await getJobForProcessing(env, jobId);
  if (!row) {
    return { status: 'missing' };
  }

  if (!['queued', 'running'].includes(row.status)) {
    return { status: 'terminal', row };
  }

  const expiresAt = row.lease_expires_at ? new Date(row.lease_expires_at).getTime() : 0;
  const secondsUntilExpiry = Math.ceil((expiresAt - Date.now()) / 1000);
  return {
    status: 'busy',
    row,
    retryAfterSeconds: Math.max(15, Math.min(60, Number.isFinite(secondsUntilExpiry) ? secondsUntilExpiry : 60)),
  };
}

export async function heartbeatJobLease(
  env: Pick<AppBindings, 'HYPERDRIVE'>,
  jobId: string,
  leaseOwner: string,
  leaseSeconds: number,
) {
  await queryRows(
    env,
    `
      UPDATE jobs
      SET heartbeat_at = now(),
          lease_expires_at = now() + ($3 || ' seconds')::interval
      WHERE id = $1
        AND lease_owner = $2
        AND status = 'running'
    `,
    [jobId, leaseOwner, String(leaseSeconds)],
  );
}

export async function releaseJobLease(env: Pick<AppBindings, 'HYPERDRIVE'>, jobId: string, leaseOwner: string) {
  await queryRows(
    env,
    `
      UPDATE jobs
      SET lease_owner = NULL,
          lease_expires_at = NULL
      WHERE id = $1
        AND lease_owner = $2
    `,
    [jobId, leaseOwner],
  );
}

export async function markJobContinuationQueued(env: Pick<AppBindings, 'HYPERDRIVE'>, jobId: string) {
  await queryRows(
    env,
    `
      UPDATE jobs
      SET last_queue_message_at = now()
      WHERE id = $1
        AND status = 'running'
    `,
    [jobId],
  );
}

export async function updateJobCheckRun(env: Pick<AppBindings, 'HYPERDRIVE'>, jobId: string, checkRunId: number) {
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
  env: Pick<AppBindings, 'HYPERDRIVE'>,
  jobId: string,
  input: {
    verdict: 'approve' | 'comment';
    fileCount: number;
    commentCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    summaryMarkdown: string;
    reviewId: number | null;
    summaryModel: string | null;
    overallConfidenceScore?: number | null;
  },
) {
  await queryRows(
    env,
    `
      UPDATE jobs
      SET status = 'done',
          finished_at = now(),
          check_run_completed_at = now(),
          lease_owner = NULL,
          lease_expires_at = NULL,
          verdict = $2,
          file_count = $3,
          comment_count = $4,
          total_input_tokens = $5,
          total_output_tokens = $6,
          summary_markdown = $7,
          review_id = $8,
          summary_model = $9,
          overall_confidence_score = $10,
          error_msg = NULL
      WHERE id = $1
    `,
    [
      jobId,
      input.verdict,
      input.fileCount,
      input.commentCount,
      input.totalInputTokens,
      input.totalOutputTokens,
      input.summaryMarkdown,
      input.reviewId,
      input.summaryModel,
      input.overallConfidenceScore ?? null
    ],
  );
}

export async function failJob(env: Pick<AppBindings, 'HYPERDRIVE'>, jobId: string, errorMessage: string) {
  await queryRows(
    env,
    `
      UPDATE jobs
      SET status = 'failed',
          finished_at = now(),
          lease_owner = NULL,
          lease_expires_at = NULL,
          error_msg = $2,
          steps = CASE
            WHEN steps IS NOT NULL THEN (
              SELECT jsonb_agg(
                CASE
                  WHEN s->>'status' = 'running'
                  THEN s || jsonb_build_object('status', 'failed', 'finishedAt', now(), 'error', $2::text)
                  ELSE s
                END
              ) FROM jsonb_array_elements(steps) s
            )
            ELSE steps
          END
      WHERE id = $1
    `,
    [jobId, errorMessage],
  );
}

export async function markJobCheckRunCompleted(env: Pick<AppBindings, 'HYPERDRIVE'>, jobId: string) {
  await queryRows(
    env,
    `
      UPDATE jobs
      SET check_run_completed_at = now()
      WHERE id = $1
    `,
    [jobId],
  );
}

export async function updateJobFileCount(env: Pick<AppBindings, 'HYPERDRIVE'>, jobId: string, fileCount: number) {
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

export async function completePreparationStep(env: Pick<AppBindings, 'HYPERDRIVE'>, jobId: string, fileCount: number) {
  const now = new Date().toISOString();
  await queryRows(
    env,
    `
      UPDATE jobs
      SET file_count = $2,
          steps = (
            SELECT jsonb_agg(
              CASE
                WHEN s->>'name' = 'Preparation'
                THEN s || jsonb_build_object('status', 'done', 'finishedAt', $3::text)
                ELSE s
              END
            ) FROM jsonb_array_elements(steps) s
          )
      WHERE id = $1
    `,
    [jobId, fileCount, now],
  );
}

export async function findExistingJobForHead(
  env: Pick<AppBindings, 'HYPERDRIVE'>,
  input: { owner: string; repo: string; prNumber: number; commitSha: string; trigger: 'auto' | 'mention' },
) {
  const [row] = await queryRows<JobRow>(
    env,
    `
      SELECT j.*, r.owner, r.repo, r.installation_id
      FROM jobs j
      JOIN repositories r ON j.repository_id = r.id
      WHERE r.owner = $1
        AND r.repo = $2
        AND j.pr_number = $3
        AND j.commit_sha = $4
        AND j.trigger = $5
      ORDER BY j.created_at DESC
      LIMIT 1
    `,
    [input.owner, input.repo, input.prNumber, hexToBytes(input.commitSha), input.trigger],
  );

  return row ? mapJob(row) : null;
}

export async function updateJobStep(
  env: Pick<AppBindings, 'HYPERDRIVE'>,
  jobId: string,
  stepName: string,
  update: {
    status: 'pending' | 'running' | 'done' | 'failed';
    startedAt?: string | null;
    finishedAt?: string | null;
    error?: string | null;
  },
) {
  const now = new Date().toISOString();
  const startedAt = update.status === 'running' ? now : (update.startedAt ?? null);
  const finishedAt = update.status === 'done' || update.status === 'failed' ? now : (update.finishedAt ?? null);
  const error = update.error ?? null;

  // Single query that either updates existing step or appends a new one
  await queryRows(
    env,
    `
      UPDATE jobs
      SET steps = CASE
        WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(steps, '[]'::jsonb)) s WHERE s->>'name' = $2)
        THEN (
          SELECT jsonb_agg(
            CASE
              WHEN s->>'name' = $2
              THEN s || jsonb_build_object(
                'status', $3::text,
                'startedAt', COALESCE($4::text, s->>'startedAt'),
                'finishedAt', COALESCE($5::text, s->>'finishedAt'),
                'error', COALESCE($6::text, s->>'error')
              )
              ELSE s
            END
          ) FROM jsonb_array_elements(COALESCE(steps, '[]'::jsonb)) s
        )
        ELSE COALESCE(steps, '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object(
            'name', $2::text,
            'status', $3::text,
            'startedAt', $4::text,
            'finishedAt', $5::text,
            'error', $6::text
          )
        )
      END
      WHERE id = $1
    `,
    [jobId, stepName, update.status, startedAt, finishedAt, error],
  );
}

export async function recoverStaleJobs(
  env: Pick<AppBindings, 'HYPERDRIVE'>,
  thresholdMinutes = 20,
): Promise<number> {
  const rows = await queryRows<{ id: string }>(env, `
    UPDATE jobs
    SET status     = 'failed',
        finished_at = now(),
        error_msg  = 'Job timed out: worker crashed or was evicted.'
    WHERE status = 'running'
      AND started_at < now() - ($1 || ' minutes')::interval
    RETURNING id
  `, [String(thresholdMinutes)]);

  return rows.length;
}

export async function recoverExpiredJobLeases(
  env: Pick<AppBindings, 'HYPERDRIVE'>,
  maxRecoveryCount = 3,
  unleasedGraceSeconds = 120,
) {
  const requeued = await queryRows<{ id: string }>(
    env,
    `
      WITH expired AS (
        SELECT id
        FROM jobs
        WHERE status = 'running'
          AND (
            (
              lease_expires_at IS NOT NULL
              AND lease_expires_at < now()
            )
            OR (
              lease_expires_at IS NULL
              AND COALESCE(last_queue_message_at, heartbeat_at, started_at, created_at) < now() - ($2 || ' seconds')::interval
            )
          )
          AND recovery_count < $1
        ORDER BY COALESCE(lease_expires_at, last_queue_message_at, heartbeat_at, started_at, created_at) ASC
        LIMIT 25
        FOR UPDATE SKIP LOCKED
      )
      UPDATE jobs j
      SET lease_owner = NULL,
          lease_expires_at = NULL,
          heartbeat_at = NULL,
          recovery_count = recovery_count + 1,
          last_queue_message_at = now(),
          error_msg = NULL
      FROM expired
      WHERE j.id = expired.id
      RETURNING j.id
    `,
    [maxRecoveryCount, String(unleasedGraceSeconds)],
  );

  const failed = await queryRows<JobRow>(
    env,
    `
      WITH expired AS (
        SELECT id
        FROM jobs
        WHERE status = 'running'
          AND (
            (
              lease_expires_at IS NOT NULL
              AND lease_expires_at < now()
            )
            OR (
              lease_expires_at IS NULL
              AND COALESCE(last_queue_message_at, heartbeat_at, started_at, created_at) < now() - ($2 || ' seconds')::interval
            )
          )
          AND recovery_count >= $1
        ORDER BY COALESCE(lease_expires_at, last_queue_message_at, heartbeat_at, started_at, created_at) ASC
        LIMIT 25
        FOR UPDATE SKIP LOCKED
      ),
      updated AS (
        UPDATE jobs j
        SET status = 'failed',
            finished_at = now(),
            lease_owner = NULL,
            lease_expires_at = NULL,
            heartbeat_at = NULL,
            error_msg = 'Job timed out: worker crashed or was evicted.',
            steps = CASE
              WHEN steps IS NOT NULL THEN (
                SELECT jsonb_agg(
                  CASE
                    WHEN s->>'status' = 'running'
                    THEN s || jsonb_build_object('status', 'failed', 'finishedAt', now(), 'error', 'Job timed out: worker crashed or was evicted.')
                    ELSE s
                  END
                ) FROM jsonb_array_elements(steps) s
              )
              ELSE steps
            END
        FROM expired
        WHERE j.id = expired.id
        RETURNING j.*
      )
      SELECT u.*, r.owner, r.repo, r.installation_id
      FROM updated u
      JOIN repositories r ON u.repository_id = r.id
    `,
    [maxRecoveryCount, String(unleasedGraceSeconds)],
  );

  return {
    requeuedJobIds: requeued.map((row) => row.id),
    failedJobs: failed,
  };
}

export async function getTerminalJobsNeedingCheckRunCompletion(
  env: Pick<AppBindings, 'HYPERDRIVE'>,
  limit = 25,
) {
  return queryRows<JobRow>(
    env,
    `
      SELECT j.*, r.owner, r.repo, r.installation_id
      FROM jobs j
      JOIN repositories r ON j.repository_id = r.id
      WHERE j.status IN ('failed', 'superseded')
        AND j.check_run_id IS NOT NULL
        AND j.check_run_completed_at IS NULL
      ORDER BY COALESCE(j.finished_at, j.started_at, j.created_at) ASC
      LIMIT $1
    `,
    [limit],
  );
}

export async function supersedeOlderJobs(
  env: Pick<AppBindings, 'HYPERDRIVE'>,
  input: {
    installationId: string;
    owner: string;
    repo: string;
    prNumber: number;
    newJobId: string;
  },
): Promise<number> {
  const rows = await queryRows<{ id: string }>(
    env,
    `
      UPDATE jobs j
      SET status = 'superseded',
          finished_at = now(),
          lease_owner = NULL,
          lease_expires_at = NULL,
          error_msg = 'Superseded by a newer commit or job.'
      FROM repositories r
      WHERE j.repository_id = r.id
        AND r.installation_id = $1
        AND r.owner = $2
        AND r.repo = $3
        AND j.pr_number = $4
        AND j.id != $5
        AND j.status IN ('queued', 'running')
      RETURNING j.id
    `,
    [input.installationId, input.owner, input.repo, input.prNumber, input.newJobId],
  );

  return rows.length;
}
