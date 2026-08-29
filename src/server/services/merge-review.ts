import { generateText } from 'ai';
import { generateWithWorkersAi } from '@server/models/workers-ai';
import { buildMergeReviewPrompt, parseReviewVerdict } from '@server/services/plan-orchestrator';
import { countReviewAttempts, recordReview } from '@server/db/reconciliation-reviews';

const REVIEW_MODEL = '@cf/moonshotai/kimi-k2.7-code';
const MAX_MERGE_ATTEMPTS = 3;

export type MergeReviewResult = { approved: boolean; feedback: string; attempt: number; reason?: string };

/**
 * codra reviews a jules-merge reconciliation before it is merged. Kimi judges the
 * staged result; a hard circuit breaker caps attempts per reconciliation so a
 * rejected reconciliation can never loop into an unbounded re-merge.
 */
export async function reviewReconciliation(
  env: Pick<Env, 'DB' | 'CF_FREEBIE_ACCOUNT_ID' | 'CF_FREEBIE_API_TOKEN' | 'CF_ACCOUNT_ID' | 'CF_API_TOKEN'>,
  input: { repositoryId: number; repository: string; reconciliationKey: string; summary: string; prNumber?: number | null },
): Promise<MergeReviewResult> {
  const prior = await countReviewAttempts(env, input.reconciliationKey);
  const attempt = prior + 1;

  if (prior >= MAX_MERGE_ATTEMPTS) {
    await recordReview(env, { ...input, attempt, verdict: 'rejected', feedback: 'circuit breaker: max merge-review attempts reached', prNumber: input.prNumber });
    return { approved: false, feedback: 'circuit breaker tripped', attempt, reason: 'max_attempts' };
  }

  const { text } = await generateWithWorkersAi(env, REVIEW_MODEL, (workersai) =>
    generateText({
      model: workersai(REVIEW_MODEL as any),
      system: 'You are the codra orchestrator. Judge merge reconciliations strictly and reply only with the requested JSON block.',
      prompt: buildMergeReviewPrompt({ repository: input.repository, summary: input.summary }),
    }),
  );
  const verdict = parseReviewVerdict(text);

  await recordReview(env, {
    ...input, attempt, verdict: verdict.satisfied ? 'approved' : 'rejected',
    feedback: verdict.feedback, summary: input.summary.slice(0, 4000), prNumber: input.prNumber,
  });
  return { approved: verdict.satisfied, feedback: verdict.feedback, attempt };
}
