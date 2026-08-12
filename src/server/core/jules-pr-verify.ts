import type { JulesSessionRow } from '@server/db/jules-sessions';
import { getChangedFileContents, type DocsGapGithub } from '@server/core/jules-docs-gap';
import { analyzeChangedFiles } from '@server/core/docstrings';
import { directCorrectionsToJules } from '@server/core/jules-pr-correction';
import { logger } from '@server/core/logger';
import type { GitHubReviewComment } from '@server/core/github';

type VerifyGithub = DocsGapGithub & {
  createReview(owner: string, repo: string, pull: number, input: { commitSha: string; event: 'COMMENT'; body: string; comments: GitHubReviewComment[] }): Promise<unknown>;
  createIssueComment(owner: string, repo: string, issue: number, body: string): Promise<unknown>;
};

/**
 * Verify a diverted Codra docs PR: re-run the docstring analysis on the PR's
 * changed files, scoped to the session's target files. If any scoped file still
 * has missing docstrings, Jules did not finish — push inline suggestions to the
 * PR and a correction to the Jules session. Deterministic; no LLM in v1.
 * Best-effort: never throws.
 */
export async function verifyDivertedJulesPr(
  env: Pick<Env, 'DB' | 'JULES_API_KEY'>,
  gh: VerifyGithub,
  input: { session: JulesSessionRow; owner: string; repo: string; prNumber: number; headSha: string },
): Promise<{ verified: boolean; gaps: string[] }> {
  try {
    const scoped = new Set(input.session.target_files ?? []);
    const files = await getChangedFileContents(gh, input.owner, input.repo, input.prNumber, input.headSha);
    const relevant = scoped.size ? files.filter((f) => scoped.has(f.path)) : files;
    const results = analyzeChangedFiles(relevant).filter((r) => r.functionsMissingDocstrings.length > 0);

    if (results.length === 0) {
      logger.info('jules pr verification passed', { owner: input.owner, repo: input.repo, prNumber: input.prNumber });
      return { verified: true, gaps: [] };
    }

    const comments: GitHubReviewComment[] = results.map((r) => ({
      path: r.fileName,
      body: `Codra tasked Jules to add docstrings here, but these still have none: ${r.functionsMissingDocstrings.join(', ')}. Please add them.`,
    }));
    await gh.createReview(input.owner, input.repo, input.prNumber, {
      commitSha: input.headSha, event: 'COMMENT',
      body: 'Codra verification found unfinished docstrings from the assigned Jules task.',
      comments,
    }).catch((err) => logger.warn('verify createReview failed', { error: err instanceof Error ? err.message : String(err) }));

    // SDK follow-up + PR conversation comment (existing composed helper).
    await directCorrectionsToJules(env, gh, {
      owner: input.owner, repo: input.repo, prNumber: input.prNumber,
      comments: results.map((r) => ({ path: r.fileName, title: 'Missing docstrings', body: `Add docstrings to: ${r.functionsMissingDocstrings.join(', ')}` })),
    }).catch((err) => logger.warn('verify directCorrectionsToJules failed', { error: err instanceof Error ? err.message : String(err) }));

    return { verified: false, gaps: results.map((r) => r.fileName) };
  } catch (err) {
    logger.warn('verifyDivertedJulesPr failed', { error: err instanceof Error ? err.message : String(err) });
    return { verified: false, gaps: [] };
  }
}
