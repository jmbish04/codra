import { logger } from './logger';
import type { GitHubWebhookEventName, GitHubWebhookPayload, IssueCommentWebhookPayload, PullRequestWebhookPayload } from '@shared/github';
import { defaultRepoConfig, type ParsedReviewComment, type RepoConfig, type ReviewJobMessage } from '@shared/schema';
import type { AppBindings } from '@server/env';
import { insertFileReview, getFileReviewsForJob } from '@server/db/file-reviews';
import { completeJob, failJob, getJobForProcessing, markJobRunning, updateJobCheckRun, updateJobFileCount, updateJobStep } from '@server/db/jobs';
import { filterReviewableFiles, parseUnifiedDiff } from './diff';
import { GitHubClient } from './github';
import { parseFileReviewResponse, parseSummaryResponse } from './model-output';
import { buildFileReviewPrompts } from '@server/prompts/file-review';
import { buildSummaryPrompt, SUMMARY_SYSTEM_PROMPT } from '@server/prompts/summary';
import { reviewWithGemma } from '@server/models/gemma';
import { reviewWithKimi } from '@server/models/kimi';

function severityIcon(severity: ParsedReviewComment['severity']) {
  switch (severity) {
    case 'P0':
      return '🔥';
    case 'P1':
      return '🔴';
    case 'P2':
      return '🟡';
    case 'P3':
      return '🔵';
    case 'nit':
      return '⚪';
    default:
      return '⚪';
  }
}

function formatInlineComment(comment: ParsedReviewComment) {
  return `${severityIcon(comment.severity)} ${comment.title}\n\n${comment.body}`;
}

function toReviewEvent(verdict: 'approve' | 'comment') {
  return verdict === 'approve' ? 'APPROVE' as const : 'COMMENT' as const;
}

