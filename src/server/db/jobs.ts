import { getDb, parseJsonColumn } from './client';
import { defaultRepoConfig, jobDetailSchema, jobSummarySchema, repoConfigSchema, type RepoConfig } from '@shared/schema';
import { getOrCreateRepository } from './repositories';
import { jobs, repositories, fileReviews, reviewComments, fileReviewCosts } from './schemas';
import type { CloudflareDocResult } from '@server/services/cloudflare-docs';
import { eq, and, sql, or, lt, gt, like, desc, asc, inArray, notInArray, isNull, isNotNull, ne } from 'drizzle-orm';

export type JobRow = typeof jobs.$inferSelect;
type JobStep = {
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  error?: string | null;
};

export type JobLeaseClaim =
  | { status: 'claimed'; row: any }
  | { status: 'busy'; row: any; retryAfterSeconds: number }
  | { status: 'terminal'; row: any }
  | { status: 'missing' };

export type BestPracticeDocsPayload = {
  violated: string[];
  checks: Array<{ practice: string; passed: number; violated: number }>;
  docs: CloudflareDocResult[];
};

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(value: any) {
  if (typeof value === 'string') {
    return value.startsWith('\\x') ? value.slice(2).toLowerCase() : value.toLowerCase();
  }
  const bytes = ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function latestTimestamp(...values: Array<string | null | undefined>) {
  const now = Date.now();
  return values.reduce<string | null>((latest, value) => {
    if (!value) return latest;
    if (new Date(value).getTime() > now) return latest;
    if (!latest) return value;
    return new Date(value).getTime() > new Date(latest).getTime() ? value : latest;
  }, null);
}

export function mapJob(row: any) {
  const lastQueueMessageAt = row.last_queue_message_at ? new Date(row.last_queue_message_at).getTime() : null;
  const nextRetryAt =
    row.status === 'running' &&
    row.lease_owner === null &&
    lastQueueMessageAt !== null &&
    Number.isFinite(lastQueueMessageAt) &&
    lastQueueMessageAt > Date.now()
      ? row.last_queue_message_at
      : null;
  const updatedAt = latestTimestamp(
    row.created_at,
    row.started_at,
    row.finished_at,
    row.heartbeat_at,
    row.last_queue_message_at,
  ) ?? row.created_at;

  return {
    ...jobSummarySchema.parse({
      id: row.id,
      owner: row.owner,
      repo: row.repo,
      installationId: String(row.installation_id),
      prNumber: row.pr_number,
      prTitle: row.pr_title,
      prAuthor: row.pr_author,
      prCreatedAt: row.pr_created_at ?? null,
      commitSha: bytesToHex(row.commit_sha),
      trigger: row.trigger,
      status: row.status,
      verdict: row.verdict,
      fileCount: row.file_count ?? 0,
      commentCount: row.comment_count ?? 0,
      totalInputTokens: row.total_input_tokens ?? 0,
      totalOutputTokens: row.total_output_tokens ?? 0,
      costUsd: row.total_cost_usd ?? null,
      createdAt: row.created_at,
      updatedAt,
      nextRetryAt,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      errorMessage: row.error_msg,
      overallConfidenceScore: row.overall_confidence_score,
      steps: parseJsonColumn(row.steps, []),
      checkRunId: row.check_run_id,
      configSnapshot: row.config_snapshot ? repoConfigSchema.parse(parseJsonColumn(row.config_snapshot, defaultRepoConfig)) : null,
      retryOfJobId: row.retry_of_job_id,
    }),
    statusCommentId: (row.status_comment_id as number | null) ?? null,
    batchRequestId: (row.batch_request_id as string | null) ?? null,
    batchModel: (row.batch_model as string | null) ?? null,
    batchFilePaths: parseJsonColumn(row.batch_file_paths, []) as string[],
  };
}

function mergeRow(res: { jobs: typeof jobs.$inferSelect; repositories: typeof repositories.$inferSelect }) {
  return {
    ...res.jobs,
    owner: res.repositories.owner,
    repo: res.repositories.repo,
    installation_id: res.repositories.installation_id,
  };
}

export async function insertJob(
  env: Pick<Env, 'DB'>,
  input: {
    installationId: string;
    owner: string;
    repo: string;
    prNumber: number;
    prTitle: string | null;
    prAuthor: string | null;
    prCreatedAt?: string | null;
    commitSha: string;
    baseSha: string;
    trigger: 'auto' | 'mention' | 'retry' | 'sync';
    headRef: string | null;
    baseRef: string | null;
    configSnapshot?: RepoConfig | null;
    retryOfJobId?: string | null;
  },
) {
  const db = getDb(env);
  const repositoryId = await getOrCreateRepository(env, {
    installationId: input.installationId,
    owner: input.owner,
    repo: input.repo,
  });

  const [row] = await db.insert(jobs).values({
    repository_id: repositoryId,
    pr_number: input.prNumber,
    pr_title: input.prTitle,
    pr_author: input.prAuthor,
    pr_created_at: input.prCreatedAt ?? null,
    commit_sha: Array.from(hexToBytes(input.commitSha)),
    base_sha: Array.from(hexToBytes(input.baseSha)),
    trigger: input.trigger,
    status: 'queued',
    config_snapshot: input.configSnapshot ?? defaultRepoConfig,
    head_ref: input.headRef,
    base_ref: input.baseRef,
    retry_of_job_id: input.retryOfJobId ?? null,
  }).returning();

  return mapJob({ ...row, owner: input.owner, repo: input.repo, installation_id: input.installationId });
}

export async function listJobs(
  env: Pick<Env, 'DB'>,
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
  const db = getDb(env);
  const conditions = [];

  if (query.owner) conditions.push(eq(repositories.owner, query.owner));
  if (query.repo) conditions.push(eq(repositories.repo, query.repo));
  if (query.status) conditions.push(eq(jobs.status, query.status));
  if (query.verdict) conditions.push(eq(jobs.verdict, query.verdict));
  if (query.search) {
    const s = `%${query.search}%`;
    conditions.push(or(
      like(sql`lower(${jobs.pr_title})`, s.toLowerCase()),
      like(sql`CAST(${jobs.pr_number} AS TEXT)`, s)
    ));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.select()
    .from(jobs)
    .innerJoin(repositories, eq(jobs.repository_id, repositories.id))
    .where(whereClause)
    .orderBy(desc(jobs.created_at))
    .limit(query.limit)
    .offset(query.offset)
    .all();

  const [{ count: total }] = await db.select({ count: sql<number>`count(*)` })
    .from(jobs)
    .innerJoin(repositories, eq(jobs.repository_id, repositories.id))
    .where(whereClause)
    .all();

  return {
    jobs: rows.map(r => mapJob(mergeRow(r))),
    total,
  };
}

export async function getJobForProcessing(env: Pick<Env, 'DB'>, jobId: string) {
  if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
    return null;
  }
  const db = getDb(env);
  const row = await db.select()
    .from(jobs)
    .innerJoin(repositories, eq(jobs.repository_id, repositories.id))
    .where(eq(jobs.id, jobId))
    .get();

  return row ? mergeRow(row) : null;
}

/**
 * The review suggestions for a job, as a machine-readable object a review agent
 * can consume. Returns null for an unknown/invalid job id.
 */
export async function getReviewSuggestions(env: Pick<Env, 'DB'>, jobId: string) {
  if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
    return null;
  }
  const db = getDb(env);
  const jobRow = await db.select({
    id: jobs.id,
    owner: repositories.owner,
    repo: repositories.repo,
    prNumber: jobs.pr_number,
    commitSha: jobs.commit_sha,
    verdict: jobs.verdict,
    status: jobs.status,
    finishedAt: jobs.finished_at,
    best_practice_docs: jobs.best_practice_docs,
  })
    .from(jobs)
    .innerJoin(repositories, eq(jobs.repository_id, repositories.id))
    .where(eq(jobs.id, jobId))
    .get();
  if (!jobRow) return null;

  const rows = await db.select({
    fileReviewId: reviewComments.file_review_id,
    path: reviewComments.path,
    line: reviewComments.line,
    severity: reviewComments.severity,
    category: reviewComments.category,
    title: reviewComments.title,
    body: reviewComments.body,
    codeSuggestion: reviewComments.code_suggestion,
  })
    .from(reviewComments)
    .innerJoin(fileReviews, eq(reviewComments.file_review_id, fileReviews.id))
    .where(eq(fileReviews.job_id, jobId))
    .orderBy(asc(reviewComments.id))
    .all();

  // Every reviewed file, so a consumer sees per-file summaries + which files
  // carry comments (an approved file has zero, and that's meaningful signal).
  const fileRows = await db.select({
    id: fileReviews.id,
    path: fileReviews.file_path,
    status: fileReviews.file_status,
    verdict: fileReviews.verdict,
    summary: fileReviews.file_summary,
    costUsd: fileReviews.total_cost_usd,
    bestPracticeChecks: fileReviews.best_practice_checks,
  })
    .from(fileReviews)
    .where(eq(fileReviews.job_id, jobId))
    .orderBy(asc(fileReviews.created_at))
    .all();

  const commentsByFileReview = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = commentsByFileReview.get(row.fileReviewId) ?? [];
    list.push(row);
    commentsByFileReview.set(row.fileReviewId, list);
  }

  const files = fileRows.map((fr) => {
    const comments = (commentsByFileReview.get(fr.id) ?? []).map(({ fileReviewId, ...comment }) => comment);
    return {
      path: fr.path,
      status: fr.status,
      verdict: fr.verdict,
      summary: fr.summary,
      costUsd: fr.costUsd,
      bestPracticeChecks: parseJsonColumn<Array<{ practice: string; status: 'pass' | 'violation'; note?: string }>>(fr.bestPracticeChecks, []),
      commentCount: comments.length,
      comments,
    };
  });

  // Flat list kept for backward compatibility with existing consumers.
  const suggestions = rows.map(({ fileReviewId, ...comment }) => comment);

  return {
    jobId: jobRow.id,
    repo: `${jobRow.owner}/${jobRow.repo}`,
    prNumber: jobRow.prNumber,
    commitSha: bytesToHex(jobRow.commitSha),
    verdict: jobRow.verdict,
    status: jobRow.status,
    finishedAt: jobRow.finishedAt,
    suggestionCount: suggestions.length,
    fileCount: files.length,
    filesWithComments: files.filter((f) => f.commentCount > 0).length,
    bestPractices: parseJsonColumn<{ violated: string[]; checks: Array<{ practice: string; passed: number; violated: number }>; docs: Array<{ query: string; source: 'cloudflare-docs'; content: string }> } | null>(jobRow.best_practice_docs, null as any),
    files,
    suggestions,
  };
}

