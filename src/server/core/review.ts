import { logger } from './logger';
import { isSupportedGitHubWebhookEvent, type GitHubWebhookEventName, type GitHubWebhookPayload, type IssueCommentWebhookPayload, type PullRequestWebhookPayload } from '@shared/github';
import { defaultRepoConfig, normalizeModelId, type ParsedReviewComment, type RepoConfig, type ReviewJobMessage } from '@shared/schema';
import { getFileReviewsForJobs, recordRetryableFileReviewFailure, upsertFileReview } from '@server/db/file-reviews';
import { getResolvedModelConfig } from '@server/db/model-configs';
import { claimJobLease, clearJobBatch, completeJob, completePreparationStep, failJob, findExistingJobForHead, getJobForProcessing, heartbeatJobLease, insertJob, mapJob, markJobCheckRunCompleted, markJobContinuationQueued, recordJobBatch, releaseJobLease, supersedeOlderJobs, updateJobCheckRun, updateJobStatusComment, updateJobStep } from '@server/db/jobs';
import { parseFileReviewResponse } from './model-output';
import { filterReviewableFiles, parseUnifiedDiff } from './diff';

import { GitHubService } from '../services/github';
import { GitHubClient } from './github';
import { isRetryableModelError, ModelService } from '../services/model';
import { FormatterService } from '../services/formatter';
import { TokenTracker } from './token-tracker';
import { loadRepoConfig } from './config';
import { getWebhookDelivery } from '@server/db/webhook-deliveries';

type PersistedReviewJob = ReturnType<typeof mapJob>;

export type ReviewJobRunResult = { action: 'ack' } | { action: 'retry'; delaySeconds: number };

const REVIEW_CHUNK_FILE_LIMIT = 3;
const REVIEW_CHUNK_WALL_CLOCK_MS = 12 * 60 * 1000;
const JOB_LEASE_SECONDS = 15 * 60;
const BUSY_RETRY_SECONDS = 60;
const RETRYABLE_MODEL_FAILURE_RETRY_DELAYS_SECONDS = [60, 5 * 60, 15 * 60];
/** Workers AI batches typically land within ~5 minutes; poll on a steady beat. */
const BATCH_POLL_DELAY_SECONDS = 30;
const MAX_RETRYABLE_FILE_REVIEW_FAILURES = 3;

function isRetryableFileReviewErrorMessage(message: string | null | undefined) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('all configured review models failed') ||
    lower.includes('retrying later') ||
    lower.includes('google request failed with 5') ||
    lower.includes('cloudflare') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('internal error') ||
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('temporary') ||
    lower.includes('[redacted]') ||
    lower.includes('returned no review content') ||
    lower.includes('empty response')
  );
}

function retryableModelFailureDelaySeconds(failureCount: number | null | undefined) {
  if (!failureCount || failureCount < 1) return RETRYABLE_MODEL_FAILURE_RETRY_DELAYS_SECONDS[0];
  const index = Math.min(failureCount - 1, RETRYABLE_MODEL_FAILURE_RETRY_DELAYS_SECONDS.length - 1);
  return RETRYABLE_MODEL_FAILURE_RETRY_DELAYS_SECONDS[index];
}

function getRetryableModelFailureDelaySeconds(error: unknown) {
  const record = error && typeof error === 'object' ? error as { retryAfterSeconds?: unknown } : null;
  const retryAfterSeconds =
    typeof record?.retryAfterSeconds === 'number'
      ? record.retryAfterSeconds
      : null;
  return retryAfterSeconds ?? RETRYABLE_MODEL_FAILURE_RETRY_DELAYS_SECONDS[0];
}

function shouldRetryExistingFileReview(review: { file_status: string; error_msg: string | null }) {
  return review.file_status === 'failed' && isRetryableFileReviewErrorMessage(review.error_msg);
}

function countsAsHandledFileReview(review: { file_status: string; error_msg: string | null }) {
  return !shouldRetryExistingFileReview(review);
}

function configuredModelSet(config: RepoConfig) {
  const models = new Set<string>();
  const addModel = (model: string | null | undefined) => {
    if (model) models.add(normalizeModelId(model));
  };

  addModel(config.model?.main);
  for (const fallback of config.model?.fallbacks ?? []) {
    addModel(fallback);
  }
  for (const tier of config.model?.size_overrides ?? []) {
    addModel(tier.model);
    for (const fallback of tier.fallbacks ?? []) {
      addModel(fallback);
    }
  }

  return models;
}

function canInheritParentFileReview(config: RepoConfig, review: { model_used: string }) {
  return configuredModelSet(config).has(normalizeModelId(review.model_used));
}

