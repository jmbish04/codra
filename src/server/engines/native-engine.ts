import type { EngineReviewResult, ReviewContext, ReviewEngine, ReviewerUsage } from '@server/core/review-engine';
import type { ParsedReviewComment } from '@shared/schema';
import { planReviewers } from '@server/core/reviewer-plan';
import { REVIEWERS, buildReviewerSystemPrompt } from '@server/prompts/reviewers';

/**
 * ReviewEngine interface implementation reserved for Spec 2 engines
 * (ComputerEngine/OpenCodeEngine). NOT wired into the live review pipeline —
 * the production native review path is `reviewAndPersistFile` in
 * src/server/core/review.ts, which fans out reviewers inside the metered loop.
 */
export class NativeEngine implements ReviewEngine {
  readonly name = 'native' as const;
  async healthCheck(_signal?: AbortSignal) { return true; } // always available

  async reviewPullRequest(ctx: ReviewContext): Promise<EngineReviewResult> {
    const plan = planReviewers(ctx.totalLineCount, ctx.files.length, ctx.config.review);
    const comments: ParsedReviewComment[] = [];
    const perReviewer: ReviewerUsage[] = [];

    for (const file of ctx.files) {
      for (const id of plan) {
        const reviewer = REVIEWERS[id];
        const systemPromptOverride = buildReviewerSystemPrompt(reviewer, ctx.config.review);
        const res = await ctx.model.reviewFile({
          file, prTitle: ctx.pr.title, prDescription: ctx.pr.body,
          config: ctx.config, totalLineCount: ctx.totalLineCount,
          projectContext: '', sharedContext: ctx.sharedContext,
          systemPromptOverride, cacheSystem: true,
        } as any);
        const found = res.parsed.comments ?? [];
        comments.push(...found);
        perReviewer.push({
          reviewer: id, file: file.path,
          inputTokens: res.inputTokens ?? 0, outputTokens: res.outputTokens ?? 0,
          cacheReadTokens: res.cacheReadTokens ?? 0, cacheWriteTokens: res.cacheWriteTokens ?? 0,
          findings: found.length,
        });
      }
    }
    return { comments, perReviewer };
  }
}