export async function getJobDetail(env: Pick<Env, 'DB'>, jobId: string) {
  if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
    return null;
  }
  const db = getDb(env);
  
  const jobResult = await db.select()
    .from(jobs)
    .innerJoin(repositories, eq(jobs.repository_id, repositories.id))
    .where(eq(jobs.id, jobId))
    .get();

  if (!jobResult) return null;
  const jobRow = mergeRow(jobResult);

  const reviews = await db.select().from(fileReviews).where(eq(fileReviews.job_id, jobId)).orderBy(asc(fileReviews.created_at)).all();
  
  let files: any[] = [];
  if (reviews.length > 0) {
    const reviewIds = reviews.map(r => r.id!);
    const comments = await db.select().from(reviewComments).where(inArray(reviewComments.file_review_id, reviewIds)).orderBy(asc(reviewComments.id)).all();
    const commentsByReviewId = new Map<string, any[]>();
    for (const c of comments) {
      if (!commentsByReviewId.has(c.file_review_id)) commentsByReviewId.set(c.file_review_id, []);
      commentsByReviewId.get(c.file_review_id)!.push({
        path: c.path,
        line: c.line,
        position: c.position,
        severity: c.severity,
        category: c.category,
        title: c.title,
        body: c.body,
        codeSuggestion: c.code_suggestion
      });
    }

    const costRows = await db.select().from(fileReviewCosts).where(inArray(fileReviewCosts.file_review_id, reviewIds)).all();
    const costsByReviewId = new Map<string, any[]>();
    for (const cost of costRows) {
      if (!costsByReviewId.has(cost.file_review_id)) costsByReviewId.set(cost.file_review_id, []);
      costsByReviewId.get(cost.file_review_id)!.push({
        usageType: cost.usage_type,
        usageAmount: cost.usage_amount,
        unitPrice: cost.unit_price,
        perUnits: cost.per_units,
        currency: cost.currency,
        totalCost: cost.total_cost,
        rateSource: cost.rate_source,
      });
    }

    files = reviews.map(fr => ({
      id: fr.id,
      jobId: fr.job_id,
      filePath: fr.file_path,
      fileStatus: fr.file_status,
      modelUsed: fr.model_used,
      diffLineCount: fr.diff_line_count,
      diffInput: fr.diff_input,
      rawAiOutput: fr.raw_ai_output,
      inputTokens: fr.input_tokens,
      outputTokens: fr.output_tokens,
      durationMs: fr.duration_ms,
      verdict: fr.verdict,
      fileSummary: fr.file_summary,
      errorMessage: fr.error_msg,
      createdAt: fr.created_at,
      costUsd: fr.total_cost_usd ?? null,
      costBreakdown: costsByReviewId.get(fr.id!) || [],
      parsedComments: commentsByReviewId.get(fr.id!) || []
    }));
  }

  return jobDetailSchema.parse({
    ...mapJob(jobRow),
    baseSha: bytesToHex(jobRow.base_sha),
    headRef: jobRow.head_ref,
    baseRef: jobRow.base_ref,
    summaryMarkdown: jobRow.summary_markdown,
    configSnapshot: repoConfigSchema.parse(parseJsonColumn(jobRow.config_snapshot, defaultRepoConfig)),
    reviewId: jobRow.review_id,
    retryOfJobId: jobRow.retry_of_job_id,
    summaryModel: jobRow.summary_model,
    files,
  });
}