async function resolveModelProviderName(env: Pick<Env, 'DB'>, modelId: string | null | undefined) {
  if (!modelId || modelId === 'unconfigured') return null;

  try {
    const resolved = await getResolvedModelConfig(env, normalizeModelId(modelId));
    return resolved?.providerName ?? null;
  } catch (error) {
    logger.warn(`Failed to resolve provider for model ${modelId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function shouldTriggerFromPullRequest(action: PullRequestWebhookPayload['action'], config: RepoConfig['review']) {
  return (config.on as string[]).includes(action);
}

export type ReviewRequest = {
  installationId: string;
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string | null;
  prAuthor: string | null;
  commitSha: string;
  baseSha: string;
  headRef: string | null;
  baseRef: string | null;
  trigger: 'auto' | 'mention';
};

export function extractReviewRequest(input: {
  eventName: GitHubWebhookEventName;
  payload: GitHubWebhookPayload;
  botUsername: string;
  config: RepoConfig;
}): ReviewRequest | null {
  if (input.eventName === 'pull_request') {
    const payload = input.payload as PullRequestWebhookPayload;
    if (input.config.review.ignore_drafts && payload.pull_request.draft) {
      return null;
    }
    if (!shouldTriggerFromPullRequest(payload.action, input.config.review)) {
      return null;
    }

    return {
      installationId: String(payload.installation?.id ?? ''),
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      prNumber: payload.pull_request.number,
      prTitle: payload.pull_request.title,
      prAuthor: payload.pull_request.user.login,
      commitSha: payload.pull_request.head.sha,
      baseSha: payload.pull_request.base.sha,
      headRef: payload.pull_request.head.ref,
      baseRef: payload.pull_request.base.ref,
      trigger: 'auto' as const,
    };
  }

  if (input.eventName === 'issue_comment') {
    const payload = input.payload as IssueCommentWebhookPayload;
    const mentionTrigger = input.config.review.mention_trigger;

    if (!payload.issue?.pull_request || payload.action !== 'created' || !mentionTrigger) {
      return null;
    }

    if (!payload.comment?.body?.includes(mentionTrigger)) {
      return null;
    }

    return {
      installationId: String(payload.installation?.id ?? ''),
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      prNumber: payload.issue.number,
      prTitle: null,
      prAuthor: null,
      commitSha: '',
      baseSha: '',
      headRef: null,
      baseRef: null,
      trigger: 'mention' as const,
    };
  }

  return null;
}

export async function runReviewJob(env: Env, message: ReviewJobMessage): Promise<ReviewJobRunResult> {
  const resolved = await resolveQueuedJob(env, message);
  if (!resolved) {
    return { action: 'ack' };
  }

  const leaseOwner = crypto.randomUUID();
  const claim = await claimJobLease(env, resolved.job.id, leaseOwner, JOB_LEASE_SECONDS);
  if (claim.status === 'missing') {
    logger.warn(`Job not found for processing: ${resolved.job.id}`);
    return { action: 'ack' };
  }
  if (claim.status === 'terminal') {
    logger.info(`Job ${resolved.job.id} is already terminal (${claim.row.status}), acking queue delivery.`);
    return { action: 'ack' };
  }
  if (claim.status === 'busy') {
    logger.info(`Job ${resolved.job.id} has a fresh lease; retrying queue delivery later.`);
    return { action: 'retry', delaySeconds: Math.min(BUSY_RETRY_SECONDS, claim.retryAfterSeconds) };
  }

  const job = mapJob(claim.row);
  const phase = resolved.phase;
  const tracker = new TokenTracker();
  const github = new GitHubService(env, job.installationId, tracker);
  const model = new ModelService(env, tracker, { jobId: job.id });
  const formatter = new FormatterService(env.APP_URL);

  try {
    if (phase === 'prepare') {
      await runPreparePhase(env, job, leaseOwner, github);
    } else if (phase === 'finalize') {
      await runFinalizePhase(env, job, leaseOwner, github, formatter);
    } else {
      await runReviewPhase(env, job, leaseOwner, github, model);
    }

    await releaseJobLease(env, job.id, leaseOwner);
    return { action: 'ack' };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Unknown review failure';
    if (messageText === 'JOB_SUPERSEDED') {
      logger.info(`Job ${job.id} was superseded during execution, stopping.`);
      await releaseJobLease(env, job.id, leaseOwner);
      return { action: 'ack' };
    }

    if (isRetryableModelError(error)) {
      const delaySeconds = getRetryableModelFailureDelaySeconds(error);
      logger.warn(`Review job hit transient model/provider failure; scheduling delayed continuation: ${job.owner}/${job.repo} PR #${job.prNumber}`, {
        error: messageText,
        phase,
        delaySeconds,
      });
      await enqueueJobPhase(env, job.id, phase, delaySeconds);
      await releaseJobLease(env, job.id, leaseOwner);
      return { action: 'ack' };
    }

    logger.error(`Review job failed: ${job.owner}/${job.repo} PR #${job.prNumber}`, error);
    await failJobAndCheckRun(env, job, github, messageText);
    await releaseJobLease(env, job.id, leaseOwner);
    return { action: 'ack' };
  }
}

async function resolveQueuedJob(
  env: Env,
  message: ReviewJobMessage,
): Promise<{ job: PersistedReviewJob; phase: 'prepare' | 'review' | 'finalize' } | null> {
  if (message.jobId) {
    const row = await getJobForProcessing(env, message.jobId);
    return row ? { job: mapJob(row), phase: message.phase ?? 'review' } : null;
  }

  if (!message.eventName) {
    logger.warn('Queue message ignored: missing eventName');
    return null;
  }

  let eventName = message.eventName;
  let payload = message.payload as GitHubWebhookPayload | undefined;

  if (payload === undefined) {
    const delivery = await getWebhookDelivery(env, message.deliveryId);
    if (!delivery) {
      logger.warn(`Queue message ignored: webhook delivery not found: ${message.deliveryId}`);
      return null;
    }

    eventName = delivery.event_name;
    payload = delivery.payload as GitHubWebhookPayload;
  }

  if (!isSupportedGitHubWebhookEvent(eventName)) {
    logger.info(`Queue message ignored: unsupported GitHub event ${eventName}`);
    return null;
  }

  const installationId = String(payload.installation?.id ?? '');
  if (!installationId || !('repository' in payload) || !payload.repository) {
    logger.info('Queue message ignored: missing installation or repository info');
    return null;
  }

  const repoConfig = await loadRepoConfig(env, {
    installationId,
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
  });

  if (repoConfig.enabled === false) {
    logger.info(`Job ignored: repository ${payload.repository.owner.login}/${payload.repository.name} is disabled`);
    return null;
  }

  const extracted = extractReviewRequest({
    eventName,
    payload,
    botUsername: env.BOT_USERNAME,
    config: repoConfig.parsedJson,
  });

  if (!extracted) {
    if (eventName === 'pull_request') {
      const prPayload = payload as PullRequestWebhookPayload;
      if (prPayload.action === 'closed' && repoConfig.parsedJson.review.labels !== false) {
        const labels = repoConfig.parsedJson.review.labels;
        const gh = new GitHubClient(env, installationId);
        await gh.removeIssueLabelsIfPresent(
          prPayload.repository.owner.login,
          prPayload.repository.name,
          prPayload.pull_request.number,
          [labels.p1, labels.p2, labels.p3],
        );
      }
    }
    return null;
  }

  let resolved = extracted;
  const githubClient = new GitHubClient(env, installationId);
  if (eventName === 'issue_comment') {
    const pr = await githubClient.getPullRequest(extracted.owner, extracted.repo, extracted.prNumber);
    resolved = {
      ...extracted,
      prTitle: pr.title,
      prAuthor: pr.user.login,
      commitSha: pr.head.sha,
      baseSha: pr.base.sha,
      headRef: pr.head.ref,
      baseRef: pr.base.ref,
    };
  }

  const duplicateJob = await findExistingJobForHead(env, {
    owner: resolved.owner,
    repo: resolved.repo,
    prNumber: resolved.prNumber,
    commitSha: resolved.commitSha,
    trigger: resolved.trigger,
  });
  if (duplicateJob) {
    if (duplicateJob.status === 'queued' || duplicateJob.status === 'running') {
      logger.info(`Resuming duplicate in-flight job ${duplicateJob.id} for ${resolved.owner}/${resolved.repo} PR #${resolved.prNumber}.`);
      return { job: duplicateJob, phase: message.phase ?? 'prepare' };
    }

    logger.info(`Duplicate terminal job found for ${resolved.owner}/${resolved.repo} PR #${resolved.prNumber}, skipping.`);
    return null;
  }

  const job = await insertJob(env, {
    installationId: resolved.installationId,
    owner: resolved.owner,
    repo: resolved.repo,
    prNumber: resolved.prNumber,
    prTitle: resolved.prTitle,
    prAuthor: resolved.prAuthor,
    commitSha: resolved.commitSha,
    baseSha: resolved.baseSha,
    trigger: resolved.trigger,
    headRef: resolved.headRef,
    baseRef: resolved.baseRef,
    configSnapshot: repoConfig.parsedJson,
  });

  await supersedeOlderJobs(env, {
    installationId: resolved.installationId,
    owner: resolved.owner,
    repo: resolved.repo,
    prNumber: resolved.prNumber,
    newJobId: job.id,
  });

  return { job, phase: 'prepare' };
}

