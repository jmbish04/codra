import type { ParsedReviewComment } from '@shared/schema';
import type { AppBindings } from '@server/env';
import { parseJsonColumn, queryRows, queryTransaction } from './client';

export async function insertFileReview(
  env: Pick<AppBindings, 'HYPERDRIVE'>,
  input: {
    jobId: string;
    filePath: string;
    fileStatus: 'pending' | 'done' | 'skipped' | 'failed';
    modelUsed: string;
    modelProvider?: string | null;
    diffLineCount: number;
    diffInput: string | null;
    rawAiOutput: string | null;
    parsedComments: ParsedReviewComment[];
    inputTokens: number | null;
    outputTokens: number | null;
    durationMs: number | null;
    verdict: 'approve' | 'comment' | null;
    fileSummary: string | null;
    overallCorrectness?: string | null;
    confidenceScore?: number | null;
    errorMessage: string | null;
  },
) {
  await queryTransaction(env, async (tx) => {
    const [review] = await tx.query<{ id: string }>(
      `
        INSERT INTO file_reviews (
          job_id,
          file_path,
          file_status,
          model_used,
          diff_line_count,
          diff_input,
          raw_ai_output,
          input_tokens,
          output_tokens,
          duration_ms,
          verdict,
          file_summary,
          overall_correctness,
          confidence_score,
          error_msg,
          model_provider
        )
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING id
      `,
      [
        input.jobId,
        input.filePath,
        input.fileStatus,
        input.modelUsed,
        input.diffLineCount,
        input.diffInput,
        input.rawAiOutput,
        input.inputTokens,
        input.outputTokens,
        input.durationMs,
        input.verdict,
        input.fileSummary,
        input.overallCorrectness ?? null,
        input.confidenceScore ?? null,
        input.errorMessage,
        input.modelProvider ?? null,
      ],
    );

    if (input.parsedComments.length > 0) {
      const paths = input.parsedComments.map(c => c.path);
      const lines = input.parsedComments.map(c => c.line ?? null);
      const positions = input.parsedComments.map(c => c.position ?? null);
      const severities = input.parsedComments.map(c => c.severity);
      const categories = input.parsedComments.map(c => c.category);
      const titles = input.parsedComments.map(c => c.title);
      const bodies = input.parsedComments.map(c => c.body);
      const codeSuggestions = input.parsedComments.map(c => c.codeSuggestion ?? null);

      await tx.query(
        `
          INSERT INTO review_comments (
            file_review_id, path, line, position, severity, category, title, body, code_suggestion
          )
          SELECT $1::uuid, * FROM UNNEST($2::text[], $3::int[], $4::int[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[])
        `,
        [review.id, paths, lines, positions, severities, categories, titles, bodies, codeSuggestions]
      );
    }
  });
}

export async function upsertFileReview(
  env: Pick<AppBindings, 'HYPERDRIVE'>,
  jobId: string,
  input: {
    filePath: string;
    fileStatus: 'pending' | 'done' | 'skipped' | 'failed';
    modelUsed: string;
    modelProvider?: string | null;
    diffLineCount: number;
    diffInput: string | null;
    rawAiOutput: string | null;
    parsedComments: ParsedReviewComment[];
    inputTokens: number | null;
    outputTokens: number | null;
    durationMs: number | null;
    verdict: 'approve' | 'comment' | null;
    fileSummary: string | null;
    overallCorrectness?: string | null;
    confidenceScore?: number | null;
    errorMessage: string | null;
  },
) {
  await queryTransaction(env, async (tx) => {
    const [review] = await tx.query<{ id: string }>(
      `
        INSERT INTO file_reviews (
          job_id,
          file_path,
          file_status,
          model_used,
          diff_line_count,
          diff_input,
          raw_ai_output,
          input_tokens,
          output_tokens,
          duration_ms,
          verdict,
          file_summary,
          overall_correctness,
          confidence_score,
          error_msg,
          model_provider
        )
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (job_id, file_path) DO UPDATE SET
          file_status = EXCLUDED.file_status,
          model_used = EXCLUDED.model_used,
          diff_line_count = EXCLUDED.diff_line_count,
          diff_input = EXCLUDED.diff_input,
          raw_ai_output = EXCLUDED.raw_ai_output,
          input_tokens = EXCLUDED.input_tokens,
          output_tokens = EXCLUDED.output_tokens,
          duration_ms = EXCLUDED.duration_ms,
          verdict = EXCLUDED.verdict,
          file_summary = EXCLUDED.file_summary,
          overall_correctness = EXCLUDED.overall_correctness,
          confidence_score = EXCLUDED.confidence_score,
          error_msg = EXCLUDED.error_msg,
          model_provider = EXCLUDED.model_provider,
          transient_error_count = 0
        RETURNING id
      `,
      [
        jobId,
        input.filePath,
        input.fileStatus,
        input.modelUsed,
        input.diffLineCount,
        input.diffInput,
        input.rawAiOutput,
        input.inputTokens,
        input.outputTokens,
        input.durationMs,
        input.verdict,
        input.fileSummary,
        input.overallCorrectness ?? null,
        input.confidenceScore ?? null,
        input.errorMessage,
        input.modelProvider ?? null,
      ],
    );

    await tx.query('DELETE FROM review_comments WHERE file_review_id = $1::uuid', [review.id]);

    if (input.parsedComments.length > 0) {
      await tx.query(
        `
          INSERT INTO review_comments (
            file_review_id, path, line, position, severity, category, title, body, code_suggestion
          )
          SELECT $1::uuid, * FROM UNNEST($2::text[], $3::int[], $4::int[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[])
        `,
        [
          review.id,
          input.parsedComments.map(c => c.path),
          input.parsedComments.map(c => c.line ?? null),
          input.parsedComments.map(c => c.position ?? null),
          input.parsedComments.map(c => c.severity),
          input.parsedComments.map(c => c.category),
          input.parsedComments.map(c => c.title),
          input.parsedComments.map(c => c.body),
          input.parsedComments.map(c => c.codeSuggestion ?? null),
        ],
      );
    }
  });
}