export async function startJobProcessing(env: Pick<Env, 'DB'>, jobId: string, stepName: string) {
  const db = getDb(env);
  const now = new Date().toISOString();
  
  const jobRow = await db.select({ started_at: jobs.started_at, steps: jobs.steps }).from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.status, 'queued'))).get();
  if (!jobRow) return false;
  
  const steps = parseJsonColumn(jobRow.steps, []) as any[];
  steps.push({
    name: stepName,
    status: 'running',
    startedAt: now,
    finishedAt: null,
    error: null,
  });
  
  const [updated] = await db.update(jobs)
    .set({
      status: 'running',
      started_at: (jobRow.started_at as any) ?? now,
      steps,
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'queued')))
    .returning({ id: jobs.id });
    
  return !!updated;
}

export async function claimJobLease(
  env: Pick<Env, 'DB'>,
  jobId: string,
  leaseOwner: string,
  leaseSeconds: number,
): Promise<JobLeaseClaim> {
  const db = getDb(env);
  const now = new Date().toISOString();
  
  const updatedRows = await db.update(jobs)
    .set({
      status: 'running',
      started_at: sql`COALESCE(${jobs.started_at}, ${now})`,
      lease_owner: leaseOwner,
      lease_expires_at: sql`datetime('now', '+' || ${leaseSeconds} || ' seconds')`,
      heartbeat_at: now,
      last_queue_message_at: now,
    })
    .where(and(
      eq(jobs.id, jobId),
      inArray(jobs.status, ['queued', 'running']),
      or(
        isNull(jobs.lease_expires_at),
        lt(jobs.lease_expires_at, now),
        eq(jobs.lease_owner, leaseOwner)
      ),
      sql`NOT (${jobs.status} = 'running' AND ${jobs.lease_owner} IS NULL AND ${jobs.last_queue_message_at} IS NOT NULL AND ${jobs.last_queue_message_at} > ${now})`
    ))
    .returning();

  if (updatedRows.length > 0) {
    const row = await getJobForProcessing(env, jobId);
    return { status: 'claimed', row };
  }

  const row = await getJobForProcessing(env, jobId);
  if (!row) {
    return { status: 'missing' };
  }

  if (!['queued', 'running'].includes(row.status)) {
    return { status: 'terminal', row };
  }

  const leaseExpiresAt = row.lease_expires_at ? new Date(row.lease_expires_at).getTime() : 0;
  const delayedUntil = row.lease_owner === null && row.last_queue_message_at ? new Date(row.last_queue_message_at).getTime() : 0;
  const retryAt = Math.max(leaseExpiresAt, delayedUntil);
  const secondsUntilExpiry = Math.ceil((retryAt - Date.now()) / 1000);
  return {
    status: 'busy',
    row,
    retryAfterSeconds: Math.max(15, Math.min(60, Number.isFinite(secondsUntilExpiry) ? secondsUntilExpiry : 60)),
  };
}

