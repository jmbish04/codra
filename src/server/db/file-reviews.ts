import type { ParsedReviewComment } from '@shared/schema';
import type { AppBindings } from '@server/env';
import { queryRows } from './client';

export async function insertFileReview(
  env: Pick<AppBindings, 'NEON_DATABASE_URL'>,
  input: {
    jobId: string;
    filePath: string;
    fileStatus: 'pending' | 'done' | 'skipped' | 'failed';
    modelUsed: string;
    diffLineCount: number;
    diffInput: string | null;
    rawAiOutput: string | null;
    parsedComments: ParsedReviewComment[];
    inputTokens: number | null;
    outputTokens: number | null;
    durationMs: number | null;
    verdict: 'approve' | 'comment' | null;
    fileSummary: string | null;
    errorMessage: string | null;
  },
) {
  await queryRows(
    env,
    `
      INSERT INTO file_reviews (
        job_id,
        file_path,
        file_status,
        model_used,
        diff_line_count,
        diff_input,
        raw_ai_output,
        parsed_comments,
        input_tokens,
        output_tokens,
        duration_ms,
        verdict,
        file_summary,
        error_msg
      )
      VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14)
    `,
    [
      input.jobId,
      input.filePath,
      input.fileStatus,
      input.modelUsed,
      input.diffLineCount,
      input.diffInput,
      input.rawAiOutput,
      JSON.stringify(input.parsedComments),
      input.inputTokens,
      input.outputTokens,
      input.durationMs,
      input.verdict,
      input.fileSummary,
      input.errorMessage,
    ],
  );
}

export async function getModelUsageStats(env: Pick<AppBindings, 'NEON_DATABASE_URL'>) {
  return queryRows<{
    model_used: string;
    calls: number;
    input_tokens: number | null;
    output_tokens: number | null;
  }>(
    env,
    `
      SELECT
        model_used,
        COUNT(*)::int AS calls,
        COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
        COALESCE(SUM(output_tokens), 0)::int AS output_tokens
      FROM file_reviews
      GROUP BY model_used
      ORDER BY calls DESC, model_used ASC
    `,
  );
}

export async function getFileReviewsForJob(env: Pick<AppBindings, 'NEON_DATABASE_URL'>, jobId: string) {
  return queryRows<{
    id: string;
    job_id: string;
    file_path: string;
    file_status: 'pending' | 'done' | 'skipped' | 'failed';
    model_used: string;
    diff_line_count: number;
    diff_input: string | null;
    raw_ai_output: string | null;
    parsed_comments: any;
    input_tokens: number | null;
    output_tokens: number | null;
    duration_ms: number | null;
    verdict: 'approve' | 'comment' | null;
    file_summary: string | null;
    error_msg: string | null;
  }>(
    env,
    `
      SELECT *
      FROM file_reviews
      WHERE job_id = $1::uuid
      ORDER BY created_at ASC
    `,
    [jobId],
  );
}