export async function recordRetryableFileReviewFailure(
  env: Pick<AppBindings, 'HYPERDRIVE'>,
  jobId: string,
  input: {
    filePath: string;
    modelUsed: string;
    modelProvider?: string | null;
    diffLineCount: number;
    diffInput: string | null;
    durationMs: number | null;
    errorMessage: string;
  },
) {
  return await queryTransaction(env, async (tx) => {
    const [review] = await tx.query<{ id: string; transient_error_count: number }>(
      `
        INSERT INTO file_reviews (
          job_id,
          file_path,
          file_status,
          model_used,
          model_provider,
          diff_line_count,
          diff_input,
          raw_ai_output,
          input_tokens,
          output_tokens,
          duration_ms,
          verdict,
          file_summary,
          overall_correctness,
          confidence_score,
          error_msg,
          transient_error_count
        )
        VALUES ($1::uuid, $2, 'failed', $3, $4, $5, $6, NULL, NULL, NULL, $7, NULL, NULL, NULL, NULL, $8, 1)
        ON CONFLICT (job_id, file_path) DO UPDATE SET
          file_status = 'failed',
          model_used = EXCLUDED.model_used,
          model_provider = EXCLUDED.model_provider,
          diff_line_count = EXCLUDED.diff_line_count,
          diff_input = EXCLUDED.diff_input,
          raw_ai_output = NULL,
          input_tokens = NULL,
          output_tokens = NULL,
          duration_ms = EXCLUDED.duration_ms,
          verdict = NULL,
          file_summary = NULL,
          overall_correctness = NULL,
          confidence_score = NULL,
          error_msg = EXCLUDED.error_msg,
          transient_error_count = file_reviews.transient_error_count + 1
        RETURNING id, transient_error_count
      `,
      [
        jobId,
        input.filePath,
        input.modelUsed,
        input.modelProvider ?? null,
        input.diffLineCount,
        input.diffInput,
        input.durationMs,
        input.errorMessage,
      ],
    );

    await tx.query('DELETE FROM review_comments WHERE file_review_id = $1::uuid', [review.id]);
    return review.transient_error_count;
  });
}

export async function getModelUsageStats(env: Pick<AppBindings, 'HYPERDRIVE'>) {
  return queryRows<{
    model_used: string;
    model_provider: string | null;
    calls: number;
    input_tokens: number | null;
    output_tokens: number | null;
  }>(
    env,
    `
      SELECT
        model_used,
        MIN(model_provider) AS model_provider,
        COUNT(*)::int AS calls,
        COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
        COALESCE(SUM(output_tokens), 0)::int AS output_tokens
      FROM file_reviews
      GROUP BY model_used
      ORDER BY calls DESC, model_used ASC
    `,
  );
}