async function runPreparePhase(
  env: Env,
  job: PersistedReviewJob,
  leaseOwner: string,
  github: GitHubService,
) {
  await checkSuperseded(env, job.id);
  await updateJobStep(env, job.id, 'Preparation', { status: 'running' });
  const pr = await github.getPullRequest(job.owner, job.repo, job.prNumber);
  const config = (job.configSnapshot ?? defaultRepoConfig) as RepoConfig;

  let checkRunId = job.checkRunId;
  if (!checkRunId) {
    const checkRun = await github.createCheckRun(job.owner, job.repo, {
      headSha: pr.head.sha,
      title: 'Review queued',
      summary: 'Codra has started reviewing this pull request.',
    });
    checkRunId = checkRun.id ?? undefined;
    if (checkRun.id) {
      await updateJobCheckRun(env, job.id, checkRun.id);
    }
  }

  // Post a status comment to the PR so the team knows Codra is active
  if (!job.statusCommentId) {
    try {
      const statusBody = `## \u{1F50D} Code Review\n\nCodra is reviewing this pull request. A summary will be posted here when the review is complete.`;
      const comment = await github.createIssueComment(job.owner, job.repo, job.prNumber, statusBody);
      await updateJobStatusComment(env, job.id, comment.id);
    } catch (err) {
      logger.error('Failed to post status comment', err);
    }
  }

  const rawDiff = await github.getPullRequestDiff(job.owner, job.repo, job.prNumber);
  const files = filterReviewableFiles(parseUnifiedDiff(rawDiff), config.review);
  await completePreparationStep(env, job.id, files.length);
  await heartbeatJobLease(env, job.id, leaseOwner, JOB_LEASE_SECONDS);

  if (files.length === 0) {
    await updateJobStep(env, job.id, 'Reviewing Files', { status: 'done' });
    await enqueueJobPhase(env, job.id, 'finalize');
    return;
  }

  if (checkRunId) {
    await github.updateCheckRun(job.owner, job.repo, checkRunId, {
      title: `Reviewing (0/${files.length})`,
      summary: 'Codra is analyzing changed files.',
    });
  }
  await enqueueJobPhase(env, job.id, 'review');
}

async function runReviewPhase(
  env: Env,
  job: PersistedReviewJob,
  leaseOwner: string,
  github: GitHubService,
  model: ModelService,
) {
  await checkSuperseded(env, job.id);

  if (!hasCompletedStep(job, 'Preparation')) {
    await runPreparePhase(env, job, leaseOwner, github);
    return;
  }

  if (!hasCompletedStep(job, 'Standardization')) {
    try {
      await updateJobStep(env, job.id, 'Standardization', { status: 'running' });
      const config = (job.configSnapshot ?? defaultRepoConfig) as RepoConfig;
      await standardizeRepository(env, job, github, model, config);
      await updateJobStep(env, job.id, 'Standardization', { status: 'done' });
    } catch (err) {
      logger.error('Failed to run repository standardization checks', err);
      await updateJobStep(env, job.id, 'Standardization', { status: 'failed', error: String(err) });
    }
  }

  await updateJobStep(env, job.id, 'Reviewing Files', { status: 'running' });

  const pr = await github.getPullRequest(job.owner, job.repo, job.prNumber);
  const config = (job.configSnapshot ?? defaultRepoConfig) as RepoConfig;
  const failureModelId = config.model?.main ?? 'unconfigured';
  let failureModelProviderPromise: Promise<string | null> | null = null;
  const resolveFailureModelProvider = () => {
    failureModelProviderPromise ??= resolveModelProviderName(env, failureModelId);
    return failureModelProviderPromise;
  };
  const rawDiff = await github.getPullRequestDiff(job.owner, job.repo, job.prNumber);
  const files = filterReviewableFiles(parseUnifiedDiff(rawDiff), config.review);
  const totalLineCount = files.reduce((sum, file) => sum + file.lineCount, 0);
  const startedAt = Date.now();
  let processedThisChunk = 0;

  // Bail before spending model calls if a newer commit superseded this job
  // while standardization / diff-fetch was running.
  await checkSuperseded(env, job.id);

  const jobIdsToQuery = [job.id];
  if (job.retryOfJobId) jobIdsToQuery.push(job.retryOfJobId);
  const allExistingReviews = await getFileReviewsForJobs(env, jobIdsToQuery);
  const currentReviews = new Map(allExistingReviews.filter((review) => review.job_id === job.id).map((review) => [review.file_path, review]));
  const parentReviews = new Map(allExistingReviews.filter((review) => review.job_id !== job.id && review.file_status === 'done').map((review) => [review.file_path, review]));

  const pendingFiles = files.filter((file) => {
    const existingReview = currentReviews.get(file.path);
    return !(existingReview && countsAsHandledFileReview(existingReview));
  });

  if (await runBatchReviewPhase(env, job, leaseOwner, github, model, { pr, config, files, pendingFiles, totalLineCount })) {
    return;
  }

  const reviewTasks: Array<Promise<void>> = [];

  for (const file of files) {
    const existingReview = currentReviews.get(file.path);
    if (existingReview && countsAsHandledFileReview(existingReview)) {
      continue;
    }

    const inherited = parentReviews.get(file.path);
    const reviewTask = async () => {
      if (!inherited) {
        await reviewAndPersistFile(env, job, file, pr, config, totalLineCount, model, resolveFailureModelProvider, existingReview);
        return;
      }

      if (!canInheritParentFileReview(config, inherited)) {
        logger.info(`Ignoring inherited review for ${file.path}; parent model ${inherited.model_used} is not in the current model strategy`);
        await reviewAndPersistFile(env, job, file, pr, config, totalLineCount, model, resolveFailureModelProvider, existingReview);
      } else {
        await upsertFileReview(env, job.id, {
          filePath: file.path,
          fileStatus: 'done',
          modelUsed: inherited.model_used,
          modelProvider: inherited.model_provider,
          diffLineCount: inherited.diff_line_count ?? 0,
          diffInput: inherited.diff_input,
          rawAiOutput: inherited.raw_ai_output,
          parsedComments: inherited.parsed_comments as ParsedReviewComment[],
          inputTokens: inherited.input_tokens,
          outputTokens: inherited.output_tokens,
          durationMs: inherited.duration_ms,
          verdict: inherited.verdict as any,
          fileSummary: inherited.file_summary,
          overallCorrectness: inherited.overall_correctness,
          confidenceScore: inherited.confidence_score,
          errorMessage: null,
        });
        currentReviews.set(file.path, inherited);
      }
    };

    reviewTasks.push(reviewTask());
    processedThisChunk += 1;

    if (processedThisChunk >= REVIEW_CHUNK_FILE_LIMIT || Date.now() - startedAt >= REVIEW_CHUNK_WALL_CLOCK_MS) {
      break;
    }
  }

  const results = await Promise.allSettled(reviewTasks);
  await heartbeatAndCheckSuperseded(env, job.id, leaseOwner);

  const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (rejected.length > 0) {
    rejected.forEach((result, index) => {
      logger.error(`Review chunk task ${index + 1}/${rejected.length} failed`, result.reason);
    });
    throw rejected.length === 1
      ? rejected[0].reason
      : new AggregateError(rejected.map((result) => result.reason), `${rejected.length} review chunk tasks failed`);
  }

  const latestReviews = await getFileReviewsForJobs(env, [job.id]);
  const reviewedPaths = new Set(latestReviews.filter(countsAsHandledFileReview).map((review) => review.file_path));
  const completedCount = files.filter((file) => reviewedPaths.has(file.path)).length;

  if (completedCount >= files.length) {
    await updateJobStep(env, job.id, 'Reviewing Files', { status: 'done' });
    await enqueueJobPhase(env, job.id, 'finalize');
    return;
  }

  if (job.checkRunId) {
    await github.updateCheckRun(job.owner, job.repo, job.checkRunId, {
      title: `Reviewing (${completedCount}/${files.length})`,
      summary: 'Codra is continuing this review in the next queue chunk.',
    });
  }
  await enqueueJobPhase(env, job.id, 'review');
}

