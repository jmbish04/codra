import { logger } from './logger';
import { isSupportedGitHubWebhookEvent, type GitHubWebhookEventName, type GitHubWebhookPayload, type IssueCommentWebhookPayload, type PullRequestWebhookPayload } from '@shared/github';
import { BATCH_STEP_NAME, changelogModelOutputSchema, defaultRepoConfig, normalizeModelId, type BestPracticeCheck, type ParsedReviewComment, type RepoConfig, type ReviewJobMessage } from '@shared/schema';
import { getFileReviewsForJobs, recordRetryableFileReviewFailure, upsertFileReview, recordFileReviewCost } from '@server/db/file-reviews';
import { assertD1MigrationsCurrent } from '@server/db/migration-check';
import { getPricingSnapshot, buildCostBreakdown, sumBreakdown, type PricingSnapshot, type UsageAmounts } from '@server/core/guardian-pricing';
import { getProjectContext } from '@server/core/project-context';
import { withTimeout } from '@server/core/timeout';
import { getResolvedModelConfig } from '@server/db/model-configs';
import { claimJobLease, clearJobBatch, completeJob, completePreparationStep, countAutoReviewsForPr, failJob, findExistingJobForHead, getJobForProcessing, heartbeatJobLease, insertJob, mapJob, markJobCheckRunCompleted, markJobContinuationQueued, markPrClosed, MAX_AUTO_REVIEWS_PER_PR, recordJobBatch, releaseJobLease, supersedeOlderJobs, updateJobCheckRun, updateJobStatusComment, updateJobStep } from '@server/db/jobs';
import { parseFileReviewResponse } from '@server/core/model-output';
import { filterReviewableFiles, parseUnifiedDiff, renderFileDiff } from './diff';
import { planReviewers, selectFilePlanForBudget } from '@server/core/reviewer-plan';
import { REVIEWERS, buildReviewerSystemPrompt, type ReviewerId } from '@server/prompts/reviewers';
import { buildSharedContext } from '@server/core/shared-context';
import { aggregateReviewerResults, limitFinalReviewComments, type ReviewerCallResult } from '@server/core/reviewer-aggregate';
import { coordinateFindings, parseCoordinatorKeep, windowSourceLines } from '@server/core/coordinator';
import { COORDINATOR_SCHEMA } from '@server/models/schemas';
import { aggregateBestPracticeDocs } from '@server/core/best-practice-docs';
import { parseJsonColumn } from '@server/db/client';

import { GitHubService } from '../services/github';
import { GitHubClient } from './github';
import { isRetryableModelError, ModelService } from '../services/model';
import { FormatterService } from '../services/formatter';
import { TokenTracker } from './token-tracker';
import { loadRepoConfig } from './config';
import { getWebhookDelivery } from '@server/db/webhook-deliveries';
import { buildChangelogSlug, upsertChangelogEntry } from '@server/db/changelog';
import { getOrCreateRepository } from '@server/db/repositories';
import { buildChangelogPrompt, CHANGELOG_SYSTEM_PROMPT } from '@server/prompts/changelog';
import { listEnabledStandardizationRules, type StandardizationStrategy } from '@server/db/standardization';
import { applyStrategy, fetchSourceContent } from '@server/core/standardization';
import { recordAgentAction } from '@server/db/agent-actions';
import { getDismissedStandards } from '@server/db/dismissed-standards';
import { listEnabledStandardSecretBindings, recordMissingSecret } from '@server/db/secret-bindings';
import { notifyJobsChanged } from '@server/core/jobs-feed';
import { detectTestTargets } from '@server/core/test-detection';
import { runAndReportPrTests } from '@server/core/test-runner';
import { runDocsReview } from '@server/core/docs-review';
import { listSecretsStoreSecrets, ensureSecretBindings, type SecretBindingSpec } from '@server/core/secrets-store';
import { evaluateDocsGaps, buildJulesPrompt } from '@server/core/jules-docs-gap';
import { stageJulesSession } from '@server/db/jules-sessions';
import { ensureDeployWorkflow } from '@server/core/deploy-workflow';
import { emitReviewDatapoint, logReviewStep } from '@server/core/review-telemetry';
import { resolveEngine } from '@server/core/engine-selector';
import { CircuitBreaker } from '@server/core/circuit-breaker';
import type { EngineReviewResult, ReviewContext, ReviewEngine } from '@server/core/review-engine';
import { isRetryableOpenCodeError } from '@server/engines/opencode-client';
import { isRetryableComputerEngineError } from '@server/engines/computer-engine';

type PersistedReviewJob = ReturnType<typeof mapJob>;

export type ReviewJobRunResult = { action: 'ack' } | { action: 'retry'; delaySeconds: number };
export type ReviewPhase = 'prepare' | 'review' | 'finalize' | 'changelog';

const REVIEW_CHUNK_FILE_LIMIT = 3;
const REVIEW_CHUNK_WALL_CLOCK_MS = 12 * 60 * 1000;
const JOB_LEASE_SECONDS = 15 * 60;
const BUSY_RETRY_SECONDS = 60;
// Backoff between retries of a file that keeps hitting transient model/provider
// errors. Kept short on purpose: with MAX_RETRYABLE_FILE_REVIEW_FAILURES=3 this
// bounds the "frozen on the last file(s)" window to ~6min before the job
// finalizes as a partial review, instead of the ~21min a 15-minute tail caused.
const RETRYABLE_MODEL_FAILURE_RETRY_DELAYS_SECONDS = [30, 90, 4 * 60];
/** Workers AI batches typically land within ~5 minutes; poll on a steady beat. */
const BATCH_POLL_DELAY_SECONDS = 20;

/**
 * The async batch API trades minutes of queue latency for throughput and
 * rate-limit headroom, so it only pays off on large PRs. Smaller reviews finish
 * faster on the parallel synchronous path. Only submit a NEW batch at/above this
 * many pending files. ponytail: a flat threshold; make it config if repos vary.
 */
const BATCH_MIN_PENDING_FILES = 12;

const MAX_RETRYABLE_FILE_REVIEW_FAILURES = 3;

/** Mirrors each engine's own retryable classifier (connectivity/5xx/timeout
 *  trips the breaker + falls back to native; a non-retryable failure — e.g.
 *  auth/config — falls back too but leaves the breaker alone). */
function isRetryableEngineError(err: unknown): boolean {
  return isRetryableOpenCodeError(err) || isRetryableComputerEngineError(err);
}

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
  // A seeded 'pending' placeholder is NOT a completed review — it still needs to
  // be reviewed. (Treating it as handled skips the file entirely.)
  if (review.file_status === 'pending') return false;
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

/**
 * True if the webhook sender is a bot (GitHub App, Dependabot, etc.), not a
 * human user. Used to keep auto reviews from triggering/superseding on bot
 * pushes — only a human pushing code should kick off an auto review.
 */
export function isBotSender(
  sender: { login?: string; type?: string } | null | undefined,
  botUsername: string,
): boolean {
  if (!sender) return false;
  const login = (sender.login ?? '').toLowerCase();
  return sender.type === 'Bot'
    || /\[bot\]$/i.test(sender.login ?? '')
    || (botUsername ? login === botUsername.toLowerCase() : false);
}

