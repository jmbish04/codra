import type { FileDiff } from '@server/core/diff';
import type { ParsedReviewComment, RepoConfig } from '@shared/schema';
import type { ReviewerId } from '@server/prompts/reviewers';
import type { ModelService } from '@server/services/model';

export type ReviewContext = {
  env: Env;
  job: { id: string; owner: string; repo: string; prNumber: number };
  pr: { title: string | null; body: string | null; head?: { sha: string } };
  config: RepoConfig;
  files: FileDiff[];
  totalLineCount: number;
  sharedContext: string;
  model: ModelService;
};

export type ReviewerUsage = {
  reviewer: ReviewerId; file: string;
  inputTokens: number; outputTokens: number;
  cacheReadTokens: number; cacheWriteTokens: number; findings: number;
};

export type EngineReviewResult = { comments: ParsedReviewComment[]; perReviewer: ReviewerUsage[] };

export interface ReviewEngine {
  readonly name: 'opencode' | 'computer' | 'native';
  reviewPullRequest(ctx: ReviewContext): Promise<EngineReviewResult>;
  /** signal is aborted if the caller's timeout fires — real engines should
   *  forward it into their fetch so a stalled probe cancels promptly. */
  healthCheck(signal?: AbortSignal): Promise<boolean>;
  /** Cheap, synchronous, NO I/O — does this engine even have the infra/
   *  bindings to ever be viable (a transport binding present, a factory
   *  available)? resolveEngine skips unconfigured candidates before
   *  touching the CircuitBreaker/KV or calling healthCheck, so the default
   *  'auto' config with nothing provisioned does zero KV I/O per job. */
  isConfigured(env: Env): boolean;
}
