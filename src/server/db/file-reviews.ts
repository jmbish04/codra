import type { ParsedReviewComment } from '@shared/schema';
import { getDb } from './client';
import { fileReviews, reviewComments } from './schemas';
import { eq, and, sql, inArray, desc } from 'drizzle-orm';

export async function insertFileReview(
  env: Pick<Env, 'DB'>,
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
  const db = getDb(env);

  const [review] = await db.insert(fileReviews).values({
    job_id: input.jobId,
    file_path: input.filePath,
    file_status: input.fileStatus,
    model_used: input.modelUsed,
    model_provider: input.modelProvider ?? null,
    diff_line_count: input.diffLineCount,
    diff_input: input.diffInput,
    raw_ai_output: input.rawAiOutput,
    input_tokens: input.inputTokens,
    output_tokens: input.outputTokens,
    duration_ms: input.durationMs,
    verdict: input.verdict,
    file_summary: input.fileSummary,
    overall_correctness: input.overallCorrectness ?? null,
    confidence_score: input.confidenceScore ?? null,
    error_msg: input.errorMessage,
  }).returning({ id: fileReviews.id });

  if (input.parsedComments.length > 0) {
    const commentsToInsert = input.parsedComments.map(c => ({
      file_review_id: review.id,
      path: c.path,
      line: c.line ?? null,
      position: c.position ?? null,
      severity: c.severity,
      category: c.category,
      title: c.title,
      body: c.body,
      code_suggestion: c.codeSuggestion ?? null,
    }));
    await db.insert(reviewComments).values(commentsToInsert);
  }
}

export async function upsertFileReview(
  env: Pick<Env, 'DB'>,
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
  const db = getDb(env);

  // SQLite doesn't support multiple targets in ON CONFLICT without a unique index or primary key.
  // We didn't add a unique constraint on (job_id, file_path) in Drizzle schema yet.
  // Let's do a SELECT then UPDATE or INSERT manually, which is safer here.
  let reviewRow = await db.select({ id: fileReviews.id }).from(fileReviews)
    .where(and(eq(fileReviews.job_id, jobId), eq(fileReviews.file_path, input.filePath))).get();

  if (reviewRow) {
    await db.update(fileReviews).set({
      file_status: input.fileStatus,
      model_used: input.modelUsed,
      model_provider: input.modelProvider ?? null,
      diff_line_count: input.diffLineCount,
      diff_input: input.diffInput,
      raw_ai_output: input.rawAiOutput,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      duration_ms: input.durationMs,
      verdict: input.verdict,
      file_summary: input.fileSummary,
      overall_correctness: input.overallCorrectness ?? null,
      confidence_score: input.confidenceScore ?? null,
      error_msg: input.errorMessage,
      transient_error_count: 0,
    }).where(eq(fileReviews.id, reviewRow.id));
  } else {
    const [inserted] = await db.insert(fileReviews).values({
      job_id: jobId,
      file_path: input.filePath,
      file_status: input.fileStatus,
      model_used: input.modelUsed,
      model_provider: input.modelProvider ?? null,
      diff_line_count: input.diffLineCount,
      diff_input: input.diffInput,
      raw_ai_output: input.rawAiOutput,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      duration_ms: input.durationMs,
      verdict: input.verdict,
      file_summary: input.fileSummary,
      overall_correctness: input.overallCorrectness ?? null,
      confidence_score: input.confidenceScore ?? null,
      error_msg: input.errorMessage,
    }).returning({ id: fileReviews.id });
    reviewRow = inserted;
  }

  await db.delete(reviewComments).where(eq(reviewComments.file_review_id, reviewRow.id));

  if (input.parsedComments.length > 0) {
    const commentsToInsert = input.parsedComments.map(c => ({
      file_review_id: reviewRow!.id,
      path: c.path,
      line: c.line ?? null,
      position: c.position ?? null,
      severity: c.severity,
      category: c.category,
      title: c.title,
      body: c.body,
      code_suggestion: c.codeSuggestion ?? null,
    }));
    await db.insert(reviewComments).values(commentsToInsert);
  }
}