export type ReviewRequest = {
  installationId: string;
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string | null;
  prAuthor: string | null;
  prCreatedAt: string | null;
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
    if (isBotSender(payload.sender, input.botUsername)) {
      return null;
    }

    return {
      installationId: String(payload.installation?.id ?? ''),
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      prNumber: payload.pull_request.number,
      prTitle: payload.pull_request.title,
      prAuthor: payload.pull_request.user.login,
      prCreatedAt: payload.pull_request.created_at ?? null,
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
      prCreatedAt: null,
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

  // The changelog runs against an already-completed job, so it deliberately
  // skips the lease: claimJobLease only admits queued/running jobs and would
  // reject a 'done' job as terminal. Persistence is an upsert keyed by slug,
  // so a duplicate delivery is harmless.
  if (resolved.phase === 'changelog') {
    return runChangelogJob(env, resolved.job);
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
  await assertD1MigrationsCurrent(env);

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
): Promise<{ job: PersistedReviewJob; phase: ReviewPhase } | null> {
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

  if (resolved.trigger === 'auto') {
    const autoCount = await countAutoReviewsForPr(env, {
      installationId: resolved.installationId,
      owner: resolved.owner, repo: resolved.repo, prNumber: resolved.prNumber,
    });
    if (autoCount >= MAX_AUTO_REVIEWS_PER_PR) {
      logger.info(`Auto-review cap reached for ${resolved.owner}/${resolved.repo} PR #${resolved.prNumber}; skipping.`);
      return null;
    }
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

  // The PR may have been merged/closed while this job sat in the queue. Don't
  // review a closed PR — cancel and stop.
  if (pr.state && pr.state !== 'open') {
    await cancelReviewsForClosedPr(env, github, { owner: job.owner, repo: job.repo, prNumber: job.prNumber }, pr.merged ? 'merged' : 'closed');
    // Job is now 'merged'/'closed'; reuse the supersede signal so the queue
    // consumer acks without retrying.
    throw new Error('JOB_SUPERSEDED');
  }

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
      const monitorLink = env.APP_URL ? `\n\n<a href="${env.APP_URL}/jobs/${job.id}" target="_blank" rel="noopener noreferrer">👉 Click here to monitor progress</a>` : '';
      const statusBody = `## \u{1F50D} Code Review\n\nCodra is reviewing this pull request. A summary will be posted here when the review is complete.${monitorLink}`;
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

  if (!hasCompletedStep(job, 'Docs Gap')) {
    try {
      await updateJobStep(env, job.id, 'Docs Gap', { status: 'running' });
      const config = (job.configSnapshot ?? defaultRepoConfig) as RepoConfig;
      if (config.review?.jules?.enabled !== false) {
        await evaluateAndStageJulesDocsTask(env, job, github, model, config);
      }
      await updateJobStep(env, job.id, 'Docs Gap', { status: 'done' });
    } catch (err) {
      logger.error('Failed to evaluate docs gap for Jules', err);
      await updateJobStep(env, job.id, 'Docs Gap', { status: 'failed', error: String(err) });
    }
  }

  if (!hasCompletedStep(job, 'Deploy Workflow')) {
    try {
      await updateJobStep(env, job.id, 'Deploy Workflow', { status: 'running' });
      const config = (job.configSnapshot ?? defaultRepoConfig) as RepoConfig;
      if (config.review?.deployWorkflow?.enabled !== false) {
        await ensureDeployWorkflow(env, job, github, config);
      }
      await updateJobStep(env, job.id, 'Deploy Workflow', { status: 'done' });
    } catch (err) {
      logger.error('Failed to ensure deploy workflow', err);
      await updateJobStep(env, job.id, 'Deploy Workflow', { status: 'failed', error: String(err) });
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

  // One rate snapshot per review chunk (KV-cached, ~0 subrequests) shared by
  // every file so all costs in this run price against the same rates.
  const pricing = await getPricingSnapshot(env, Date.now());

  // The repo's own instructions (AGENTS.md/CLAUDE.md) + declared stack
  // (wrangler bindings), fetched once and KV-cached, so every file review
  // respects the project's chosen technologies and conventions. Best-effort:
  // time-bounded so a slow GitHub read can never stall the review.
  const projectContext = await withTimeout(
    'project-context',
    12000,
    () => getProjectContext(env, github, job.owner, job.repo, pr.head.sha),
  ).catch((err) => {
    logger.warn('Project context unavailable; reviewing without it', err);
    return '';
  });

  // Which specialized reviewers (security/bugs/performance/...) fan out per
  // file, sized by PR risk tier. `sharedContext` is the PR-level context (title,
  // description, custom rules, project context) built once so its cache
  // breakpoint hits across every reviewer x file call instead of rebuilding it
  // per call.
  const plan = planReviewers(totalLineCount, files.length, config.review);
  const sharedContext = buildSharedContext({ pr, config, projectContext });

  // Bail before spending model calls if a newer commit superseded this job
  // while standardization / diff-fetch was running.
  await checkSuperseded(env, job.id);

  // Spec 2: delegate the whole-PR review to a healthy non-native engine
  // (opencode/computer) when one resolves. This is ONE logical call — the
  // engine does its own review remotely/in-DO, so it does NOT fan out
  // per-file model calls in this Worker invocation and doesn't need the
  // native loop's subrequest-budget gate below. Falls through to the
  // unchanged native loop on native resolution OR any delegation failure.
  const engine = await resolveEngine(env, config, Date.now());
  // Skip delegation while a native batch is already in flight (job.batchRequestId
  // set from a prior invocation) — a newly-healthy engine taking over here would
  // orphan that batch (never polled/cleared). Let runBatchReviewPhase below drain
  // it as usual; delegation resumes on a later invocation once it clears.
  if (!job.batchRequestId && await delegateToEngine(env, engine, job, pr, config, files, totalLineCount, sharedContext, model, pricing)) {
    return;
  }

  const jobIdsToQuery = [job.id];
  if (job.retryOfJobId) jobIdsToQuery.push(job.retryOfJobId);
  const allExistingReviews = await getFileReviewsForJobs(env, jobIdsToQuery);
  const currentReviews = new Map(allExistingReviews.filter((review) => review.job_id === job.id).map((review) => [review.file_path, review]));
  const parentReviews = new Map(allExistingReviews.filter((review) => review.job_id !== job.id && review.file_status === 'done').map((review) => [review.file_path, review]));

  const pendingFiles = files.filter((file) => {
    const existingReview = currentReviews.get(file.path);
    return !(existingReview && countsAsHandledFileReview(existingReview));
  });

  // Seed a pending row (with the file's diff) for every not-yet-recorded file so
  // the dashboard lists all files immediately and can show each diff while the
  // reviews are still in flight.
  for (const file of pendingFiles) {
    if (currentReviews.has(file.path)) continue;
    await upsertFileReview(env, job.id, {
      filePath: file.path,
      fileStatus: 'pending',
      modelUsed: 'pending',
      diffLineCount: file.lineCount,
      diffInput: renderFileDiff(file),
      rawAiOutput: null,
      parsedComments: [],
      inputTokens: null,
      outputTokens: null,
      durationMs: null,
      verdict: null,
      fileSummary: null,
      errorMessage: null,
    });
  }

  // Multi-reviewer fan-out (see reviewAndPersistFile) isn't wired into the batch
  // SUBMIT path yet — deferred; only single-reviewer PRs may submit a new
  // batch. Always call runBatchReviewPhase though, even when plan.length > 1:
  // it also owns draining (poll/persist/clear) an ALREADY-SUBMITTED batch from
  // a prior invocation, and skipping the call entirely would leave that batch
  // dangling forever (never polled, never cleared) if the job's plan grew
  // past 1 reviewer between invocations (e.g. a config change or a diff
  // update crossing a risk tier).
  if (await runBatchReviewPhase(env, job, leaseOwner, github, model, { pr, config, files, pendingFiles, totalLineCount, projectContext, allowNewBatch: plan.length <= 1 })) {
    return;
  }

  const reviewTasks: Array<Promise<void>> = [];
  // Optional: the module-mocked ModelService used in some tests doesn't
  // implement getTracker(), so this stays undefined there and the budget
  // gate below simply no-ops (matches the tracker-less TokenTracker usage
  // pattern already used elsewhere in this file, e.g. GitHubClient/model.ts).
  const tracker = model.getTracker?.();
  // Subrequests already reserved for files kicked off in parallel this chunk.
  // Without this, each file's gate sees the same stale counter and up to
  // REVIEW_CHUNK_FILE_LIMIT files can all pass hasRemainingSubrequests at once.
  let reservedSubrequestsThisChunk = 0;

  // 30s heartbeat for the (potentially minutes-long) reviewer fan-out below:
  // extends the lease + nudges the check-run so a stalled check doesn't read
  // as a hung job. `last` is shared across every concurrently-running
  // file/reviewer task this chunk; whichever call crosses the 30s mark first
  // fires it, which is fine for a UX heartbeat.
  //
  // Deliberately NOT heartbeatAndCheckSuperseded / checkSuperseded here: those
  // throw JOB_SUPERSEDED to abort the job, but this heartbeat runs inside
  // reviewAndPersistFile's per-file try/catch (and, in the fan-out path,
  // inside a Promise.allSettled reviewer mapper) — a throw there either gets
  // mis-persisted as a failed file review or silently swallowed by a sibling
  // reviewer's success. The chunk-boundary heartbeatAndCheckSuperseded below
  // (after Promise.allSettled(reviewTasks)) remains the sole supersession
  // abort point for this loop; this heartbeat only ever refreshes the lease
  // and pings the check-run, and never throws into the review path.
  const heartbeatState = { last: Date.now() };
  const maybeHeartbeat = async () => {
    if (Date.now() - heartbeatState.last < 30_000) return;
    heartbeatState.last = Date.now();
    logReviewStep({ jobId: job.id, phase: 'review', model: 'heartbeat', durationMs: 0, findings: 0 });
    await heartbeatJobLease(env, job.id, leaseOwner, JOB_LEASE_SECONDS).catch((err) => logger.warn('Heartbeat lease refresh failed (ignored)', err));
    if (job.checkRunId) {
      await github.updateCheckRun(job.owner, job.repo, job.checkRunId, {
        title: 'Reviewing…',
        summary: 'Reviewing… (model thinking)',
      }).catch((err) => logger.warn('Heartbeat check-run update failed (ignored)', err));
    }
  };

  for (const file of files) {
    const existingReview = currentReviews.get(file.path);
    if (existingReview && countsAsHandledFileReview(existingReview)) {
      continue;
    }

    const inherited = parentReviews.get(file.path);
    const willCallModel = !inherited || !canInheritParentFileReview(config, inherited);

    // Budget-aware gate: stop starting new files' reviewer fan-out once this
    // invocation's subrequest budget can't fit the next one, so a large PR
    // spreads its model calls across invocations instead of risking
    // Cloudflare's 50-subrequest cap. See selectFilePlanForBudget for the
    // trivial-tier degrade-instead-of-stall fallback.
    let filePlan = plan;
    if (willCallModel && tracker) {
      const decision = selectFilePlanForBudget(
        plan,
        processedThisChunk,
        (needed) => tracker.hasRemainingSubrequests(needed + reservedSubrequestsThisChunk),
      );
      if (decision.action === 'defer') break;
      filePlan = decision.plan;
      reservedSubrequestsThisChunk += filePlan.length + 2;
      if (filePlan !== plan) {
        logger.warn(`Reviewer plan (${plan.length}) doesn't fit the subrequest budget for ${file.path}; using reduced set`, {
          reduced: filePlan,
          subrequestsUsed: tracker.getSubrequestCount(),
        });
      }
    }

    const reviewTask = async () => {
      if (!inherited) {
        await reviewAndPersistFile(env, job, file, pr, config, totalLineCount, model, pricing, projectContext, sharedContext, filePlan, resolveFailureModelProvider, maybeHeartbeat, existingReview);
        return;
      }

      if (!canInheritParentFileReview(config, inherited)) {
        logger.info(`Ignoring inherited review for ${file.path}; parent model ${inherited.model_used} is not in the current model strategy`);
        await reviewAndPersistFile(env, job, file, pr, config, totalLineCount, model, pricing, projectContext, sharedContext, filePlan, resolveFailureModelProvider, maybeHeartbeat, existingReview);
      } else {
        const inheritedComments = inherited.parsed_comments as ParsedReviewComment[];
        const inheritedBestPracticeChecks = parseJsonColumn<BestPracticeCheck[]>(inherited.best_practice_checks, []);
        const fileReviewId = await upsertFileReview(env, job.id, {
          filePath: file.path,
          fileStatus: 'done',
          modelUsed: inherited.model_used,
          modelProvider: inherited.model_provider,
          diffLineCount: inherited.diff_line_count ?? 0,
          diffInput: inherited.diff_input,
          rawAiOutput: inherited.raw_ai_output,
          parsedComments: inheritedComments,
          inputTokens: inherited.input_tokens,
          outputTokens: inherited.output_tokens,
          durationMs: inherited.duration_ms,
          verdict: inherited.verdict as any,
          fileSummary: inherited.file_summary,
          overallCorrectness: inherited.overall_correctness,
          bestPracticeChecks: inheritedBestPracticeChecks,
          confidenceScore: inherited.confidence_score,
          errorMessage: null,
        });
        // Re-price the inherited tokens for this job's own ledger (no new model
        // call, so no DO streaming / fresh subrequests attributed here).
        await recordFileCost(env, pricing, {
          fileReviewId,
          jobId: job.id,
          modelUsed: inherited.model_used,
          usage: {
            aiInputTokens: inherited.input_tokens ?? 0,
            aiOutputTokens: inherited.output_tokens ?? 0,
            doRequests: 0,
            doDurationGbs: 0,
            d1RowsWritten: 1 + inheritedComments.length,
            d1RowsRead: 2,
            subrequests: 0,
          },
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
    projectContext: string;
    /** False when the current reviewer plan has >1 reviewer (fan-out isn't
     *  wired into the batch SUBMIT path yet). An already-submitted batch from
     *  a prior invocation is still polled/persisted/cleared below regardless —
     *  only the "start a NEW batch" branch is gated on this. */
    allowNewBatch: boolean;
  },
) {
  const { pr, config, files, pendingFiles, totalLineCount, projectContext, allowNewBatch } = ctx;

  if (job.batchRequestId && job.batchModel) {
    let result: Awaited<ReturnType<ModelService['pollReviewBatch']>>;
    try {
      result = await model.pollReviewBatch(job.batchModel, job.batchRequestId);
    } catch (error) {
      if (isRetryableModelError(error)) throw error;
      // An unrecognised batch response must not strand the job: drop the batch
      // and let the synchronous path review the outstanding files instead.
      logger.error('Batch poll failed; abandoning the batch and falling back to synchronous review', error);
      await clearJobBatch(env, job.id);
      await updateJobStep(env, job.id, BATCH_STEP_NAME, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }

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
    await updateJobStep(env, job.id, BATCH_STEP_NAME, { status: 'done' });
    // Re-run the review phase so the existing completeness check decides
    // whether to finalize or retry any files the batch could not review.
    await enqueueJobPhase(env, job.id, 'review');
    return true;
  }

  if (!allowNewBatch) return false;
  if (pendingFiles.length === 0) return false;

  // Small/medium PRs review faster on the parallel sync path than on the async
  // batch queue — only batch when there are enough files to make it worthwhile.
  if (pendingFiles.length < BATCH_MIN_PENDING_FILES) return false;

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
        projectContext,
      }),
    ),
  );

  let requestId: string | null;
  try {
    requestId = await model.submitReviewBatch(
      batchModel,
      prompts.map((prompt) => ({ systemPrompt: prompt.systemPrompt, userPrompt: prompt.userPrompt })),
    );
  } catch (error) {
    if (isRetryableModelError(error)) throw error;
    // The batch API is an optimisation, not a requirement: if submit behaves
    // unexpectedly, degrade to the proven synchronous path rather than failing
    // a review that would otherwise succeed.
    logger.error('Batch submit failed; falling back to synchronous review', error);
    return false;
  }
  if (!requestId) return false;

  await recordJobBatch(env, job.id, {
    requestId,
    model: batchModel,
    filePaths: pendingFiles.map((file) => file.path),
  });
  await updateJobStep(env, job.id, BATCH_STEP_NAME, { status: 'running' });
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
        bestPracticeChecks: parsed.bestPracticeChecks ?? [],
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

/**
 * Convert Durable Object active wall-time (ms) into billable GB-seconds at the
 * default 128MB DO class, so the metered amount lines up with how Cloudflare
 * prices DO duration.
 */
const DO_MEMORY_GB = 128 / 1024;
function msToGbSeconds(ms: number): number {
  return (ms / 1000) * DO_MEMORY_GB;
}

/**
 * Price a single file review's metered usage and store the per-usage-type
 * breakdown + file rollup. Best-effort: a pricing failure must never fail the
 * review itself, so it's logged and swallowed.
 */
async function recordFileCost(
  env: Env,
  pricing: PricingSnapshot,
  args: { fileReviewId: string; jobId: string; modelUsed: string | null; usage: UsageAmounts },
) {
  try {
    const rows = buildCostBreakdown(pricing, args.modelUsed, args.usage);
    await recordFileReviewCost(env, {
      fileReviewId: args.fileReviewId,
      jobId: args.jobId,
      rows,
      totalCostUsd: sumBreakdown(rows),
    });
  } catch (err) {
    logger.warn(`Failed to record cost for file review ${args.fileReviewId}`, err);
  }
}

/**
 * Persists a delegated engine's whole-PR result as one file review row per
 * file (mirrors reviewAndPersistFile's persistence tail: upsertFileReview →
 * batched single-fetch DO stream → recordFileCost), grouping `result.comments`
 * and `result.perReviewer` usage by path. Only ever called after
 * `engine.reviewPullRequest` has fully succeeded, so a failed delegation never
 * leaves half-persisted rows behind for the native fallback to skip over.
 */
async function persistEngineResult(
  env: Env,
  job: PersistedReviewJob,
  files: ReturnType<typeof parseUnifiedDiff>,
  result: EngineReviewResult,
  engineName: string,
  pricing: PricingSnapshot,
): Promise<void> {
  // ONE batched fetch for every comment across every file, not one fetch per
  // file (reviewAndPersistFile's native-loop pattern) — delegation already
  // has the whole PR's findings in memory from the single engine call, and a
  // per-file fetch would blow Cloudflare's 50-subrequest cap on a large PR
  // (the native loop avoids this the same way it avoids per-file model calls
  // exceeding budget: REVIEW_CHUNK_FILE_LIMIT). This keeps the delegation
  // path's subrequests at ~1 (reviewPullRequest) + 1 (DO) regardless of PR size.
  let doRequests = 0;
  let doDurationGbs = 0;
  if (result.comments.length > 0) {
    const doStartedAt = Date.now();
    try {
      const streamId = (env as any).PrReviewStream.idFromName(`${job.owner}/${job.repo}/${job.prNumber}`);
      const streamStub = (env as any).PrReviewStream.get(streamId);
      await streamStub.fetch(new Request('http://do/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result.comments),
      }));
      doRequests = 1;
    } catch (streamErr) {
      logger.error('Failed to stream real-time comments to Durable Object', streamErr);
    }
    doDurationGbs = msToGbSeconds(Date.now() - doStartedAt);
  }

  // recordFileCost only has a fileReviewId to hang cost rows off (there's no
  // job-level cost row), so the single batched DO fetch above is charged to
  // whichever file review is written first — every other file gets 0 DO
  // subrequests recorded — instead of double/triple-counting it per file.
  let doCostAttributed = false;

  for (const file of files) {
    const fileComments = result.comments.filter((c) => c.path === file.path);
    const usage = result.perReviewer
      .filter((u) => u.file === file.path)
      .reduce(
        (acc, u) => ({
          inputTokens: acc.inputTokens + u.inputTokens,
          outputTokens: acc.outputTokens + u.outputTokens,
          cacheReadTokens: acc.cacheReadTokens + u.cacheReadTokens,
          cacheWriteTokens: acc.cacheWriteTokens + u.cacheWriteTokens,
        }),
        { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      );

    // A mid-loop D1 failure here (upsertFileReview/recordFileCost throwing)
    // leaves this and later files unpersisted with earlier files already
    // done — self-healing: countsAsHandledFileReview only skips files that
    // already succeeded, so a retry/requeue re-delegates or falls to native
    // for whatever's left, same as any other partial-chunk failure in this file.
    const fileReviewId = await upsertFileReview(env, job.id, {
      filePath: file.path,
      fileStatus: 'done',
      modelUsed: engineName,
      modelProvider: engineName,
      engineUsed: engineName,
      diffLineCount: file.lineCount,
      diffInput: renderFileDiff(file),
      rawAiOutput: null,
      parsedComments: fileComments,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      durationMs: null,
      verdict: fileComments.length ? 'comment' : 'approve',
      fileSummary: null,
      overallCorrectness: null,
      confidenceScore: null,
      errorMessage: null,
    });

    await recordFileCost(env, pricing, {
      fileReviewId,
      jobId: job.id,
      modelUsed: engineName,
      usage: {
        aiInputTokens: usage.inputTokens,
        aiOutputTokens: usage.outputTokens,
        doRequests: doCostAttributed ? 0 : doRequests,
        doDurationGbs: doCostAttributed ? 0 : doDurationGbs,
        d1RowsWritten: 1 + fileComments.length,
        d1RowsRead: 2,
        subrequests: doCostAttributed ? 0 : doRequests,
      },
    });
    doCostAttributed = true;
  }
}

/**
 * Spec 2 delegation branch: hands the whole PR to a resolved non-native
 * engine in one call. Returns true when the engine succeeded and the review
 * is fully persisted (caller should return without running the native loop);
 * false when `engine` resolved to native, or the engine call failed and the
 * caller must fall through to the native per-file loop unchanged.
 *
 * Breaker semantics mirror resolveEngine's own convention: only a retryable
 * (connectivity/5xx/timeout) failure trips the breaker; a non-retryable one
 * (e.g. bad config) still falls back to native but leaves the breaker alone.
 */
async function delegateToEngine(
  env: Env,
  engine: ReviewEngine,
  job: PersistedReviewJob,
  pr: Awaited<ReturnType<GitHubService['getPullRequest']>>,
  config: RepoConfig,
  files: ReturnType<typeof parseUnifiedDiff>,
  totalLineCount: number,
  sharedContext: string,
  model: ModelService,
  pricing: PricingSnapshot,
): Promise<boolean> {
  if (engine.name === 'native') return false;

  const breaker = new CircuitBreaker(env.APP_KV, engine.name);
  try {
    const ctx: ReviewContext = {
      env,
      job: { id: job.id, owner: job.owner, repo: job.repo, prNumber: job.prNumber },
      pr: { title: pr.title ?? null, body: pr.body ?? null, head: { sha: pr.head.sha } },
      config,
      files,
      totalLineCount,
      sharedContext,
      model,
    };
    const result = await engine.reviewPullRequest(ctx);
    await persistEngineResult(env, job, files, result, engine.name, pricing);
    await breaker.recordSuccess();
    await updateJobStep(env, job.id, 'Reviewing Files', { status: 'done' });
    await enqueueJobPhase(env, job.id, 'finalize');
    return true;
  } catch (err) {
    if (isRetryableEngineError(err)) await breaker.recordFailure(Date.now());
    logger.error(`Engine '${engine.name}' review failed; falling back to native`, err);
    return false;
  }
}

async function reviewAndPersistFile(
  env: Env,
  job: PersistedReviewJob,
  file: ReturnType<typeof parseUnifiedDiff>[number],
  pr: Awaited<ReturnType<GitHubService['getPullRequest']>>,
  config: RepoConfig,
  totalLineCount: number,
  model: ModelService,
  pricing: PricingSnapshot,
  projectContext: string,
  sharedContext: string,
  plan: ReviewerId[],
  resolveFailureModelProvider: () => Promise<string | null>,
  onHeartbeat: () => Promise<void>,
  previousReview?: { transient_error_count: number },
) {
  const startedAt = Date.now();
  const compactPrompt = (previousReview?.transient_error_count ?? 0) > 0;
  try {
    let modelUsed: string;
    let provider: string;
    let rawText: string;
    let comments: ParsedReviewComment[];
    let verdict: 'approve' | 'comment';
    let fileSummary: string | null | undefined;
    let overallCorrectness: string | null | undefined;
    let confidenceScore: number | null | undefined;
    let inputTokens: number;
    let outputTokens: number;
    let cacheReadTokens: number | null;
    let cacheWriteTokens: number | null;
    let reviewerCallCount: number;
    let bestPracticeChecks: BestPracticeCheck[] = [];

    if (plan.length <= 1) {
      // Legacy single-call path — behavior here is byte-identical to before the
      // reviewer fan-out; only engineUsed/cache token bookkeeping is new.
      const response = await model.reviewFile({
        file,
        prTitle: pr.title ?? null,
        prDescription: pr.body ?? null,
        config,
        totalLineCount,
        compactPrompt,
        projectContext,
      });
      modelUsed = response.modelUsed;
      provider = response.provider;
      rawText = response.rawText;
      comments = response.parsed.comments;
      verdict = response.parsed.verdict;
      fileSummary = response.parsed.fileSummary;
      overallCorrectness = response.parsed.overallCorrectness;
      confidenceScore = response.parsed.confidenceScore;
      bestPracticeChecks = response.parsed.bestPracticeChecks ?? [];
      inputTokens = response.inputTokens;
      outputTokens = response.outputTokens;
      cacheReadTokens = response.cacheReadTokens ?? null;
      cacheWriteTokens = response.cacheWriteTokens ?? null;
      reviewerCallCount = 1;
      logReviewStep({
        jobId: job.id, phase: 'review', model: modelUsed,
        durationMs: Date.now() - startedAt, findings: comments.length,
        inputTokens, outputTokens, cacheReadTokens: cacheReadTokens ?? undefined, cacheWriteTokens: cacheWriteTokens ?? undefined,
      });
      await onHeartbeat();
    } else {
      // Fan out to the planned specialized reviewers (security/bugs/perf/...)
      // and combine their findings into one file review record. sharedContext
      // already carries the project context, so pass '' here to avoid
      // duplicating it in every reviewer's prompt.
      //
      // allSettled (not all): one reviewer throwing shouldn't discard every
      // OTHER reviewer's already-paid-for result and force a full re-run of
      // all N reviewers on retry (up to Nx cost amplification on a single
      // transient hiccup). Proceed with whichever reviewers succeeded; only
      // fail the file if every reviewer failed.
      const settled = await Promise.allSettled(
        plan.map(async (id): Promise<ReviewerCallResult> => {
          const callStartedAt = Date.now();
          const response = await model.reviewFile({
            file,
            prTitle: pr.title ?? null,
            prDescription: pr.body ?? null,
            config,
            totalLineCount,
            compactPrompt,
            projectContext: '',
            systemPromptOverride: buildReviewerSystemPrompt(REVIEWERS[id], config.review),
            cacheSystem: true,
            sharedContext,
          });
          logReviewStep({
            jobId: job.id, phase: 'review', reviewer: id, model: response.modelUsed,
            durationMs: Date.now() - callStartedAt, findings: response.parsed.comments?.length ?? 0,
            inputTokens: response.inputTokens, outputTokens: response.outputTokens,
            cacheReadTokens: response.cacheReadTokens ?? undefined, cacheWriteTokens: response.cacheWriteTokens ?? undefined,
          });
          await onHeartbeat();
          return {
            reviewer: id,
            parsed: response.parsed,
            modelUsed: response.modelUsed,
            provider: response.provider,
            rawText: response.rawText,
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
            cacheReadTokens: response.cacheReadTokens,
            cacheWriteTokens: response.cacheWriteTokens,
          };
        }),
      );

      const results: ReviewerCallResult[] = [];
      const failedReviewers: string[] = [];
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          failedReviewers.push(plan[index]);
          logger.warn(`Reviewer ${plan[index]} failed for ${file.path}`, {
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
      });

      if (results.length === 0) {
        // Every reviewer failed — surface the first failure so this file goes
        // through the exact same retry/hard-limit handling as a single-call
        // failure would (the outer try/catch below).
        throw (settled.find((r): r is PromiseRejectedResult => r.status === 'rejected') as PromiseRejectedResult).reason;
      }
      if (failedReviewers.length > 0) {
        logger.warn(`Proceeding with ${results.length}/${plan.length} reviewers for ${file.path}; ${failedReviewers.join(', ')} failed and will be missing from this pass`);
      }

      const aggregate = aggregateReviewerResults(results);
      modelUsed = aggregate.modelUsed;
      provider = aggregate.provider;
      rawText = aggregate.rawText;
      comments = aggregate.comments;
      verdict = aggregate.verdict;
      fileSummary = aggregate.fileSummary;
      overallCorrectness = aggregate.overallCorrectness;
      confidenceScore = aggregate.confidenceScore;
      bestPracticeChecks = aggregate.bestPracticeChecks;
      inputTokens = aggregate.inputTokens;
      outputTokens = aggregate.outputTokens;
      cacheReadTokens = aggregate.cacheReadTokens;
      cacheWriteTokens = aggregate.cacheWriteTokens;
      reviewerCallCount = plan.length;
    }

    const fileReviewId = await upsertFileReview(env, job.id, {
      filePath: file.path,
      fileStatus: 'done',
      modelUsed,
      modelProvider: provider,
      diffLineCount: file.lineCount,
      diffInput: renderFileDiff(file),
      rawAiOutput: rawText,
      parsedComments: comments,
      inputTokens,
      outputTokens,
      durationMs: Date.now() - startedAt,
      verdict,
      fileSummary: fileSummary ?? null,
      overallCorrectness,
      bestPracticeChecks,
      confidenceScore,
      errorMessage: null,
      engineUsed: 'native',
      cacheReadTokens,
      cacheWriteTokens,
    });

    comments = comments ?? [];
    let doRequests = 0;
    let doDurationGbs = 0;
    // Measure only the DO streaming loop — capturing the start before the
    // zero-comment guard would bill downstream work (recordFileCost etc.) as
    // DO time even when the Durable Object is never contacted.
    //
    // Batched into ONE fetch carrying the whole file's comment array (the DO
    // broadcasts them individually over the websocket internally — see
    // pr-stream.ts) instead of one fetch per comment. A fan-out file can have
    // up to max_comments x reviewer-count findings; one subrequest per file
    // (not per comment) keeps this well under Cloudflare's 50-subrequest cap.
    if (comments.length > 0) {
      const doStartedAt = Date.now();
      try {
        const streamId = (env as any).PrReviewStream.idFromName(`${job.owner}/${job.repo}/${job.prNumber}`);
        const streamStub = (env as any).PrReviewStream.get(streamId);
        await streamStub.fetch(new Request('http://do/comment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(comments),
        }));
        doRequests += 1;
      } catch (streamErr) {
        logger.error('Failed to stream real-time comments to Durable Object', streamErr);
      }
      doDurationGbs = msToGbSeconds(Date.now() - doStartedAt);
    }

    // Metered per-file usage. AI tokens are exact (summed across every
    // reviewer call when fanned out); DO requests are the exact count of
    // stream fetches with measured active duration; D1 rows are the rows this
    // file's persistence writes/reads; subrequests = one per reviewer model
    // call + DO fetches. ponytail: D1 rows are counted from the write shape (1
    // review row + N comment rows), not the D1 `meta` field — dollars here are
    // rounding level; swap to result.meta.rows_read/written if precision ever
    // matters.
    await recordFileCost(env, pricing, {
      fileReviewId,
      jobId: job.id,
      modelUsed,
      usage: {
        aiInputTokens: inputTokens ?? 0,
        aiOutputTokens: outputTokens ?? 0,
        doRequests,
        doDurationGbs,
        d1RowsWritten: 1 + comments.length,
        d1RowsRead: 2,
        subrequests: reviewerCallCount + doRequests,
      },
    });
  } catch (error) {
    // A supersede signal must never be downgraded to a 'failed' file review —
    // rethrow so it propagates to runReviewPhase's caller the same way every
    // other checkSuperseded/heartbeatAndCheckSuperseded call site already
    // does. (Defensive: nothing in this function currently throws
    // JOB_SUPERSEDED itself, but this guard makes that invariant hold even if
    // that changes.)
    if (error instanceof Error && error.message === 'JOB_SUPERSEDED') throw error;

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
      // Per-invocation budget exhaustion (subrequests / allocation). Retrying in
      // a fresh invocation usually clears it — but a single file that busts the
      // budget on EVERY attempt would re-throw forever and freeze the job on
      // that file. Bound it: count attempts and, past the cap, mark the file
      // failed so the job finalizes as a partial review instead of looping.
      const failureCount = await recordRetryableFileReviewFailure(env, job.id, {
        filePath: file.path,
        modelUsed: modelId,
        modelProvider,
        diffLineCount: file.lineCount,
        diffInput: '',
        durationMs: Date.now() - startedAt,
        // "retrying later" keeps it retryable-classified so it re-attempts in a
        // fresh invocation until the cap below.
        errorMessage: `${errorMessage} — resource limit, retrying later`,
      });

      if (failureCount >= MAX_RETRYABLE_FILE_REVIEW_FAILURES) {
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
          errorMessage: `Review skipped after ${failureCount} attempts that exceeded the per-invocation resource limit. The file may be too large to review in one pass.`,
        });
        logger.error(`File ${file.path} permanently skipped after repeated hard-limit failures`, { attempts: failureCount });
        return;
      }

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

  const reviewByPath = new Map(reviews.map((review) => [review.file_path, review]));
  const incompleteFiles = files.some((file) => {
    const review = reviewByPath.get(file.path);
    return !review || !countsAsHandledFileReview(review);
  });
  if (incompleteFiles) {
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

  // Coordinator pass: dedup + reasonableness + source-verify across all
  // findings before the severity/max_comments cut. Best-effort — any failure
  // here must never lose the review, so it falls back to the un-coordinated
  // findings on any error.
  let coordinatedComments = reviewedComments;
  if (reviewedComments.length > 1) {
    try {
      const coordinatorTracker = new TokenTracker();
      const model = new ModelService(env, coordinatorTracker, { jobId: job.id });
      const projectContext = await withTimeout(
        'project-context',
        12000,
        () => getProjectContext(env, github, job.owner, job.repo, pr.head.sha),
      ).catch((err) => {
        logger.warn('Project context unavailable; coordinating without it', err);
        return '';
      });
      const sharedContext = buildSharedContext({ pr, config, projectContext });
      const coordinatorModel = config.review.coordinator ?? config.model?.main ?? null;

      const sourceCache = new Map<string, string | null>();
      const fetchSource = async (path: string, line: number | null): Promise<string | null> => {
        if (!sourceCache.has(path)) {
          const result = await github.getRepoFileWithRefOrNull(job.owner, job.repo, path, pr.head.sha).catch(() => null);
          sourceCache.set(path, result?.content ?? null);
        }
        const content = sourceCache.get(path) ?? null;
        return content ? windowSourceLines(content, line) : null;
      };

      const runModel = coordinatorModel
        ? async (system: string, user: string) => {
            const resp = await model.callModel(coordinatorModel, { systemPrompt: system, userPrompt: user }, COORDINATOR_SCHEMA);
            return parseCoordinatorKeep(resp.rawText);
          }
        : async () => { throw new Error('No coordinator model configured'); };

      coordinatedComments = await coordinateFindings({ comments: reviewedComments, sharedContext, runModel, fetchSource });
    } catch (err) {
      logger.error('Coordinator pass failed; using un-coordinated findings', err);
      coordinatedComments = reviewedComments;
    }
  }

  const { comments: finalComments, omittedCount } = limitFinalReviewComments(
    coordinatedComments,
    config.review.min_severity,
    config.review.max_comments,
  );

  const verdictSummary = formatter.summarizeVerdict(finalComments, hasFailures);
  await updateJobStep(env, job.id, 'Generating Summary', { status: 'done' });
  await heartbeatAndCheckSuperseded(env, job.id, leaseOwner);

  let formattedSummary = formatter.formatReviewOverview(pr.head.sha, env.BOT_USERNAME, finalComments, job.id);
  
  if (omittedCount > 0) {
    formattedSummary += `\n\n> [!NOTE]\n> **${omittedCount} comments were omitted** from this review to reduce noise and respect the configured \`max_comments\` limit (${config.review.max_comments}). Showing the most critical issues.`;
  }

  // Tell a human (or an AI agent) exactly which files carry inline comments, how
  // many, and where to read them — so they know to look on the PR itself and not
  // only in the summary body.
  if (finalComments.length > 0) {
    const countsByFile = new Map<string, number>();
    for (const comment of finalComments) {
      countsByFile.set(comment.path, (countsByFile.get(comment.path) ?? 0) + 1);
    }
    const fileLines = Array.from(countsByFile.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([path, count]) => `> - \`${path}\` — ${count} comment${count === 1 ? '' : 's'}`)
      .join('\n');
    const jobLink = env.APP_URL
      ? `\n>\n> 🔗 [View all findings on Codra](${env.APP_URL.replace(/\/+$/, '')}/jobs/${job.id})`
      : '';
    formattedSummary += `\n\n> [!IMPORTANT]\n> **Codra left ${finalComments.length} inline comment${finalComments.length === 1 ? '' : 's'}** across ${countsByFile.size} file${countsByFile.size === 1 ? '' : 's'} on this pull request. Fetch this PR's review comments to read them inline:\n${fileLines}${jobLink}`;
  }

  // Phase 3: collate best-practice checks across the PR's files and attach a
  // static Cloudflare-docs snapshot for each violated practice. Best-effort.
  try {
    await aggregateBestPracticeDocs(env, job.id);
  } catch (err) {
    logger.warn('best-practice docs aggregation failed', { jobId: job.id, error: err instanceof Error ? err.message : String(err) });
  }

  await updateJobStep(env, job.id, 'Completing', { status: 'running' });
  const review = await github.createReview(job.owner, job.repo, job.prNumber, {
    commitSha: pr.head.sha,
    event: formatter.toReviewEvent(verdictSummary.verdict),
    body: formattedSummary,
    comments: finalComments.map(comment => ({
      path: comment.path,
      line: comment.line ?? undefined,
      side: 'RIGHT',
      position: comment.position ?? undefined,
      body: formatter.formatInlineComment(comment),
    })),
  });

  // If this PR was opened by a live Jules session and the review explicitly
  // requests changes (verdict 'comment' — NOT an approve, and not a 'failed'
  // partial where files couldn't be reviewed), direct the corrections to Jules
  // over the SDK too (indexed in jules_interactions), not just as PR comments —
  // best-effort, never blocks the review.
  if (verdictSummary.verdict === 'comment' && finalComments.length > 0) {
    const { directCorrectionsToJules } = await import('@server/core/jules-pr-correction');
    await directCorrectionsToJules(env, github, {
      owner: job.owner, repo: job.repo, prNumber: job.prNumber,
      comments: finalComments.map((c) => ({ path: c.path, line: c.line, severity: c.severity, title: c.title, body: c.body })),
    }).catch(() => {});
  }

  // Build codra's running list of read-only endpoints / MCP tools / frontend
  // pages this PR touched, then test the API ones and report back (best-effort).
  const testJob = { id: job.id, owner: job.owner, repo: job.repo, prNumber: job.prNumber };
  const detected = await detectTestTargets(env, github, testJob, config);
  if (detected > 0) {
    await runAndReportPrTests(env, github, testJob);
  }

  // Cloudflare-docs review: check the PR against the official docs for any
  // configured triggers, recording gotchas as pending best practices.
  await runDocsReview(env, github, testJob, config);

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
  const fileCostTotal = reviews.reduce((sum, review) => sum + (review.total_cost_usd ?? 0), 0);

  // Observability: one Analytics Engine datapoint per completed review. Never
  // allowed to affect the review outcome — emitReviewDatapoint itself never
  // throws, and the metrics computation is wrapped too since it's pure
  // bookkeeping on data already validated above.
  try {
    const cacheReadTokens = reviews.reduce((sum, review) => sum + (review.cache_read_tokens ?? 0), 0);
    const cacheWriteTokens = reviews.reduce((sum, review) => sum + (review.cache_write_tokens ?? 0), 0);
    const cacheDenom = cacheReadTokens + fileInputTokens;
    const totalLineCount = files.reduce((sum, file) => sum + file.lineCount, 0);
    const engineUsed = reviews.find((review) => review.engine_used)?.engine_used ?? 'native';
    emitReviewDatapoint(env, {
      repo: `${job.owner}/${job.repo}`,
      engine: engineUsed,
      reviewers: planReviewers(totalLineCount, files.length, config.review).join(','),
      verdict: verdictSummary.verdict,
      // ponytail: breaker state isn't threaded through per-review yet — the
      // persisted engine_used already tells us which engine served this PR
      // (and native means no breaker was ever touched), so reuse it rather
      // than plumbing open/closed through resolveEngine -> runReviewPhase ->
      // here for a datapoint field. Upgrade if a future job wants the exact
      // breaker open/closed bit at emit time.
      breakerState: engineUsed,
      findings: finalComments.length,
      p0: finalComments.filter((c) => c.severity === 'P0').length,
      p1: finalComments.filter((c) => c.severity === 'P1').length,
      inputTokens: fileInputTokens,
      outputTokens: fileOutputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      cacheHitRate: cacheDenom > 0 ? cacheReadTokens / cacheDenom : 0,
      costUsd: fileCostTotal,
      durationMs: job.startedAt ? Date.now() - Date.parse(job.startedAt) : 0,
    });
  } catch (err) {
    logger.warn('Failed to compute review telemetry metrics (ignored)', err);
  }

  const partialErrorMessage = hasFailures
    ? `Partial review: ${failedFileCount} of ${files.length} file${files.length === 1 ? '' : 's'} could not be reviewed after repeated model/provider outages.`
    : null;
  await completeJob(env, job.id, {
    verdict: verdictSummary.verdict,
    fileCount: files.length,
    commentCount: finalComments.length,
    totalInputTokens: fileInputTokens,
    totalOutputTokens: fileOutputTokens,
    totalCostUsd: fileCostTotal,
    summaryMarkdown: formattedSummary,
    reviewId: review.id,
    summaryModel: null,
    errorMessage: partialErrorMessage,
  });
  logger.info(`Review job completed: ${job.owner}/${job.repo} PR #${job.prNumber}`);

  // Changelog generation runs as its own phase: it must not consume finalize's
  // wall-clock budget, and a failure there must not fail the shipped review.
  await enqueueJobPhase(env, job.id, 'changelog');

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

// Throws JOB_SUPERSEDED if a newer commit/job has taken over this PR, or the PR
// was merged/closed, so the current invocation stops before spending more model
// calls on stale code.
async function checkSuperseded(env: Env, jobId: string) {
  const currentJob = await getJobForProcessing(env, jobId);
  if (currentJob && ['superseded', 'merged', 'closed'].includes(currentJob.status)) {
    throw new Error('JOB_SUPERSEDED');
  }
}

/**
 * Runs the changelog phase for a completed job. Never fails the job: the review
 * has already shipped, so a changelog problem is logged and acked (or retried
 * once on a transient model failure).
 */
async function runChangelogJob(env: Env, job: PersistedReviewJob): Promise<ReviewJobRunResult> {
  const tracker = new TokenTracker();
  const github = new GitHubService(env, job.installationId, tracker);
  const model = new ModelService(env, tracker, { jobId: job.id });

  try {
    await runChangelogPhase(env, job, github, model);
    return { action: 'ack' };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);

    if (isRetryableModelError(error)) {
      const delaySeconds = getRetryableModelFailureDelaySeconds(error);
      logger.warn(`Changelog generation hit a transient failure; retrying in ${delaySeconds}s`, { jobId: job.id });
      return { action: 'retry', delaySeconds };
    }

    logger.error(`Changelog generation failed for ${job.owner}/${job.repo} PR #${job.prNumber}`, error);
    await updateJobStep(env, job.id, 'Changelog', { status: 'failed', error: messageText });
    return { action: 'ack' };
  }
}

/**
 * Builds the copy-pasteable prompt a coding agent can run to action the review.
 * Only P0/P1/P2 findings are included — nits are noise in a fix prompt.
 */
function buildAgentFixPrompt(job: PersistedReviewJob, findings: ParsedReviewComment[]) {
  const actionable = findings.filter((f) => ['P0', 'P1', 'P2'].includes(f.severity));
  if (actionable.length === 0) return null;

  const items = actionable
    .map((f, i) => `${i + 1}. [${f.severity}] ${f.path}${f.line ? `:${f.line}` : ''} — ${f.title}\n   ${f.body.replace(/\n+/g, ' ').trim()}`)
    .join('\n');

  return [
    '```',
    `Fix the following ${actionable.length} issue${actionable.length === 1 ? '' : 's'} Codra found in PR #${job.prNumber} (${job.owner}/${job.repo}).`,
    'Address each one at its root cause, keep the diff minimal, and do not refactor beyond what the fix needs.',
    '',
    items,
    '```',
  ].join('\n');
}

/**
 * Generates the changelog entry for a completed review, persists it to D1, and
 * rewrites the PR status comment with the findings summary, an agent fix
 * prompt, and a link to the rendered entry.
 *
 * Runs as its own phase so the model call sits outside finalize's wall-clock
 * budget; a failure here never invalidates the review that already shipped.
 */
async function runChangelogPhase(
  env: Env,
  job: PersistedReviewJob,
  github: GitHubService,
  model: ModelService,
) {
  const config = (job.configSnapshot ?? defaultRepoConfig) as RepoConfig;
  const pr = await github.getPullRequest(job.owner, job.repo, job.prNumber);
  const rawDiff = await github.getPullRequestDiff(job.owner, job.repo, job.prNumber);
  const files = filterReviewableFiles(parseUnifiedDiff(rawDiff), config.review);
  const reviews = await getFileReviewsForJobs(env, [job.id]);
  const findings = reviews.flatMap((review) => review.parsed_comments as ParsedReviewComment[]);

  await updateJobStep(env, job.id, 'Changelog', { status: 'running' });

  const response = await model.generateChangelog({
    config,
    systemPrompt: CHANGELOG_SYSTEM_PROMPT,
    userPrompt: buildChangelogPrompt({
      prTitle: pr.title ?? null,
      prBody: pr.body ?? null,
      headRef: pr.head?.ref ?? null,
      baseRef: pr.base?.ref ?? null,
      files: files.map((file) => ({
        path: file.path,
        summary: reviews.find((r) => r.file_path === file.path)?.file_summary ?? null,
        lineCount: file.lineCount,
      })),
      diff: rawDiff,
      findings,
    }),
  });

  // Model output is untrusted: validate before it reaches D1 or the renderer.
  const parsed = changelogModelOutputSchema.parse(JSON.parse(response.rawText));

  const slug = buildChangelogSlug({
    owner: job.owner,
    repo: job.repo,
    prNumber: job.prNumber,
    commitSha: job.commitSha,
  });

  const repositoryId = await getOrCreateRepository(env, {
    installationId: job.installationId,
    owner: job.owner,
    repo: job.repo,
  });

  await upsertChangelogEntry(env, {
    slug,
    jobId: job.id,
    repositoryId,
    prNumber: job.prNumber,
    prUrl: `https://github.com/${job.owner}/${job.repo}/pull/${job.prNumber}`,
    headRef: pr.head?.ref ?? null,
    commitSha: job.commitSha,
    tag: null,
    area: parsed.area,
    title: parsed.title,
    summary: parsed.summary,
    date: new Date().toISOString().slice(0, 10),
    changes: parsed.changes,
    detail: {
      problem: parsed.problem,
      approach: parsed.approach,
      apiChanges: parsed.api_changes,
      filesTouched: files.map((file) => file.path),
      migrations: parsed.migrations,
      code: parsed.code,
      diagrams: parsed.diagrams,
    },
  });

  await updateJobStep(env, job.id, 'Changelog', { status: 'done' });

  if (!job.statusCommentId) {
    logger.warn(`Job ${job.id} has no status comment to update with the changelog link`);
    return;
  }

  const changelogUrl = `${env.APP_URL.replace(/\/+$/, '')}/changelog/${slug}`;
  const bySeverity = ['P0', 'P1', 'P2', 'P3', 'nit']
    .map((severity) => ({ severity, count: findings.filter((f) => f.severity === severity).length }))
    .filter((row) => row.count > 0);
  const findingsLine = bySeverity.length
    ? bySeverity.map((row) => `**${row.count}** ${row.severity}`).join(' · ')
    : 'No issues found';

  const fixPrompt = buildAgentFixPrompt(job, findings);

  const body = [
    '## Code Review complete',
    '',
    parsed.summary,
    '',
    `**Findings:** ${findingsLine} · **Files:** ${files.length} · **Commit:** \`${job.commitSha.slice(0, 7)}\``,
    '',
    `📋 **[View the full changelog for this PR](${changelogUrl})** — schema diagrams, API changes, and the code that moved.`,
    ...(env.APP_URL ? ['', `🔧 <a href="${env.APP_URL.replace(/\/+$/, '')}/jobs/${job.id}" target="_blank" rel="noopener noreferrer">View the findings on Codra</a> — read them in full and copy a ready-to-paste fix prompt for your coding agent.`] : []),
    ...(fixPrompt ? ['', '<details>', '<summary>Prompt for your coding agent to fix these findings</summary>', '', fixPrompt, '</details>'] : []),
  ].join('\n');

  await github.updateIssueComment(job.owner, job.repo, job.statusCommentId, body);
}

async function heartbeatAndCheckSuperseded(env: Env, jobId: string, leaseOwner: string) {
  await heartbeatJobLease(env, jobId, leaseOwner, JOB_LEASE_SECONDS);
  await checkSuperseded(env, jobId);
}

async function enqueueJobPhase(
  env: Env,
  jobId: string,
  phase: ReviewPhase,
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

/** Minimal commenting surface shared by GitHubService and GitHubClient. */
type IssueCommenter = { createIssueComment(owner: string, repo: string, issueNumber: number, body: string): Promise<unknown> };

/**
 * Cancel any active (queued/running) codra review for a PR that is no longer
 * open, and leave a comment on the PR explaining it, with a link to the job.
 * Returns the number of reviews cancelled.
 */
export async function cancelReviewsForClosedPr(
  env: Env,
  gh: IssueCommenter,
  input: { owner: string; repo: string; prNumber: number },
  closedState: 'merged' | 'closed',
): Promise<number> {
  // Reflect the PR's final state on every job for it (finished reviews too),
  // and cancel any that were still in flight.
  const { cancelledActiveIds } = await markPrClosed(
    env,
    input,
    closedState,
    `Cancelled: PR #${input.prNumber} was ${closedState} before the review finished.`,
  );

  // Only comment when there was an in-progress review to cancel.
  if (cancelledActiveIds.length > 0) {
    try {
      const jobId = cancelledActiveIds[0];
      const link = env.APP_URL ? ` <a href="${env.APP_URL}/jobs/${jobId}" target="_blank" rel="noopener noreferrer">View the cancelled job</a>.` : '';
      await gh.createIssueComment(
        input.owner,
        input.repo,
        input.prNumber,
        `## 🔍 Code Review\n\nCodra cancelled its in-progress review because this pull request was **${closedState}** before the review completed.${link}`,
      );
    } catch (err) {
      logger.error('Failed to post review-cancellation comment', err);
    }
  }

  await notifyJobsChanged(env, { prNumber: input.prNumber, owner: input.owner, repo: input.repo, status: closedState }).catch(() => {});
  logger.info(`Marked ${input.owner}/${input.repo}#${input.prNumber} as ${closedState} (${cancelledActiveIds.length} active review(s) cancelled)`);
  return cancelledActiveIds.length;
}

type HousekeepingChange = {
  path: string;
  content: string;
  message: string;
  /** SHA of the existing file (for updates), undefined for new files. */
  existingSha?: string;
};

async function evaluateAndStageJulesDocsTask(
  env: Env, job: PersistedReviewJob, github: GitHubService, model: ModelService, config: RepoConfig,
) {
  const pr = await github.getPullRequest(job.owner, job.repo, job.prNumber);
  const defaultBranch = (await github.getRepo(job.owner, job.repo)).default_branch;

  const report = await evaluateDocsGaps(
    env, github,
    { id: job.id, owner: job.owner, repo: job.repo, prNumber: job.prNumber, headSha: pr.head.sha },
    config, model,
  );
  if (report.items.length === 0) return;

  const prompt = buildJulesPrompt(report, {
    owner: job.owner, repo: job.repo, defaultBranch,
    router: "Match the repository's existing routing setup — inspect how routes/pages are already registered (e.g. react-router, Next.js app router, file-based routing) and follow that exact pattern; do NOT assume a framework.",
  });

  const comment = await github.createIssueComment(job.owner, job.repo, job.prNumber,
    `📚 **Codra found documentation gaps**\n\n${report.summary}\n\nOnce this PR is **merged**, Codra will open a Jules agent session to address them. (Nothing happens if the PR is closed without merging.)`,
  ).catch(() => null);

  await stageJulesSession(env, {
    owner: job.owner, repo: job.repo,
    triggeringPrNumber: job.prNumber, triggeringJobId: job.id,
    prompt, gapSummary: report.summary,
    prCommentId: comment?.id ?? null,
  });
}

async function standardizeRepository(
  env: Env,
  job: PersistedReviewJob,
  github: GitHubService,
  model: ModelService,
  config: RepoConfig
) {
  const pr = await github.getPullRequest(job.owner, job.repo, job.prNumber);
  const defaultBranch = (await github.getRepo(job.owner, job.repo)).default_branch;
  let changes: HousekeepingChange[] = [];

  // 1. Config-driven standardization file rules — Cloudflare Worker repos only.
  // Each rule points at a reference file (GitHub URL) and a merge strategy; any
  // missing/drifted files become changes in the separate follow-up PR below.
  try {
    const wranglerFile =
      (await github.getRepoFileWithRefOrNull(job.owner, job.repo, 'wrangler.jsonc', defaultBranch)) ||
      (await github.getRepoFileWithRefOrNull(job.owner, job.repo, 'wrangler.toml', defaultBranch)) ||
      (await github.getRepoFileWithRefOrNull(job.owner, job.repo, 'wrangler.json', defaultBranch));

    if (wranglerFile) {
      const rules = await listEnabledStandardizationRules(env);
      for (const rule of rules) {
        try {
          const source = await fetchSourceContent(rule.source_url);
          const existing = await github.getRepoFileWithRefOrNull(job.owner, job.repo, rule.target_path, defaultBranch);
          const change = applyStrategy(
            rule.strategy as StandardizationStrategy,
            rule.target_path,
            existing ? { content: existing.content || '', sha: existing.sha } : null,
            source,
          );
          if (change) changes.push(change);
        } catch (err) {
          logger.error(`Standardization rule failed for ${rule.target_path}`, err);
        }
      }

      // Ensure the standard secret-store bindings exist in wrangler.jsonc.
      // Verify each secret still exists in its store first; skip + record any
      // that no longer exist so they can be reviewed in the dashboard.
      try {
        const stdBindings = await listEnabledStandardSecretBindings(env);
        const wranglerJsonc = await github.getRepoFileWithRefOrNull(job.owner, job.repo, 'wrangler.jsonc', defaultBranch);
        if (stdBindings.length > 0 && wranglerJsonc?.content) {
          const storeIds = [...new Set(stdBindings.map((b) => b.store_id))];
          const liveByStore = new Map<string, Set<string>>();
          for (const storeId of storeIds) {
            const secrets = await listSecretsStoreSecrets(env, storeId);
            liveByStore.set(storeId, new Set(secrets.map((s) => s.name)));
          }

          const present: SecretBindingSpec[] = [];
          for (const b of stdBindings) {
            if (liveByStore.get(b.store_id)?.has(b.secret_name)) {
              present.push({ binding: b.binding_name, secret_name: b.secret_name, store_id: b.store_id });
            } else {
              await recordMissingSecret(env, {
                owner: job.owner, repo: job.repo, secretName: b.secret_name, storeId: b.store_id, triggeringPrNumber: job.prNumber,
              }).catch((e) => logger.error('Failed to record missing secret', e));
            }
          }

          const result = ensureSecretBindings(wranglerJsonc.content, present);
          if (result) {
            changes.push({
              path: 'wrangler.jsonc',
              content: result.content,
              message: 'chore: add standard secret store bindings',
              existingSha: wranglerJsonc.sha,
            });
          }
        }
      } catch (err) {
        logger.error('Failed to evaluate secret store bindings', err);
      }
    } else {
      logger.info(`Skipping standardization file rules for ${job.owner}/${job.repo}: not a Cloudflare Worker repo`);
    }
  } catch (err) {
    logger.error('Failed to evaluate standardization rules', err);
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

  // Drop any files whose standard the maintainers already rejected by closing a
  // previous housekeeping PR — never propose those again.
  const dismissed = await getDismissedStandards(env, job.owner, job.repo).catch(() => new Set<string>());
  if (dismissed.size > 0) {
    const before = changes.length;
    changes = changes.filter((c) => !dismissed.has(c.path));
    if (changes.length !== before) {
      logger.info(`Skipped ${before - changes.length} previously-rejected standard file(s) for ${job.owner}/${job.repo}`);
    }
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

    // Record the action + reasoning so it is auditable in the dashboard.
    try {
      await recordAgentAction(env, {
        owner: job.owner,
        repo: job.repo,
        actionType: 'standardization',
        summary: `Opened a standardization PR while reviewing PR #${job.prNumber}. Missing or drifted files detected on the default branch:\n${changedFiles}`,
        files: changes.map((c) => c.path),
        prNumber: housekeepingPR.number,
        prUrl: housekeepingPR.html_url,
        triggeringPrNumber: job.prNumber,
        triggeringJobId: job.id,
      });
    } catch (err) {
      logger.error('Failed to record standardization action', err);
    }
  } catch (err) {
    logger.error('Failed to open housekeeping PR', err);
  }
}
