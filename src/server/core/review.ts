import { logger } from './logger';
import type { GitHubWebhookEventName, GitHubWebhookPayload, IssueCommentWebhookPayload, PullRequestWebhookPayload } from '@shared/github';
import { defaultRepoConfig, type ParsedReviewComment, type RepoConfig, type ReviewJobMessage } from '@shared/schema';
import type { AppBindings } from '@server/env';
import { insertFileReview, getFileReviewsForJob } from '@server/db/file-reviews';
import { completeJob, failJob, getJobForProcessing, markJobRunning, updateJobCheckRun, updateJobFileCount, updateJobStep } from '@server/db/jobs';
import { filterReviewableFiles, parseUnifiedDiff } from './diff';

import { GitHubService } from '../services/github';
import { ModelService } from '../services/model';
import { FormatterService } from '../services/formatter';
import { TokenTracker } from './token-tracker';

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

  const github = new GitHubService(env, job.installation_id);
  const tracker = new TokenTracker();
  const model = new ModelService(env, tracker);
  const formatter = new FormatterService();

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

    const totalLineCount = files.reduce((sum, f) => sum + f.lineCount, 0);
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
        
        if (existing.model_used && (existing.input_tokens || existing.output_tokens)) {
          tracker.record(existing.model_used, existing.input_tokens ?? 0, existing.output_tokens ?? 0);
        }

        // If this review was from a parent job, insert it into the current job for record keeping
        if (!currentJobReviews.some((r) => r.file_path === file.path)) {
          await insertFileReview(env, {
            jobId: job.id,
            filePath: file.path,
            fileStatus: 'done',
            modelUsed: existing.model_used,
            modelProvider: (existing as any).model_provider,
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
      try {
        const response = await model.reviewFile({
          file,
          prTitle: pr.title ?? null,
          prDescription: pr.body ?? null,
          config: config,
          totalLineCount,
        });

        reviewedComments.push(...response.parsed.comments);
        fileSummaries.push({
          path: file.path,
          summary: response.parsed.fileSummary,
          verdict: response.parsed.verdict,
        });

        await insertFileReview(env, {
          jobId: job.id,
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
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown file review error';
        logger.error(`File review failed for ${file.path}`, { error });
        fileSummaries.push({
          path: file.path,
          summary: `Review failed: ${errorMessage}`,
          verdict: 'failed',
        });

        await insertFileReview(env, {
          jobId: job.id,
          filePath: file.path,
          fileStatus: 'failed',
          modelUsed: config.model?.main || 'gemma-4-31b-it',
          modelProvider: (config.model?.main || 'gemma-4-31b-it').startsWith('@cf/') ? 'cloudflare' : 'google',
          diffLineCount: file.lineCount,
          diffInput: '', // userPrompt was inside try
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
    
    if (fileSummaries.length > 0 && fileSummaries.every((f) => f.verdict === 'failed')) {
      await updateJobStep(env, job.id, 'Reviewing Files', { status: 'failed', error: 'All files failed to review' });
      throw new Error('All files failed to review');
    }

    await updateJobStep(env, job.id, 'Reviewing Files', { status: 'done' });

    await updateJobStep(env, job.id, 'Generating Summary', { status: 'running' });
    const hasFailures = fileSummaries.some((f) => f.verdict === 'failed');
    const verdictSummary = formatter.summarizeVerdict(reviewedComments, hasFailures);

    // Final check before generating summary and posting review
    const finalJobCheck = await getJobForProcessing(env, job.id);
    if (finalJobCheck?.status === 'superseded') {
      throw new Error('JOB_SUPERSEDED');
    }

    const summaryResponse = await model.generateSummary({
      prTitle: pr.title ?? null,
      verdict: verdictSummary.verdict,
      fileSummaries,
      config,
    });

    await updateJobStep(env, job.id, 'Generating Summary', { status: 'done' });

    const formattedSummary = formatter.formatReviewOverview(pr.head.sha, env.BOT_USERNAME);

    await updateJobStep(env, job.id, 'Completing', { status: 'running' });
    const review = await github.createReview(job.owner, job.repo, job.pr_number, {
      commitSha: pr.head.sha,
      event: formatter.toReviewEvent(verdictSummary.verdict),
      body: formattedSummary,
      comments: reviewedComments.map(c => ({
        path: c.path,
        position: c.position,
        body: formatter.formatInlineComment(c)
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

    const finalUsage = tracker.getTotalUsage();
    logger.info(`Final token usage for job ${job.id}:`, { 
      total: finalUsage, 
      breakdown: tracker.getBreakdown() 
    });

    await completeJob(env, job.id, {
      verdict: verdictSummary.verdict,
      fileCount: files.length,
      commentCount: reviewedComments.length,
      totalInputTokens: finalUsage.input,
      totalOutputTokens: finalUsage.output,
      summaryMarkdown: formattedSummary,
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