/**
 * Workers AI async batch path. Queues every outstanding file review in one call
 * and polls it across later queue invocations, which sidesteps the per-request
 * capacity errors that drive the synchronous path into multi-minute backoff.
 *
 * Returns true when it owns this invocation (submitted or polled), false to let
 * the caller fall back to synchronous chunked review.
 */
async function runBatchReviewPhase(
  env: Env,
  job: PersistedReviewJob,
  leaseOwner: string,
  github: GitHubService,
  model: ModelService,
  ctx: {
    pr: Awaited<ReturnType<GitHubService['getPullRequest']>>;
    config: RepoConfig;
    files: ReturnType<typeof parseUnifiedDiff>;
    pendingFiles: ReturnType<typeof parseUnifiedDiff>;
    totalLineCount: number;
  },
) {
  const { pr, config, files, pendingFiles, totalLineCount } = ctx;

  if (job.batchRequestId && job.batchModel) {
    const result = await model.pollReviewBatch(job.batchModel, job.batchRequestId);

    if (result.status === 'pending') {
      await heartbeatAndCheckSuperseded(env, job.id, leaseOwner);
      if (job.checkRunId) {
        await github.updateCheckRun(job.owner, job.repo, job.checkRunId, {
          title: `Reviewing (batch queued)`,
          summary: 'Codra queued this review on the Workers AI batch API and is waiting for results.',
        });
      }
      await enqueueJobPhase(env, job.id, 'review', BATCH_POLL_DELAY_SECONDS);
      return true;
    }

    await persistBatchResponses(env, job, files, result.responses);
    await clearJobBatch(env, job.id);
    // Re-run the review phase so the existing completeness check decides
    // whether to finalize or retry any files the batch could not review.
    await enqueueJobPhase(env, job.id, 'review');
    return true;
  }

  if (pendingFiles.length === 0) return false;

  const batchModel = await model.resolveBatchModel(config, totalLineCount);
  if (!batchModel) return false;

  const prompts = await Promise.all(
    pendingFiles.map((file) =>
      model.buildReviewPrompt({
        file,
        prTitle: pr.title ?? null,
        prDescription: pr.body ?? null,
        config,
        totalLineCount,
      }),
    ),
  );

  const requestId = await model.submitReviewBatch(
    batchModel,
    prompts.map((prompt) => ({ systemPrompt: prompt.systemPrompt, userPrompt: prompt.userPrompt })),
  );
  if (!requestId) return false;

  await recordJobBatch(env, job.id, {
    requestId,
    model: batchModel,
    filePaths: pendingFiles.map((file) => file.path),
  });
  await enqueueJobPhase(env, job.id, 'review', BATCH_POLL_DELAY_SECONDS);
  return true;
}

/** Maps batch responses back to files by index and persists each file review. */
async function persistBatchResponses(
  env: Env,
  job: PersistedReviewJob,
  files: ReturnType<typeof parseUnifiedDiff>,
  responses: Array<{ index: number; rawText: string | null; error: string | null }>,
) {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const batchModel = job.batchModel ?? 'unknown';

  for (const response of responses) {
    const filePath = job.batchFilePaths[response.index];
    const file = filePath ? filesByPath.get(filePath) : undefined;
    if (!file) {
      logger.warn(`Batch response ${response.index} has no matching file in job ${job.id}; skipping`);
      continue;
    }

    const failure = response.error ?? (response.rawText ? null : 'Batch returned no review content');
    if (failure) {
      await recordBatchFileFailure(env, job, file, batchModel, failure);
      continue;
    }

    try {
      const parsed = parseFileReviewResponse(response.rawText!, file);
      await upsertFileReview(env, job.id, {
        filePath: file.path,
        fileStatus: 'done',
        modelUsed: batchModel,
        modelProvider: 'Cloudflare',
        diffLineCount: file.lineCount,
        diffInput: '',
        rawAiOutput: response.rawText,
        parsedComments: parsed.comments,
        inputTokens: null,
        outputTokens: null,
        durationMs: null,
        verdict: parsed.verdict,
        fileSummary: parsed.fileSummary,
        overallCorrectness: parsed.overallCorrectness,
        confidenceScore: parsed.confidenceScore,
        errorMessage: null,
      });
    } catch (error) {
      await recordBatchFileFailure(env, job, file, batchModel, error instanceof Error ? error.message : String(error));
    }
  }
}

