import type { JulesSessionRow } from '@server/db/jules-sessions';
import { getChangedFileContents, type DocsGapGithub } from '@server/core/jules-docs-gap';
import { analyzeChangedFiles } from '@server/core/docstrings';
import { directCorrectionsToJules } from '@server/core/jules-pr-correction';
import { listInteractions } from '@server/db/jules-interactions';
import { logger } from '@server/core/logger';

type VerifyGithub = DocsGapGithub & {
  createIssueComment(owner: string, repo: string, issue: number, body: string): Promise<unknown>;
};

/**
 * Verify a diverted Codra docs PR: re-run the docstring analysis on the PR's
 * changed files, scoped to the session's target files. If any scoped file still
 * has missing docstrings, Jules did not finish — push a correction to the Jules
 * session (SDK) plus a PR conversation comment. Deterministic; no LLM in v1.
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
    // Only ever check the files Codra scoped to the task — never comment out of
    // scope. Empty target_files means nothing to verify.
    const relevant = files.filter((f) => scoped.has(f.path));
    const results = analyzeChangedFiles(relevant).filter((r) => r.functionsMissingDocstrings.length > 0);

    if (results.length === 0) {
      logger.info('jules pr verification passed', { owner: input.owner, repo: input.repo, prNumber: input.prNumber });
      return { verified: true, gaps: [] };
    }

    const gaps = results.map((r) => r.fileName);

    // Idempotency: this runs on every opened/synchronize + webhook redelivery.
    // Don't re-send a correction we already sent for THIS head commit — the
    // marker `commit <sha>` in the correction text is the dedup key.
    if (input.session.session_id) {
      const prior = await listInteractions(env, { sessionId: input.session.session_id, prNumber: input.prNumber });
      if (prior.some((i) => i.kind === 'correction' && (i.text ?? '').includes(input.headSha))) {
        logger.info('jules pr verification: correction already sent for this commit', { prNumber: input.prNumber, headSha: input.headSha });
        return { verified: false, gaps };
      }
    }

    // ponytail: no per-line inline suggestions yet — the docstring heuristic has
    // no line numbers, and a line-less createReview 422s. Feedback goes via the
    // SDK correction + PR comment; add inline once the analyzer yields lines.
    await directCorrectionsToJules(env, gh, {
      owner: input.owner, repo: input.repo, prNumber: input.prNumber,
      comments: results.map((r) => ({
        path: r.fileName, title: 'Missing docstrings',
        body: `Add docstrings to: ${r.functionsMissingDocstrings.join(', ')} (commit ${input.headSha})`,
      })),
    }).catch((err) => logger.warn('verify directCorrectionsToJules failed', { error: err instanceof Error ? err.message : String(err) }));

    return { verified: false, gaps };
  } catch (err) {
    logger.warn('verifyDivertedJulesPr failed', { error: err instanceof Error ? err.message : String(err) });
    return { verified: false, gaps: [] };
  }
}