function summarizeVerdict(comments: ParsedReviewComment[], hasFailures: boolean) {
  const p0 = comments.filter((c) => c.severity === 'P0').length;
  const p1 = comments.filter((c) => c.severity === 'P1').length;
  const p2 = comments.filter((c) => c.severity === 'P2').length;

  if (p0 > 0 || p1 > 0 || hasFailures || p2 > 0) {
    return { verdict: 'comment' as const, errors: p0 + p1, warnings: p2 };
  }

  return { verdict: 'approve' as const, errors: 0, warnings: 0 };
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

export async function runReviewJob(env: AppBindings, message: ReviewJobMessage) {
  const job = await getJobForProcessing(env, message.jobId);
  if (!job) {
    logger.warn(`Job not found for processing: ${message.jobId}`);
    return;
  }

  if (job.status === 'superseded') {
    logger.info(`Job ${job.id} is superseded, skipping processing.`);
    return;
  }

  logger.info(`Starting review job: ${job.owner}/${job.repo} PR #${job.pr_number}`, { 
    jobId: job.id,
    deliveryId: message.deliveryId 
  });

  const github = new GitHubClient(env, job.installation_id);
  let checkRunId = job.check_run_id;

  try {
    await markJobRunning(env, job.id);
    await updateJobStep(env, job.id, 'Initializing', { status: 'running' });

    const pr = await github.getPullRequest(job.owner, job.repo, job.pr_number);
    const config = (job.config_snapshot ?? defaultRepoConfig) as RepoConfig;

    if (!checkRunId) {
      const checkRun = await github.createCheckRun(job.owner, job.repo, {
        headSha: pr.head.sha,
        title: 'Review queued',
        summary: 'Codra has started reviewing this pull request.',
      });
      checkRunId = checkRun.id;
      await updateJobCheckRun(env, job.id, checkRun.id);
    }
    await updateJobStep(env, job.id, 'Initializing', { status: 'done' });

    await updateJobStep(env, job.id, 'Fetching Diff', { status: 'running' });
    const rawDiff = await github.getPullRequestDiff(job.owner, job.repo, job.pr_number);
    const files = filterReviewableFiles(parseUnifiedDiff(rawDiff), config.review);
    await updateJobFileCount(env, job.id, files.length);
    await updateJobStep(env, job.id, 'Fetching Diff', { status: 'done' });

    await updateJobStep(env, job.id, 'Reviewing Files', { status: 'running' });
    const reviewedComments: ParsedReviewComment[] = [];
    const fileSummaries: Array<{ path: string; summary: string; verdict: string }> = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Get existing reviews for this job OR the job it's a retry of
    const currentJobReviews = await getFileReviewsForJob(env, job.id);
    const parentJobReviews = job.retry_of_job_id ? await getFileReviewsForJob(env, job.retry_of_job_id) : [];
    
    // Merge reviews, preferring current job's reviews
    const existingReviews = [...currentJobReviews];
    for (const parentReview of parentJobReviews) {
      if (!existingReviews.some(r => r.file_path === parentReview.file_path)) {
        existingReviews.push(parentReview);
      }
    }

    for (const [index, file] of files.entries()) {
      // Periodic check for supersession
      const currentJob = await getJobForProcessing(env, job.id);
      if (currentJob?.status === 'superseded') {
        throw new Error('JOB_SUPERSEDED');
      }

      const existing = existingReviews.find((r) => r.file_path === file.path && r.file_status === 'done');

      if (existing) {
        reviewedComments.push(...(existing.parsed_comments as ParsedReviewComment[]));
        fileSummaries.push({
          path: file.path,
          summary: existing.file_summary ?? '',
          verdict: existing.verdict ?? 'comment',
        });
        totalInputTokens += existing.input_tokens ?? 0;
        totalOutputTokens += existing.output_tokens ?? 0;

        // If this review was from a parent job, insert it into the current job for record keeping
        if (!currentJobReviews.some((r) => r.file_path === file.path)) {
          await insertFileReview(env, {
            jobId: job.id,
            filePath: file.path,
            fileStatus: 'done',
            modelUsed: existing.model_used,
            diffLineCount: existing.diff_line_count,
            diffInput: existing.diff_input,
            rawAiOutput: existing.raw_ai_output,
            parsedComments: existing.parsed_comments as ParsedReviewComment[],
            inputTokens: existing.input_tokens,
            outputTokens: existing.output_tokens,
            durationMs: existing.duration_ms,
            verdict: existing.verdict,
            fileSummary: existing.file_summary,
            errorMessage: null,
          });
        }
        continue;
      }

      await github.updateCheckRun(job.owner, job.repo, checkRunId, {
        title: `Reviewing (${index + 1}/${files.length})`,
        summary: `Analyzing ${file.path}`,
      });

      const startedAt = Date.now();
      const { systemPrompt, userPrompt } = buildFileReviewPrompts({
        file,
        prTitle: pr.title,
        prDescription: pr.body,
        config: config.review,
      });
      let rawModelOutput: string | null = null;

      try {
        const response =
          file.lineCount >= config.review.large_file_threshold_lines
            ? await reviewWithKimi(env, { systemPrompt, userPrompt })
            : await reviewWithGemma(env, { systemPrompt, userPrompt });

        rawModelOutput = response.rawText;
        totalInputTokens += response.inputTokens;
        totalOutputTokens += response.outputTokens;

        const parsed = parseFileReviewResponse(response.rawText, file);
        reviewedComments.push(...parsed.comments);
        fileSummaries.push({
          path: file.path,
          summary: parsed.fileSummary,
          verdict: parsed.verdict,
        });

        await insertFileReview(env, {
          jobId: job.id,
          filePath: file.path,
          fileStatus: 'done',
          modelUsed: response.modelUsed,
          diffLineCount: file.lineCount,
          diffInput: userPrompt,
          rawAiOutput: response.rawText,
          parsedComments: parsed.comments,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          durationMs: Date.now() - startedAt,
          verdict: parsed.verdict,
          fileSummary: parsed.fileSummary,
          overallCorrectness: parsed.overallCorrectness,
          confidenceScore: parsed.confidenceScore,
          errorMessage: null,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown file review error';
        logger.error(`File review failed for ${file.path}`, { error, rawOutput: rawModelOutput });
        fileSummaries.push({
          path: file.path,
          summary: `Review failed: ${errorMessage}`,
          verdict: 'failed',
        });

        await insertFileReview(env, {
          jobId: job.id,
          filePath: file.path,
          fileStatus: 'failed',
          modelUsed: file.lineCount >= config.review.large_file_threshold_lines ? '@cf/moonshotai/kimi-k2.5' : env.GEMINI_MODEL || 'gemma-4-31b-it',
          diffLineCount: file.lineCount,
          diffInput: userPrompt,
          rawAiOutput: rawModelOutput,
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
    await updateJobStep(env, job.id, 'Reviewing Files', { status: 'done' });

    await updateJobStep(env, job.id, 'Generating Summary', { status: 'running' });
    const hasFailures = fileSummaries.some((f) => f.verdict === 'failed');
    const verdictSummary = summarizeVerdict(reviewedComments, hasFailures);

    // Final check before generating summary and posting review
    const finalJobCheck = await getJobForProcessing(env, job.id);
    if (finalJobCheck?.status === 'superseded') {
      throw new Error('JOB_SUPERSEDED');
    }

    const summaryResponse = await reviewWithGemma(env, {
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      userPrompt: buildSummaryPrompt({
        prTitle: pr.title,
        verdict: verdictSummary.verdict,
        fileSummaries,
      }),
    });

    totalInputTokens += summaryResponse.inputTokens;
    totalOutputTokens += summaryResponse.outputTokens;
    await updateJobStep(env, job.id, 'Generating Summary', { status: 'done' });

    const parsedSummary = parseSummaryResponse(summaryResponse.rawText);

    await updateJobStep(env, job.id, 'Completing', { status: 'running' });
    const review = await github.createReview(job.owner, job.repo, job.pr_number, {
      commitSha: pr.head.sha,
      event: toReviewEvent(verdictSummary.verdict),
      body: parsedSummary,
      comments: reviewedComments.map(c => ({
        path: c.path,
        position: c.position,
        body: formatInlineComment(c)
      })),
    });

    if (config.review.labels !== false) {
      const labels = config.review.labels;
      const labelMap = {
        comment: { name: labels.p1, color: 'f79009' },
        approve: { name: labels.p2, color: '027a48' },
      } as const;
      const label = labelMap[verdictSummary.verdict];

      // Remove other verdict labels if they exist
      const allPotentialLabels = [labels.p1, labels.p2, labels.p3];
      for (const l of allPotentialLabels) {
        if (l !== label.name) {
          await github.removeIssueLabel(job.owner, job.repo, job.pr_number, l);
        }
      }

      await github.ensureLabel(job.owner, job.repo, label.name, label.color);
      await github.addIssueLabels(job.owner, job.repo, job.pr_number, [label.name]);
    }

    await github.updateCheckRun(job.owner, job.repo, checkRunId, {
      status: 'completed',
      conclusion: hasFailures ? 'failure' : (verdictSummary.verdict === 'approve' ? 'success' : 'neutral'),
      title: hasFailures ? 'Review partially failed' : (verdictSummary.verdict === 'approve' ? 'LGTM' : 'Comments posted'),
      summary: `${reviewedComments.length} inline comments across ${files.length} files.${hasFailures ? ' Some files failed to parse.' : ''}`,
    });

    await completeJob(env, job.id, {
      verdict: verdictSummary.verdict,
      fileCount: files.length,
      commentCount: reviewedComments.length,
      totalInputTokens,
      totalOutputTokens,
      summaryMarkdown: parsedSummary,
      reviewId: review.id,
      summaryModel: summaryResponse.modelUsed,
    });
    await updateJobStep(env, job.id, 'Completing', { status: 'done' });
    logger.info(`Review job completed: ${job.owner}/${job.repo} PR #${job.pr_number}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown review failure';
    if (message === 'JOB_SUPERSEDED') {
      logger.info(`Job ${job.id} was superseded during execution, stopping.`);
      return;
    }

    logger.error(`Review job failed: ${job.owner}/${job.repo} PR #${job.pr_number}`, error);
    await failJob(env, job.id, message);
    
    // Update any running step to failed
    const jobDetail = await getJobForProcessing(env, job.id);
    if (jobDetail && (jobDetail as any).steps) {
      const runningStep = (jobDetail as any).steps.find((s: any) => s.status === 'running');
      if (runningStep) {
        await updateJobStep(env, job.id, runningStep.name, { status: 'failed', error: message });
      }
    }

    if (checkRunId) {
      await github.updateCheckRun(job.owner, job.repo, checkRunId, {
        status: 'completed',
        conclusion: 'failure',
        title: 'Review failed',
        summary: message,
      });
    }
  }
}