/**
 * Mirrors the synchronous failure handling so a flaky batch response gets the
 * same bounded retry budget instead of looping forever.
 */
async function recordBatchFileFailure(
  env: Env,
  job: PersistedReviewJob,
  file: ReturnType<typeof parseUnifiedDiff>[number],
  batchModel: string,
  errorMessage: string,
) {
  const retryable = isRetryableFileReviewErrorMessage(errorMessage);

  if (retryable) {
    const failureCount = await recordRetryableFileReviewFailure(env, job.id, {
      filePath: file.path,
      modelUsed: batchModel,
      modelProvider: 'Cloudflare',
      diffLineCount: file.lineCount,
      diffInput: '',
      durationMs: null,
      errorMessage,
    });

    if (failureCount < MAX_RETRYABLE_FILE_REVIEW_FAILURES) {
      logger.warn(`Batch review deferred for ${file.path}; will retry`, { attempts: failureCount, error: errorMessage });
      return;
    }
    errorMessage = `Review skipped after ${failureCount} repeated batch failures. Last error: ${errorMessage}`;
  }

  await upsertFileReview(env, job.id, {
    filePath: file.path,
    fileStatus: 'failed',
    modelUsed: batchModel,
    modelProvider: 'Cloudflare',
    diffLineCount: file.lineCount,
    diffInput: '',
    rawAiOutput: null,
    parsedComments: [],
    inputTokens: null,
    outputTokens: null,
    durationMs: null,
    verdict: null,
    fileSummary: null,
    errorMessage,
  });
}