export async function batchInsertFileReviews(
  env: Pick<AppBindings, 'HYPERDRIVE'>,
  jobId: string,
  reviews: Array<{
    filePath: string;
    fileStatus: 'pending' | 'done' | 'skipped' | 'failed';
    modelUsed: string;
    modelProvider?: string | null;
    diffLineCount: number;
    diffInput: string | null;
    rawAiOutput: string | null;
    parsedComments: ParsedReviewComment[];
    inputTokens: number | null;
    outputTokens: number | null;
    durationMs: number | null;
    verdict: 'approve' | 'comment' | null;
    fileSummary: string | null;
    overallCorrectness?: string | null;
    confidenceScore?: number | null;
    errorMessage: string | null;
  }>,
) {
  if (reviews.length === 0) return;

  // 1. Insert file reviews and get their IDs
  // Since we want to handle comments too, we'll do this in a single query with UNNEST and RETURNING
  const filePaths = reviews.map(r => r.filePath);
  const fileStatuses = reviews.map(r => r.fileStatus);
  const modelsUsed = reviews.map(r => r.modelUsed);
  const diffLineCounts = reviews.map(r => r.diffLineCount);
  const diffInputs = reviews.map(r => r.diffInput);
  const rawAiOutputs = reviews.map(r => r.rawAiOutput);
  const inputTokens = reviews.map(r => r.inputTokens);
  const outputTokens = reviews.map(r => r.outputTokens);
  const durationMs = reviews.map(r => r.durationMs);
  const verdicts = reviews.map(r => r.verdict);
  const fileSummaries = reviews.map(r => r.fileSummary);
  const overallCorrectness = reviews.map(r => r.overallCorrectness ?? null);
  const confidenceScores = reviews.map(r => r.confidenceScore ?? null);
  const errorMessages = reviews.map(r => r.errorMessage);
  const modelProviders = reviews.map(r => r.modelProvider ?? null);

  await queryTransaction(env, async (tx) => {
    const insertedRows = await tx.query<{ id: string; file_path: string }>(
      `
        INSERT INTO file_reviews (
          job_id, file_path, file_status, model_used, diff_line_count, diff_input,
          raw_ai_output, input_tokens, output_tokens, duration_ms, verdict,
          file_summary, overall_correctness, confidence_score, error_msg, model_provider
        )
        SELECT $1::uuid, * FROM UNNEST(
          $2::text[], $3::text[], $4::text[], $5::int[], $6::text[],
          $7::text[], $8::int[], $9::int[], $10::int[], $11::text[],
          $12::text[], $13::text[], $14::real[], $15::text[], $16::text[]
        )
        RETURNING id, file_path
      `,
      [
        jobId, filePaths, fileStatuses, modelsUsed, diffLineCounts, diffInputs,
        rawAiOutputs, inputTokens, outputTokens, durationMs, verdicts,
        fileSummaries, overallCorrectness, confidenceScores, errorMessages, modelProviders
      ]
    );

    const allComments: Array<{
      fileReviewId: string;
      path: string;
      line: number | null;
      position: number | null;
      severity: string;
      category: string;
      title: string;
      body: string;
      codeSuggestion: string | null;
    }> = [];

    for (const review of reviews) {
      const inserted = insertedRows.find(r => r.file_path === review.filePath);
      if (!inserted || review.parsedComments.length === 0) continue;

      for (const comment of review.parsedComments) {
        allComments.push({
          fileReviewId: inserted.id,
          path: comment.path,
          line: comment.line ?? null,
          position: comment.position ?? null,
          severity: comment.severity,
          category: comment.category,
          title: comment.title,
          body: comment.body,
          codeSuggestion: comment.codeSuggestion ?? null,
        });
      }
    }

    if (allComments.length > 0) {
      await tx.query(
        `
          INSERT INTO review_comments (
            file_review_id, path, line, position, severity, category, title, body, code_suggestion
          )
          SELECT * FROM UNNEST(
            $1::uuid[], $2::text[], $3::int[], $4::int[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[]
          )
        `,
        [
          allComments.map(c => c.fileReviewId),
          allComments.map(c => c.path),
          allComments.map(c => c.line),
          allComments.map(c => c.position),
          allComments.map(c => c.severity),
          allComments.map(c => c.category),
          allComments.map(c => c.title),
          allComments.map(c => c.body),
          allComments.map(c => c.codeSuggestion),
        ]
      );
    }
  });
}



export async function getFileReviewsForJobs(env: Pick<AppBindings, 'HYPERDRIVE'>, jobIds: string[]) {
  if (jobIds.length === 0) return [];

  const rows = await queryRows<{
    id: string;
    job_id: string;
    file_path: string;
    file_status: 'pending' | 'done' | 'skipped' | 'failed';
    model_used: string;
    diff_line_count: number;
    diff_input: string | null;
    raw_ai_output: string | null;
    parsed_comments: ParsedReviewComment[] | string;
    input_tokens: number | null;
    output_tokens: number | null;
    duration_ms: number | null;
    verdict: 'approve' | 'comment' | null;
    file_summary: string | null;
    overall_correctness: string | null;
    confidence_score: number | null;
    error_msg: string | null;
    model_provider: string | null;
    transient_error_count: number;
  }>(
    env,
    `
      SELECT
        fr.*,
        COALESCE(
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
        ) AS parsed_comments
      FROM file_reviews fr
      WHERE fr.job_id = ANY($1::uuid[])
      ORDER BY fr.created_at ASC
    `,
    [jobIds],
  );

  return rows.map((row) => ({
    ...row,
    parsed_comments: parseJsonColumn(row.parsed_comments, []),
  }));
}
