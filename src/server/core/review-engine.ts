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
  healthCheck(): Promise<boolean>;
}