export async function heartbeatJobLease(
  env: Pick<Env, 'DB'>,
  jobId: string,
  leaseOwner: string,
  leaseSeconds: number,
) {
  const db = getDb(env);
  const now = new Date().toISOString();
  await db.update(jobs)
    .set({
      heartbeat_at: now,
      lease_expires_at: sql`datetime('now', '+' || ${leaseSeconds} || ' seconds')`,
    })
    .where(and(
      eq(jobs.id, jobId),
      eq(jobs.lease_owner, leaseOwner),
      eq(jobs.status, 'running')
    ));
}

export async function releaseJobLease(env: Pick<Env, 'DB'>, jobId: string, leaseOwner: string) {
  const db = getDb(env);
  await db.update(jobs)
    .set({
      lease_owner: null,
      lease_expires_at: null,
    })
    .where(and(
      eq(jobs.id, jobId),
      eq(jobs.lease_owner, leaseOwner)
    ));
}

export async function recordJobBatch(
  env: Pick<Env, 'DB'>,
  jobId: string,
  input: { requestId: string; model: string; filePaths: string[] },
) {
  const db = getDb(env);
  await db.update(jobs).set({
    batch_request_id: input.requestId,
    batch_model: input.model,
    batch_file_paths: input.filePaths,
    batch_submitted_at: new Date().toISOString(),
  }).where(eq(jobs.id, jobId));
}

export async function clearJobBatch(env: Pick<Env, 'DB'>, jobId: string) {
  const db = getDb(env);
  await db.update(jobs).set({
    batch_request_id: null,
    batch_model: null,
    batch_file_paths: null,
    batch_submitted_at: null,
  }).where(eq(jobs.id, jobId));
}

export async function recordBestPracticeDocs(
  env: Pick<Env, 'DB'>,
  jobId: string,
  payload: BestPracticeDocsPayload,
) {
  const db = getDb(env);
  await db.update(jobs).set({ best_practice_docs: JSON.stringify(payload) }).where(eq(jobs.id, jobId));
}

