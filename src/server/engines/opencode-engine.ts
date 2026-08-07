import type { EngineReviewResult, ReviewContext, ReviewEngine, ReviewerUsage } from '@server/core/review-engine';
import type { ParsedReviewComment } from '@shared/schema';
import { parsedReviewCommentSchema } from '@shared/schema';
import { renderFileDiff } from '@server/core/diff';
import { sanitizeForPrompt } from '@server/core/prompt-safety';
import { logger } from '@server/core/logger';
import { OpenCodeClient } from '@server/engines/opencode-client';

/**
 * JSONL line contract for `client.review()`'s output stream:
 *  - a finding line is anything that parses against `parsedReviewCommentSchema`.
 *  - the OPTIONAL terminal line is a summary: `{ type: 'summary', perReviewer: ReviewerUsage[] }`
 *    (a bare `perReviewer`/`usage` array field is also accepted).
 * Any other line (non-JSON, or JSON matching neither shape) is malformed and
 * skipped best-effort — a single bad line from the remote server shouldn't
 * sink the whole review.
 */
function isSummaryLine(obj: Record<string, unknown>): boolean {
  return obj.type === 'summary' || Array.isArray(obj.perReviewer) || Array.isArray(obj.usage);
}

export class OpenCodeEngine implements ReviewEngine {
  readonly name = 'opencode' as const;
  private readonly client: OpenCodeClient;

  constructor(env: Env, client?: OpenCodeClient) {
    this.client = client ?? new OpenCodeClient(env);
  }

  async healthCheck(signal?: AbortSignal): Promise<boolean> {
    return this.client.health(signal);
  }

  async reviewPullRequest(ctx: ReviewContext): Promise<EngineReviewResult> {
    const payload = {
      job: ctx.job,
      pr: {
        title: sanitizeForPrompt(ctx.pr.title),
        body: sanitizeForPrompt(ctx.pr.body),
        headSha: ctx.pr.head?.sha,
      },
      config: ctx.config.review,
      sharedContext: ctx.sharedContext,
      files: ctx.files.map((f) => ({ path: f.path, patch: renderFileDiff(f) })),
    };

    const comments: ParsedReviewComment[] = [];
    let perReviewer: ReviewerUsage[] = [];

    // A retryable client error (connectivity/5xx/timeout) propagates here —
    // do NOT catch-and-return-empty, that would look like "reviewed, found
    // nothing" instead of "couldn't reach OpenCode". The caller (resolveEngine's
    // delegation branch) trips the breaker and falls back to native.
    for await (const line of this.client.review(payload)) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        logger.debug('OpenCodeEngine: skipping non-JSON JSONL line', { line: trimmed });
        continue;
      }

      if (typeof parsed !== 'object' || parsed === null) {
        logger.debug('OpenCodeEngine: skipping non-object JSONL line', { line: trimmed });
        continue;
      }
      const obj = parsed as Record<string, unknown>;

      if (isSummaryLine(obj)) {
        const usage = obj.perReviewer ?? obj.usage;
        if (Array.isArray(usage)) perReviewer = usage as ReviewerUsage[];
        continue;
      }

      const result = parsedReviewCommentSchema.safeParse(parsed);
      if (!result.success) {
        logger.debug('OpenCodeEngine: skipping JSONL line failing parsedReviewCommentSchema', {
          line: trimmed, error: result.error.message,
        });
        continue;
      }
      comments.push(result.data);
    }

    return { comments, perReviewer };
  }
}