async function reviewAndPersistFile(
  env: Env,
  job: PersistedReviewJob,
  file: ReturnType<typeof parseUnifiedDiff>[number],
  pr: Awaited<ReturnType<GitHubService['getPullRequest']>>,
  config: RepoConfig,
  totalLineCount: number,
  model: ModelService,
  resolveFailureModelProvider: () => Promise<string | null>,
  previousReview?: { transient_error_count: number },
) {
  const startedAt = Date.now();
  const compactPrompt = (previousReview?.transient_error_count ?? 0) > 0;
  try {
    const response = await model.reviewFile({
      file,
      prTitle: pr.title ?? null,
      prDescription: pr.body ?? null,
      config,
      totalLineCount,
      compactPrompt,
    });

    await upsertFileReview(env, job.id, {
      filePath: file.path,
      fileStatus: 'done',
      modelUsed: response.modelUsed,
      modelProvider: response.provider,
      diffLineCount: file.lineCount,
      diffInput: response.userPrompt,
      rawAiOutput: response.rawText,
      parsedComments: response.parsed.comments,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      durationMs: Date.now() - startedAt,
      verdict: response.parsed.verdict,
      fileSummary: response.parsed.fileSummary,
      overallCorrectness: response.parsed.overallCorrectness,
      confidenceScore: response.parsed.confidenceScore,
      errorMessage: null,
    });

    if (response.parsed.comments && response.parsed.comments.length > 0) {
      try {
        const streamId = (env as any).PrReviewStream.idFromName(`${job.owner}/${job.repo}/${job.prNumber}`);
        const streamStub = (env as any).PrReviewStream.get(streamId);
        for (const comment of response.parsed.comments) {
          await streamStub.fetch(new Request('http://do/comment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(comment),
          }));
        }
      } catch (streamErr) {
        logger.error('Failed to stream real-time comment to Durable Object', streamErr);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown file review error';
    const modelId = config.model?.main ?? 'unconfigured';
    const modelProvider = await resolveFailureModelProvider();

    if (isRetryableModelError(error)) {
      const failureCount = await recordRetryableFileReviewFailure(env, job.id, {
        filePath: file.path,
        modelUsed: modelId,
        modelProvider,
        diffLineCount: file.lineCount,
        diffInput: '',
        durationMs: Date.now() - startedAt,
        errorMessage,
      });

      if (failureCount >= MAX_RETRYABLE_FILE_REVIEW_FAILURES) {
        const finalError = `Review skipped after ${failureCount} repeated model provider outages.`;
        await upsertFileReview(env, job.id, {
          filePath: file.path,
          fileStatus: 'failed',
          modelUsed: modelId,
          modelProvider,
          diffLineCount: file.lineCount,
          diffInput: '',
          rawAiOutput: null,
          parsedComments: [],
          inputTokens: null,
          outputTokens: null,
          durationMs: Date.now() - startedAt,
          verdict: null,
          fileSummary: null,
          errorMessage: finalError,
        });
        logger.error(`File review failed permanently for ${file.path} after transient retries`, {
          attempts: failureCount,
          error: errorMessage,
        });
        return;
      }

      logger.warn(`File review deferred for ${file.path}; transient model/provider failure will retry later`, {
        error: errorMessage,
        attempts: failureCount,
      });
      Object.defineProperty(error, 'retryAfterSeconds', {
        value: retryableModelFailureDelaySeconds(failureCount),
        configurable: true,
      });
      throw error;
    }

    logger.error(`File review failed for ${file.path}`, { error });

    const isHardLimit =
      errorMessage.toLowerCase().includes('subrequest') ||
      errorMessage.includes('4006') ||
      errorMessage.toLowerCase().includes('allocation');

    if (isHardLimit) {
      throw error;
    }

    await upsertFileReview(env, job.id, {
      filePath: file.path,
      fileStatus: 'failed',
      modelUsed: modelId,
      modelProvider,
      diffLineCount: file.lineCount,
      diffInput: '',
      rawAiOutput: null,
      parsedComments: [],
      inputTokens: null,
      outputTokens: null,
      durationMs: Date.now() - startedAt,
      verdict: null,
      fileSummary: null,
      errorMessage,
    });
  }
}

async function runFinalizePhase(
  env: Env,
  job: PersistedReviewJob,
  leaseOwner: string,
  github: GitHubService,
  formatter: FormatterService,
) {
  await checkSuperseded(env, job.id);
  await updateJobStep(env, job.id, 'Generating Summary', { status: 'running' });

  const pr = await github.getPullRequest(job.owner, job.repo, job.prNumber);
  const config = (job.configSnapshot ?? defaultRepoConfig) as RepoConfig;
  const rawDiff = await github.getPullRequestDiff(job.owner, job.repo, job.prNumber);
  const files = filterReviewableFiles(parseUnifiedDiff(rawDiff), config.review);
  const reviews = await getFileReviewsForJobs(env, [job.id]);

  if (reviews.length < files.length) {
    await updateJobStep(env, job.id, 'Reviewing Files', { status: 'running' });
    await enqueueJobPhase(env, job.id, 'review');
    return;
  }

  const reviewedComments = reviews.flatMap((review) => review.parsed_comments as ParsedReviewComment[]);
  const fileSummaries = reviews.map((review) => ({
    path: review.file_path,
    summary: review.file_status === 'failed'
      ? `Review failed: ${review.error_msg ?? 'Unknown file review error'}`
      : (review.file_summary ?? ''),
    verdict: review.file_status === 'failed' ? 'failed' : (review.verdict ?? 'comment'),
  }));

  if (fileSummaries.length > 0 && fileSummaries.every((file) => file.verdict === 'failed')) {
    await updateJobStep(env, job.id, 'Generating Summary', { status: 'failed', error: 'All files failed to review' });
    throw new Error('All files failed to review');
  }

  const hasFailures = fileSummaries.some((file) => file.verdict === 'failed');
  const failedFileCount = fileSummaries.filter((file) => file.verdict === 'failed').length;
  const severityRanks: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, nit: 4 };
  const minRank = severityRanks[config.review.min_severity] ?? 4;
  
  let finalComments = reviewedComments.filter(c => (severityRanks[c.severity] ?? 4) <= minRank);
  finalComments.sort((a, b) => (severityRanks[a.severity] ?? 4) - (severityRanks[b.severity] ?? 4));
  
  const omittedCount = reviewedComments.length - Math.min(finalComments.length, config.review.max_comments);
  if (finalComments.length > config.review.max_comments) {
    finalComments = finalComments.slice(0, config.review.max_comments);
  }

  const verdictSummary = formatter.summarizeVerdict(finalComments, hasFailures);
  await updateJobStep(env, job.id, 'Generating Summary', { status: 'done' });
  await heartbeatAndCheckSuperseded(env, job.id, leaseOwner);

  let formattedSummary = formatter.formatReviewOverview(pr.head.sha, env.BOT_USERNAME);
  
  if (omittedCount > 0) {
    formattedSummary += `\n\n> [!NOTE]\n> **${omittedCount} comments were omitted** from this review to reduce noise and respect the configured \`max_comments\` limit (${config.review.max_comments}). Showing the most critical issues.`;
  }

  await updateJobStep(env, job.id, 'Completing', { status: 'running' });
  const review = await github.createReview(job.owner, job.repo, job.prNumber, {
    commitSha: pr.head.sha,
    event: formatter.toReviewEvent(verdictSummary.verdict),
    body: formattedSummary,
    comments: finalComments.map(comment => ({
      path: comment.path,
      position: comment.position ?? undefined,
      body: formatter.formatInlineComment(comment),
    })),
  });

  if (config.review.labels !== false) {
    const labels = config.review.labels;
    const labelMap = {
      comment: { name: labels.p1, color: 'f79009' },
      approve: { name: labels.p2, color: '027a48' },
    } as const;
    const label = labelMap[verdictSummary.verdict];

    await github.removeIssueLabelsIfPresent(
      job.owner,
      job.repo,
      job.prNumber,
      [labels.p1, labels.p2, labels.p3].filter(possibleLabel => possibleLabel !== label.name),
    );

    await github.ensureLabel(job.owner, job.repo, label.name, label.color);
    await github.addIssueLabels(job.owner, job.repo, job.prNumber, [label.name]);
  }

  if (job.checkRunId) {
    await github.updateCheckRun(job.owner, job.repo, job.checkRunId, {
      status: 'completed',
      conclusion: hasFailures ? 'failure' : (verdictSummary.verdict === 'approve' ? 'success' : 'neutral'),
      title: hasFailures ? 'Review partially failed' : (verdictSummary.verdict === 'approve' ? 'LGTM' : 'Comments posted'),
      summary: `${finalComments.length} inline comments across ${files.length} files.${hasFailures ? ` ${failedFileCount} file${failedFileCount === 1 ? '' : 's'} could not be reviewed after repeated provider outages.` : ''}`,
    });
  }

  const fileInputTokens = reviews.reduce((sum, review) => sum + (review.input_tokens ?? 0), 0);
  const fileOutputTokens = reviews.reduce((sum, review) => sum + (review.output_tokens ?? 0), 0);
  const partialErrorMessage = hasFailures
    ? `Partial review: ${failedFileCount} of ${files.length} file${files.length === 1 ? '' : 's'} could not be reviewed after repeated model/provider outages.`
    : null;
  await completeJob(env, job.id, {
    verdict: verdictSummary.verdict,
    fileCount: files.length,
    commentCount: finalComments.length,
    totalInputTokens: fileInputTokens,
    totalOutputTokens: fileOutputTokens,
    summaryMarkdown: formattedSummary,
    reviewId: review.id,
    summaryModel: null,
    errorMessage: partialErrorMessage,
  });
  logger.info(`Review job completed: ${job.owner}/${job.repo} PR #${job.prNumber}`);

  // Update the status comment with a narrative review summary
  if (job.statusCommentId) {
    try {
      const successSummaries = fileSummaries
        .filter(f => f.verdict !== 'failed' && f.summary)
        .map(f => f.summary);
      const changeSummary = successSummaries.length > 0
        ? successSummaries.join(' ').replace(/\s+/g, ' ').trim()
        : `This pull request modifies ${files.length} file${files.length === 1 ? '' : 's'}.`;

      const topFindings = finalComments.slice(0, 3).map(c => c.title).filter(Boolean);
      const findingsText = topFindings.length > 0
        ? ` The review feedback ${topFindings.length === 1 ? 'points out' : 'highlights'} ${topFindings.map(t => t.toLowerCase()).join(', and ')}.`
        : '';

      const failureNote = hasFailures
        ? `\n\n> [!WARNING]\n> ${failedFileCount} file${failedFileCount === 1 ? '' : 's'} could not be reviewed due to provider outages.`
        : '';

      const narrativeBody = [
        `## Code Review`,
        ``,
        `${changeSummary}${findingsText}${failureNote}`,
        ``,
        `**Reviewed commit:** \`${pr.head.sha.slice(0, 10)}\` · **Files:** ${files.length} · **Comments:** ${finalComments.length}`,
      ].join('\n');

      await github.updateIssueComment(job.owner, job.repo, job.statusCommentId, narrativeBody);
    } catch (err) {
      logger.error('Failed to update status comment with summary', err);
    }
  }
}