export async function markJobContinuationQueued(env: Pick<Env, 'DB'>, jobId: string, delaySeconds = 0) {
  const db = getDb(env);
  const now = new Date().toISOString();
  await db.update(jobs)
    .set({
      heartbeat_at: now,
      last_queue_message_at: delaySeconds > 0 ? sql`datetime('now', '+' || ${delaySeconds} || ' seconds')` : now,
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')));
}

export async function updateJobCheckRun(env: Pick<Env, 'DB'>, jobId: string, checkRunId: number) {
  const db = getDb(env);
  await db.update(jobs).set({ check_run_id: checkRunId }).where(eq(jobs.id, jobId));
}

export async function updateJobStatusComment(env: Pick<Env, 'DB'>, jobId: string, statusCommentId: number) {
  const db = getDb(env);
  await db.update(jobs).set({ status_comment_id: statusCommentId }).where(eq(jobs.id, jobId));
}

export async function completeJob(
  env: Pick<Env, 'DB'>,
  jobId: string,
  input: {
    verdict: 'approve' | 'comment';
    fileCount: number;
    commentCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd?: number | null;
    summaryMarkdown: string;
    reviewId: number | null;
    summaryModel: string | null;
    overallConfidenceScore?: number | null;
    errorMessage?: string | null;
  },
) {
  const db = getDb(env);
  const now = new Date().toISOString();
  
  const jobRow = await db.select({ steps: jobs.steps }).from(jobs).where(eq(jobs.id, jobId)).get();
  const steps = parseJsonColumn(jobRow?.steps, []) as any[];
  
  const existingStep = steps.find((s: any) => s.name === 'Completing');
  if (existingStep) {
    existingStep.status = 'done';
    existingStep.finishedAt = now;
  } else {
    steps.push({
      name: 'Completing',
      status: 'done',
      startedAt: now,
      finishedAt: now,
      error: null,
    });
  }

  await db.update(jobs).set({
    status: 'done',
    finished_at: now,
    check_run_completed_at: now,
    lease_owner: null,
    lease_expires_at: null,
    verdict: input.verdict,
    file_count: input.fileCount,
    comment_count: input.commentCount,
    total_input_tokens: input.totalInputTokens,
    total_output_tokens: input.totalOutputTokens,
    total_cost_usd: input.totalCostUsd ?? null,
    summary_markdown: input.summaryMarkdown,
    review_id: input.reviewId,
    summary_model: input.summaryModel,
    overall_confidence_score: input.overallConfidenceScore ?? null,
    error_msg: input.errorMessage ?? null,
    steps,
    // Never clobber a merged/closed PR's status — that state wins.
  }).where(and(eq(jobs.id, jobId), notInArray(jobs.status, ['merged', 'closed'])));
}

export async function failJob(env: Pick<Env, 'DB'>, jobId: string, errorMessage: string) {
  const db = getDb(env);
  const now = new Date().toISOString();

  const jobRow = await db.select({ steps: jobs.steps }).from(jobs).where(eq(jobs.id, jobId)).get();
  const steps = parseJsonColumn(jobRow?.steps, []) as any[];

  for (const step of steps) {
    if (step.status === 'running') {
      step.status = 'failed';
      step.finishedAt = now;
      step.error = errorMessage;
    }
  }

  await db.update(jobs).set({
    status: 'failed',
    finished_at: now,
    lease_owner: null,
    lease_expires_at: null,
    error_msg: errorMessage,
    steps,
  }).where(and(eq(jobs.id, jobId), notInArray(jobs.status, ['merged', 'closed'])));
}

export async function markJobCheckRunCompleted(env: Pick<Env, 'DB'>, jobId: string) {
  const db = getDb(env);
  await db.update(jobs).set({ check_run_completed_at: new Date().toISOString() }).where(eq(jobs.id, jobId));
}

export async function updateJobFileCount(env: Pick<Env, 'DB'>, jobId: string, fileCount: number) {
  const db = getDb(env);
  await db.update(jobs).set({ file_count: fileCount }).where(eq(jobs.id, jobId));
}

export async function completePreparationStep(env: Pick<Env, 'DB'>, jobId: string, fileCount: number) {
  const db = getDb(env);
  const now = new Date().toISOString();

  const jobRow = await db.select({ steps: jobs.steps }).from(jobs).where(eq(jobs.id, jobId)).get();
  const steps = parseJsonColumn(jobRow?.steps, []) as any[];

  const prepStep = steps.find((s: any) => s.name === 'Preparation');
  if (prepStep) {
    prepStep.status = 'done';
    prepStep.finishedAt = now;
  }

  await db.update(jobs).set({
    file_count: fileCount,
    steps,
  }).where(eq(jobs.id, jobId));
}

/**
 * Highest PR number codra already has a job for in this repo — the sync
 * watermark. Returns null if codra has never reviewed this repo. Ignores
 * sync-triggered jobs so a prior sync run can't inflate the watermark.
 */
export async function getMaxSeenPrNumber(
  env: Pick<Env, 'DB'>,
  input: { owner: string; repo: string },
): Promise<number | null> {
  const db = getDb(env);
  const row = await db.select({ maxPr: sql<number | null>`max(${jobs.pr_number})` })
    .from(jobs)
    .innerJoin(repositories, eq(jobs.repository_id, repositories.id))
    .where(and(
      eq(repositories.owner, input.owner),
      eq(repositories.repo, input.repo),
      ne(jobs.trigger, 'sync'),
    ))
    .get();
  return row?.maxPr ?? null;
}

/**
 * Trigger-agnostic head check: is there ANY job for this PR at this exact head
 * commit, regardless of how it was triggered? Used by the open-PR sync so it
 * does not re-enqueue a PR head that a webhook already produced a job for.
 */
export async function findAnyJobForHead(
  env: Pick<Env, 'DB'>,
  input: { owner: string; repo: string; prNumber: number; commitSha: string },
) {
  const db = getDb(env);
  const res = await db.select({ id: jobs.id })
    .from(jobs)
    .innerJoin(repositories, eq(jobs.repository_id, repositories.id))
    .where(and(
      eq(repositories.owner, input.owner),
      eq(repositories.repo, input.repo),
      eq(jobs.pr_number, input.prNumber),
      eq(jobs.commit_sha, Array.from(hexToBytes(input.commitSha))),
    ))
    .orderBy(desc(jobs.created_at))
    .limit(1)
    .get();
  return res ?? null;
}

/** Active (queued or running) jobs for a PR — the ones a PR close should cancel. */
export async function findActiveJobsForPr(
  env: Pick<Env, 'DB'>,
  input: { owner: string; repo: string; prNumber: number },
) {
  const db = getDb(env);
  const rows = await db.select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .innerJoin(repositories, eq(jobs.repository_id, repositories.id))
    .where(and(
      eq(repositories.owner, input.owner),
      eq(repositories.repo, input.repo),
      eq(jobs.pr_number, input.prNumber),
      inArray(jobs.status, ['queued', 'running']),
    ))
    .orderBy(desc(jobs.created_at))
    .all();
  return rows;
}

/** Cancel a job (terminal 'superseded' status) with a reason — used when a PR closes. */
/**
 * Cancel a single job by superseding it. Only queued/running jobs are
 * cancellable; a terminal job (done/failed/superseded/merged/closed) is left
 * untouched. Returns true iff a row was actually changed.
 */
export async function cancelJob(env: Pick<Env, 'DB'>, jobId: string, reason: string): Promise<boolean> {
  const db = getDb(env);
  // Only queued/running jobs are cancellable; a terminal job stays as-is. The
  // returned rows tell the caller whether anything actually changed.
  const rows = await db.update(jobs).set({
    status: 'superseded',
    finished_at: sql`CURRENT_TIMESTAMP`,
    lease_owner: null,
    lease_expires_at: null,
    error_msg: reason,
  }).where(and(eq(jobs.id, jobId), inArray(jobs.status, ['queued', 'running'])))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

/**
 * Cancel every waiting job in one shot — the dashboard "clear queue" button.
 * Targets only 'queued' (not the at-most-one 'running' job): superseding a
 * queued job makes its pending REVIEW_QUEUE message a no-op on dequeue, since
 * claimJobLease admits only queued/running and acks anything terminal. Returns
 * the cancelled ids so the caller can broadcast a feed refresh.
 */
export async function cancelQueuedJobs(env: Pick<Env, 'DB'>, reason: string): Promise<string[]> {
  const db = getDb(env);
  const rows = await db.update(jobs).set({
    status: 'superseded',
    finished_at: sql`CURRENT_TIMESTAMP`,
    lease_owner: null,
    lease_expires_at: null,
    error_msg: reason,
  }).where(eq(jobs.status, 'queued')).returning({ id: jobs.id });
  return rows.map((r) => r.id);
}

/**
 * Reflect a PR's merged/closed state on EVERY job codra has for it. Active
 * (queued/running) jobs are cancelled with a reason; already-finished jobs
 * (done/failed/superseded) just have their status flipped to merged/closed so
 * the dashboard always shows the PR's final state — the review verdict stays in
 * the `verdict` column. Returns the ids of jobs that were active (for the
 * cancellation comment).
 */
export async function markPrClosed(
  env: Pick<Env, 'DB'>,
  input: { owner: string; repo: string; prNumber: number },
  state: 'merged' | 'closed',
  reason: string,
): Promise<{ cancelledActiveIds: string[] }> {
  const db = getDb(env);
  const repoRow = await db.select({ id: repositories.id })
    .from(repositories)
    .where(and(eq(repositories.owner, input.owner), eq(repositories.repo, input.repo)))
    .get();
  if (!repoRow) return { cancelledActiveIds: [] };

  const active = await db.select({ id: jobs.id })
    .from(jobs)
    .where(and(
      eq(jobs.repository_id, repoRow.id),
      eq(jobs.pr_number, input.prNumber),
      inArray(jobs.status, ['queued', 'running']),
    ))
    .all();

  // Cancel the active reviews.
  if (active.length > 0) {
    await db.update(jobs).set({
      status: state,
      finished_at: sql`CURRENT_TIMESTAMP`,
      lease_owner: null,
      lease_expires_at: null,
      error_msg: reason,
    }).where(and(
      eq(jobs.repository_id, repoRow.id),
      eq(jobs.pr_number, input.prNumber),
      inArray(jobs.status, ['queued', 'running']),
    ));
  }

  // Flip every other job for this PR to the PR's final state (keep their
  // existing verdict / error / finished_at).
  await db.update(jobs).set({ status: state }).where(and(
    eq(jobs.repository_id, repoRow.id),
    eq(jobs.pr_number, input.prNumber),
    inArray(jobs.status, ['done', 'failed', 'superseded']),
  ));

  return { cancelledActiveIds: active.map((j) => j.id) };
}

export async function findExistingJobForHead(
  env: Pick<Env, 'DB'>,
  input: { owner: string; repo: string; prNumber: number; commitSha: string; trigger: 'auto' | 'mention' },
) {
  const db = getDb(env);
  const res = await db.select()
  .from(jobs)
  .innerJoin(repositories, eq(jobs.repository_id, repositories.id))
  .where(and(
    eq(repositories.owner, input.owner),
    eq(repositories.repo, input.repo),
    eq(jobs.pr_number, input.prNumber),
    eq(jobs.commit_sha, Array.from(hexToBytes(input.commitSha))),
    eq(jobs.trigger, input.trigger)
  ))
  .orderBy(desc(jobs.created_at))
  .limit(1)
  .get();

  return res ? mapJob(mergeRow(res)) : null;
}

export async function updateJobStep(
  env: Pick<Env, 'DB'>,
  jobId: string,
  stepName: string,
  update: {
    status: 'pending' | 'running' | 'done' | 'failed';
    startedAt?: string | null;
    finishedAt?: string | null;
    error?: string | null;
  },
) {
  const db = getDb(env);
  const now = new Date().toISOString();

  const startedAt = update.status === 'running' ? now : (update.startedAt ?? null);
  const finishedAt = update.status === 'done' || update.status === 'failed' ? now : (update.finishedAt ?? null);
  const error = update.error ?? null;

  const jobRow = await db.select({ steps: jobs.steps }).from(jobs).where(eq(jobs.id, jobId)).get();
  if (!jobRow) return;

  const steps = parseJsonColumn(jobRow.steps, []) as any[];
  const step = steps.find((s: any) => s.name === stepName);
  
  if (step) {
    step.status = update.status;
    step.startedAt = startedAt ?? step.startedAt;
    step.finishedAt = finishedAt ?? step.finishedAt;
    step.error = error ?? step.error;
  } else {
    steps.push({
      name: stepName,
      status: update.status,
      startedAt,
      finishedAt,
      error,
    });
  }

  await db.update(jobs).set({
    heartbeat_at: now,
    steps,
  }).where(eq(jobs.id, jobId));
}

export async function recoverStaleJobs(
  env: Pick<Env, 'DB'>,
  thresholdMinutes = 20,
): Promise<number> {
  const db = getDb(env);
  const rows = await db.update(jobs)
    .set({
      status: 'failed',
      finished_at: sql`CURRENT_TIMESTAMP`,
      error_msg: 'Job timed out: worker crashed or was evicted.'
    })
    .where(and(
      eq(jobs.status, 'running'),
      lt(jobs.started_at, sql`datetime('now', '-' || ${thresholdMinutes} || ' minutes')`)
    ))
    .returning({ id: jobs.id });

  return rows.length;
}

export async function recoverExpiredJobLeases(
  env: Pick<Env, 'DB'>,
  maxRecoveryCount = 3,
  unleasedGraceSeconds = 300,
) {
  const db = getDb(env);
  
  const expiredJobs = await db.select({ id: jobs.id, recovery_count: jobs.recovery_count, steps: jobs.steps })
    .from(jobs)
    .where(and(
      eq(jobs.status, 'running'),
      or(
        and(isNotNull(jobs.lease_expires_at), lt(jobs.lease_expires_at, sql`CURRENT_TIMESTAMP`)),
        and(isNull(jobs.lease_expires_at), lt(sql`COALESCE(last_queue_message_at, heartbeat_at, started_at, created_at)`, sql`datetime('now', '-' || ${unleasedGraceSeconds} || ' seconds')`))
      )
    ))
    .limit(50)
    .all();

  const toRequeue = expiredJobs.filter(j => (j.recovery_count || 0) < maxRecoveryCount);
  const toFail = expiredJobs.filter(j => (j.recovery_count || 0) >= maxRecoveryCount);

  const requeuedJobIds: string[] = [];
  if (toRequeue.length > 0) {
    for (const j of toRequeue) {
      await db.update(jobs).set({
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: null,
        recovery_count: (j.recovery_count || 0) + 1,
        last_queue_message_at: sql`CURRENT_TIMESTAMP`,
        error_msg: null,
      }).where(eq(jobs.id, j.id!));
      requeuedJobIds.push(j.id!);
    }
  }

  const failedJobs: any[] = [];
  if (toFail.length > 0) {
    for (const j of toFail) {
      const steps = (parseJsonColumn(j.steps, []) as any[]).map((s: any) => {
        if (s.status === 'running') {
          return { ...s, status: 'failed', finishedAt: new Date().toISOString(), error: 'Job timed out: worker crashed or was evicted.' };
        }
        return s;
      });

      const [failed] = await db.update(jobs).set({
        status: 'failed',
        finished_at: sql`CURRENT_TIMESTAMP`,
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: null,
        error_msg: 'Job timed out: worker crashed or was evicted.',
        steps,
      }).where(eq(jobs.id, j.id!)).returning();

      const repo = await db.select().from(repositories).where(eq(repositories.id, failed.repository_id!)).get();
      failedJobs.push({ ...failed, owner: repo?.owner, repo: repo?.repo, installation_id: repo?.installation_id });
    }
  }

  return { requeuedJobIds, failedJobs };
}

export async function getTerminalJobsNeedingCheckRunCompletion(
  env: Pick<Env, 'DB'>,
  limit = 25,
) {
  const db = getDb(env);
  const rows = await db.select()
  .from(jobs)
  .innerJoin(repositories, eq(jobs.repository_id, repositories.id))
  .where(and(
    inArray(jobs.status, ['failed', 'superseded']),
    isNotNull(jobs.check_run_id),
    isNull(jobs.check_run_completed_at)
  ))
  .orderBy(sql`COALESCE(${jobs.finished_at}, ${jobs.started_at}, ${jobs.created_at}) ASC`)
  .limit(limit)
  .all();

  return rows.map(r => mergeRow(r));
}

export async function supersedeOlderJobs(
  env: Pick<Env, 'DB'>,
  input: {
    installationId: string;
    owner: string;
    repo: string;
    prNumber: number;
    newJobId: string;
  },
): Promise<number> {
  const db = getDb(env);
  const repo = await getOrCreateRepository(env, {
    installationId: input.installationId,
    owner: input.owner,
    repo: input.repo,
  });

  const rows = await db.update(jobs).set({
    status: 'superseded',
    finished_at: sql`CURRENT_TIMESTAMP`,
    lease_owner: null,
    lease_expires_at: null,
    error_msg: 'Superseded by a newer commit or job.',
  }).where(and(
    eq(jobs.repository_id, repo),
    eq(jobs.pr_number, input.prNumber),
    ne(jobs.id, input.newJobId),
    inArray(jobs.status, ['queued', 'running'])
  )).returning({ id: jobs.id });

  return rows.length;
}

// Auto (non-mention, non-retry) reviews are capped per PR so a chatty push
// history can't burn review budget forever; @mention and manual retry always
// bypass this cap. Shared by every job-creation path (webhook.ts direct
// insert, resolveQueuedJob) so none of them can silently bypass it.
export const MAX_AUTO_REVIEWS_PER_PR = 3;

/** Number of AUTO-triggered review jobs ever created for a PR (any status),
 *  used to cap automatic re-reviews. Mention/retry/sync are excluded. */
export async function countAutoReviewsForPr(
  env: Pick<Env, 'DB'>,
  input: { installationId: string; owner: string; repo: string; prNumber: number },
): Promise<number> {
  const db = getDb(env);
  const repo = await getOrCreateRepository(env, {
    installationId: input.installationId,
    owner: input.owner,
    repo: input.repo,
  });

  const row = await db.select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(and(
      eq(jobs.repository_id, repo),
      eq(jobs.pr_number, input.prNumber),
      eq(jobs.trigger, 'auto'),
    ))
    .get();

  return row?.count ?? 0;
}

export async function forceRestartJob(
  env: Pick<Env, 'DB'>,
  jobId: string,
): Promise<boolean> {
  const db = getDb(env);

  const existing = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId)).get();
  if (!existing) return false;

  await db.update(jobs).set({
    status: 'running',
    lease_owner: null,
    lease_expires_at: null,
    heartbeat_at: null,
    recovery_count: 0,
    last_queue_message_at: sql`CURRENT_TIMESTAMP`,
    error_msg: null,
  }).where(eq(jobs.id, jobId));

  return true;
}