export async function recordRetryableFileReviewFailure(
  env: Pick<Env, 'DB'>,
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
  const db = getDb(env);

  let reviewRow = await db.select({ id: fileReviews.id, transient_error_count: fileReviews.transient_error_count }).from(fileReviews)
    .where(and(eq(fileReviews.job_id, jobId), eq(fileReviews.file_path, input.filePath))).get();

  let transientCount = 1;

  if (reviewRow) {
    transientCount = reviewRow.transient_error_count + 1;
    await db.update(fileReviews).set({
      file_status: 'failed',
      model_used: input.modelUsed,
      model_provider: input.modelProvider ?? null,
      diff_line_count: input.diffLineCount,
      diff_input: input.diffInput,
      raw_ai_output: null,
      input_tokens: null,
      output_tokens: null,
      duration_ms: input.durationMs,
      verdict: null,
      file_summary: null,
      overall_correctness: null,
      confidence_score: null,
      error_msg: input.errorMessage,
      transient_error_count: transientCount,
    }).where(eq(fileReviews.id, reviewRow.id));
  } else {
    const [inserted] = await db.insert(fileReviews).values({
      job_id: jobId,
      file_path: input.filePath,
      file_status: 'failed',
      model_used: input.modelUsed,
      model_provider: input.modelProvider ?? null,
      diff_line_count: input.diffLineCount,
      diff_input: input.diffInput,
      raw_ai_output: null,
      input_tokens: null,
      output_tokens: null,
      duration_ms: input.durationMs,
      verdict: null,
      file_summary: null,
      overall_correctness: null,
      confidence_score: null,
      error_msg: input.errorMessage,
      transient_error_count: 1,
    }).returning({ id: fileReviews.id });
    reviewRow = { id: inserted.id, transient_error_count: 1 };
  }

  await db.delete(reviewComments).where(eq(reviewComments.file_review_id, reviewRow.id));
  return transientCount;
}

export async function getModelUsageStats(env: Pick<Env, 'DB'>) {
  const db = getDb(env);
  const rows = await db.select({
    model_used: fileReviews.model_used,
    model_provider: sql<string>`MIN(${fileReviews.model_provider})`.as('model_provider'),
    calls: sql<number>`COUNT(*)`.as('calls'),
    input_tokens: sql<number>`COALESCE(SUM(${fileReviews.input_tokens}), 0)`.as('input_tokens'),
    output_tokens: sql<number>`COALESCE(SUM(${fileReviews.output_tokens}), 0)`.as('output_tokens'),
  })
  .from(fileReviews)
  .groupBy(fileReviews.model_used)
  .orderBy(desc(sql`calls`), fileReviews.model_used)
  .all();
  
  return rows;
}

export async function batchInsertFileReviews(
  env: Pick<Env, 'DB'>,
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
  const db = getDb(env);

  const rowsToInsert = reviews.map(r => ({
    job_id: jobId,
    file_path: r.filePath,
    file_status: r.fileStatus,
    model_used: r.modelUsed,
    model_provider: r.modelProvider ?? null,
    diff_line_count: r.diffLineCount,
    diff_input: r.diffInput,
    raw_ai_output: r.rawAiOutput,
    input_tokens: r.inputTokens,
    output_tokens: r.outputTokens,
    duration_ms: r.durationMs,
    verdict: r.verdict,
    file_summary: r.fileSummary,
    overall_correctness: r.overallCorrectness ?? null,
    confidence_score: r.confidenceScore ?? null,
    error_msg: r.errorMessage,
  }));

  const insertedReviews = await db.insert(fileReviews).values(rowsToInsert).returning({ id: fileReviews.id, file_path: fileReviews.file_path });

  const commentsToInsert: Array<typeof reviewComments.$inferInsert> = [];

  for (const review of reviews) {
    const inserted = insertedReviews.find(r => r.file_path === review.filePath);
    if (!inserted || review.parsedComments.length === 0) continue;

    for (const comment of review.parsedComments) {
      commentsToInsert.push({
        file_review_id: inserted.id,
        path: comment.path,
        line: comment.line ?? null,
        position: comment.position ?? null,
        severity: comment.severity,
        category: comment.category,
        title: comment.title,
        body: comment.body,
        code_suggestion: comment.codeSuggestion ?? null,
      });
    }
  }

  if (commentsToInsert.length > 0) {
    await db.insert(reviewComments).values(commentsToInsert);
  }
}

export async function getFileReviewsForJobs(env: Pick<Env, 'DB'>, jobIds: string[]) {
  if (jobIds.length === 0) return [];
  const db = getDb(env);

  const rows = await db.select().from(fileReviews).where(inArray(fileReviews.job_id, jobIds)).orderBy(fileReviews.created_at).all();
  if (rows.length === 0) return [];

  const reviewIds = rows.map(r => r.id!);
  
  // D1 / SQLite limits `inArray` to 1000 parameters. For safety, chunk it if it's too big,
  // but here we just pass it as array since it's probably reasonable size.
  const comments = await db.select().from(reviewComments).where(inArray(reviewComments.file_review_id, reviewIds)).all();

  const commentsByReviewId = new Map<string, any[]>();
  for (const c of comments) {
    if (!commentsByReviewId.has(c.file_review_id)) {
      commentsByReviewId.set(c.file_review_id, []);
    }
    commentsByReviewId.get(c.file_review_id)!.push({
      path: c.path,
      line: c.line,
      position: c.position,
      severity: c.severity,
      category: c.category,
      title: c.title,
      body: c.body,
      codeSuggestion: c.code_suggestion,
    });
  }

  return rows.map(row => ({
    ...row,
    parsed_comments: commentsByReviewId.get(row.id!) || [],
  }));
}