// Throws JOB_SUPERSEDED if a newer commit/job has taken over this PR, so the
// current invocation stops before spending more model calls on stale code.
async function checkSuperseded(env: Env, jobId: string) {
  const currentJob = await getJobForProcessing(env, jobId);
  if (currentJob?.status === 'superseded') {
    throw new Error('JOB_SUPERSEDED');
  }
}

async function heartbeatAndCheckSuperseded(env: Env, jobId: string, leaseOwner: string) {
  await heartbeatJobLease(env, jobId, leaseOwner, JOB_LEASE_SECONDS);
  await checkSuperseded(env, jobId);
}

async function enqueueJobPhase(
  env: Env,
  jobId: string,
  phase: 'prepare' | 'review' | 'finalize',
  delaySeconds = 0,
) {
  await markJobContinuationQueued(env, jobId, delaySeconds);
  await env.REVIEW_QUEUE.send(
    {
      jobId,
      deliveryId: crypto.randomUUID(),
      phase,
    },
    delaySeconds > 0 ? { delaySeconds } : undefined,
  );
}

function hasCompletedStep(job: PersistedReviewJob, stepName: string) {
  return job.steps.some((step) => step.name === stepName && step.status === 'done');
}

async function failJobAndCheckRun(
  env: Env,
  job: PersistedReviewJob,
  github: GitHubService,
  message: string,
) {
  try {
    await failJob(env, job.id, message);
    const latest = await getJobForProcessing(env, job.id);
    const checkRunId = latest?.check_run_id ?? job.checkRunId;
    if (checkRunId) {
      await github.updateCheckRun(job.owner, job.repo, checkRunId, {
        status: 'completed',
        conclusion: 'failure',
        title: 'Review failed',
        summary: message,
      });
      await markJobCheckRunCompleted(env, job.id);
    }
  } catch (innerError) {
    logger.error('Failed to record job failure in DB/GitHub', innerError);
  }
}

async function fetchReferenceSettings(env: Env): Promise<string> {
  const repo = (env as any).STANDARDIZATION_REPO || 'jmbish04/core-github-standardization';
  const url = `https://raw.githubusercontent.com/${repo}/main/.vscode/settings.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch reference VS Code settings from ${url}: ${res.statusText}`);
  }
  return res.text();
}

function cleanJsonc(content: string): string {
  return content
    // Remove single line comments
    .replace(/\/\/.*$/gm, '')
    // Remove multi-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Remove trailing commas
    .replace(/,(\s*[\]}])/g, '$1')
    .trim();
}

function mergeSettings(existingStr: string, referenceStr: string): { mergedContent: string; changed: boolean } {
  try {
    const existingClean = cleanJsonc(existingStr);
    const referenceClean = cleanJsonc(referenceStr);
    
    const existing = JSON.parse(existingClean);
    const reference = JSON.parse(referenceClean);
    
    let changed = false;
    const merged = { ...existing };
    
    for (const [key, value] of Object.entries(reference)) {
      if (JSON.stringify(existing[key]) !== JSON.stringify(value)) {
        merged[key] = value;
        changed = true;
      }
    }
    
    return {
      mergedContent: JSON.stringify(merged, null, 2),
      changed,
    };
  } catch {
    // If parsing fails (e.g. invalid existing JSON), we overwrite with reference settings
    return {
      mergedContent: referenceStr,
      changed: true,
    };
  }
}

type HousekeepingChange = {
  path: string;
  content: string;
  message: string;
  /** SHA of the existing file (for updates), undefined for new files. */
  existingSha?: string;
};

async function standardizeRepository(
  env: Env,
  job: PersistedReviewJob,
  github: GitHubService,
  model: ModelService,
  config: RepoConfig
) {
  const pr = await github.getPullRequest(job.owner, job.repo, job.prNumber);
  const defaultBranch = (await github.getRepo(job.owner, job.repo)).default_branch;
  const changes: HousekeepingChange[] = [];

  // 1. VS Code settings check (against default branch, not the PR branch)
  try {
    const referenceSettingsText = await fetchReferenceSettings(env);
    const existingFile = (await github.getRepoFileWithRefOrNull(job.owner, job.repo, '.vscode/settings.jsonc', defaultBranch))
      || (await github.getRepoFileWithRefOrNull(job.owner, job.repo, '.vscode/settings.json', defaultBranch));

    if (!existingFile) {
      changes.push({
        path: '.vscode/settings.jsonc',
        content: referenceSettingsText,
        message: 'chore: add standardized VS Code settings',
      });
    } else {
      const { mergedContent, changed } = mergeSettings(existingFile.content || '', referenceSettingsText);
      if (changed) {
        const fileToUpdate = (await github.getRepoFileWithRefOrNull(job.owner, job.repo, '.vscode/settings.jsonc', defaultBranch))
          ? '.vscode/settings.jsonc'
          : '.vscode/settings.json';
        const fileInfo = await github.getRepoFileWithRefOrNull(job.owner, job.repo, fileToUpdate, defaultBranch);
        changes.push({
          path: fileToUpdate,
          content: mergedContent,
          message: 'chore: update VS Code settings with standardized keys',
          existingSha: fileInfo?.sha,
        });
      }
    }
  } catch (err) {
    logger.error('Failed to evaluate VS Code settings', err);
  }

  // 2. AGENTS.md check (against default branch)
  try {
    const agentsFileInfo = await github.getRepoFileWithRefOrNull(job.owner, job.repo, 'AGENTS.md', defaultBranch);

    const repoTree = await github.getRepoTree(job.owner, job.repo, pr.head.sha);
    const filesList = repoTree.tree
      .filter(node => node.type === 'blob')
      .map(node => node.path)
      .filter(path => !path.includes('node_modules') && !path.includes('.git') && !path.includes('.wrangler') && !path.includes('dist') && !path.includes('.next') && !path.includes('build'))
      .slice(0, 150);

    const configFiles = ['package.json', 'wrangler.jsonc', 'wrangler.toml', 'tsconfig.json', 'README.md'];
    const configDetails: string[] = [];
    for (const conf of configFiles) {
      if (filesList.includes(conf)) {
        const fileContentInfo = await github.getRepoFileWithRefOrNull(job.owner, job.repo, conf, defaultBranch);
        if (fileContentInfo && fileContentInfo.content) {
          configDetails.push(`=== File: ${conf} ===\n${fileContentInfo.content.slice(0, 1500)}`);
        }
      }
    }

    const codebaseInfo = [
      `Files in repository (truncated to first 150):\n${filesList.map(f => `- ${f}`).join('\n')}`,
      `Configuration Files:\n${configDetails.join('\n\n')}`
    ].join('\n\n');

    // Detect tech stack for skill-aware prompting
    const hasWrangler = filesList.some(f => f === 'wrangler.jsonc' || f === 'wrangler.toml');
    const hasPython = filesList.some(f => f.endsWith('.py') || f === 'pyproject.toml' || f === 'requirements.txt');
    const skillContext: string[] = [];
    if (hasWrangler) {
      skillContext.push('This is a Cloudflare Workers project. Apply the following best practice skills when writing AGENTS.md:');
      try {
        const { default: cfJedi } = await import('../skills/cloudflare-jedi/SKILL.md?raw') as { default: string };
        const { default: agentsSdk } = await import('../skills/agents-sdk/SKILL.md?raw') as { default: string };
        const { default: workersBp } = await import('../skills/workers-best-practices/SKILL.md?raw') as { default: string };
        skillContext.push(
          '=== CLOUDFLARE JEDI SKILL (excerpt) ===',
          cfJedi.slice(0, 3000),
          '=== AGENTS SDK SKILL (excerpt) ===',
          agentsSdk.slice(0, 3000),
          '=== WORKERS BEST PRACTICES SKILL (excerpt) ===',
          workersBp.slice(0, 3000),
        );
      } catch {
        // Skills may not be available in all builds
      }
    }
    if (hasPython) {
      skillContext.push('This project includes Python code. Ensure AGENTS.md covers Python conventions (SQLAlchemy for DB access, type hints, formatting with ruff/black).');
    }

    const skillBlock = skillContext.length > 0 ? `\n\nTech Stack Skills:\n${skillContext.join('\n')}` : '';

    if (!agentsFileInfo || !agentsFileInfo.content) {
      const systemPrompt = `You are a Principal Software Architect. Your task is to evaluate the provided codebase structure and configurations and write a complete, premium, custom AGENTS.md instruction file.
The AGENTS.md file must establish project guidelines, style standards, behavioral constraints, and instructions tailored specifically to the project's tech stack to guide other AI agents working on this project.
Be precise and descriptive. DO NOT write any conversational text; return ONLY the Markdown content for AGENTS.md.`;
      const userPrompt = `Here is the codebase evaluation:\n\n${codebaseInfo}${skillBlock}`;

      const res = await model.callModel(config.model?.main || 'claude-3-5-sonnet-latest', { systemPrompt, userPrompt });
      const generatedContent = res.rawText.trim();
      if (generatedContent.length > 50) {
        changes.push({
          path: 'AGENTS.md',
          content: generatedContent,
          message: 'docs: create standardized AGENTS.md system instructions',
        });
      }
    } else {
      const systemPrompt = `You are a Principal Software Architect. Your task is to review the existing AGENTS.md instruction file for this repository, compare it against the codebase structure and configurations, and improve/update it.
Ensure that the instructions are complete and cover all relevant project constraints. If any considerations, style patterns, or configurations are missing, integrate them to make AGENTS.md comprehensive.
Maintain the existing structure but improve details. DO NOT write any conversational text; return ONLY the updated Markdown content for AGENTS.md.`;
      const userPrompt = `Codebase Info:\n${codebaseInfo}${skillBlock}\n\nExisting AGENTS.md:\n${agentsFileInfo.content}`;

      const res = await model.callModel(config.model?.main || 'claude-3-5-sonnet-latest', { systemPrompt, userPrompt });
      const updatedContent = res.rawText.trim();

      if (updatedContent !== agentsFileInfo.content.trim() && updatedContent.length > 50) {
        changes.push({
          path: 'AGENTS.md',
          content: updatedContent,
          message: 'docs: verify and improve AGENTS.md system instructions',
          existingSha: agentsFileInfo.sha,
        });
      }
    }
  } catch (err) {
    logger.error('Failed to evaluate AGENTS.md', err);
  }

  // 3. If there are changes, open a separate housekeeping PR
  if (changes.length === 0) {
    logger.info(`No housekeeping changes needed for ${job.owner}/${job.repo}`);
    return;
  }

  try {
    // Dedup: check if an open housekeeping PR already exists
    const existingPRs = await github.listPullRequests(job.owner, job.repo, {
      state: 'open',
      per_page: 30,
    });
    const existingHousekeepingPR = existingPRs.find(pr => pr.head.ref.startsWith('codra/housekeeping'));
    if (existingHousekeepingPR) {
      logger.info(`Skipping housekeeping PR: open PR #${existingHousekeepingPR.number} already exists on branch ${existingHousekeepingPR.head.ref}`);
      return;
    }

    // Create a new branch from the default branch's HEAD
    const defaultRef = await github.getRef(job.owner, job.repo, `heads/${defaultBranch}`);
    const branchName = `codra/housekeeping-${Date.now()}`;
    await github.createBranch(job.owner, job.repo, branchName, defaultRef.object.sha);
    logger.info(`Created housekeeping branch ${branchName} from ${defaultBranch} (${defaultRef.object.sha.slice(0, 8)})`);

    // Commit each change to the new branch
    for (const change of changes) {
      await github.createOrUpdateFileContents(job.owner, job.repo, change.path, {
        message: change.message,
        content: change.content,
        sha: change.existingSha,
        branch: branchName,
      });
      logger.info(`Committed ${change.path} to ${branchName}`);
    }

    // Open the PR
    const changedFiles = changes.map(c => `- \`${c.path}\``).join('\n');
    const housekeepingPR = await github.createPullRequest(job.owner, job.repo, {
      title: 'chore: codra housekeeping updates',
      body: `### Codra Housekeeping\n\nAutomated project standardization changes detected during review of PR #${job.prNumber}.\n\n**Changed files:**\n${changedFiles}\n\nThis PR was opened automatically by Codra and will be reviewed independently.`,
      head: branchName,
      base: defaultBranch,
    });
    logger.info(`Opened housekeeping PR #${housekeepingPR.number} (${housekeepingPR.html_url}) for ${job.owner}/${job.repo}`);
  } catch (err) {
    logger.error('Failed to open housekeeping PR', err);
  }
}
