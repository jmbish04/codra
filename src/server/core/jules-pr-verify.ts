import type { JulesSessionRow } from '@server/db/jules-sessions';
import { getChangedFileContents, type DocsGapGithub } from '@server/core/jules-docs-gap';
import { analyzeChangedFiles } from '@server/core/docstrings';
import { directCorrectionsToJules } from '@server/core/jules-pr-correction';
import { listInteractions } from '@server/db/jules-interactions';
import { parseUnifiedDiff } from '@server/core/diff';
import { logger } from '@server/core/logger';
import type { GitHubReviewComment } from '@server/core/github';

type VerifyGithub = DocsGapGithub & {
  createReview(owner: string, repo: string, pull: number, input: { commitSha: string; event: 'COMMENT'; body: string; comments: GitHubReviewComment[] }): Promise<unknown>;
  createIssueComment(owner: string, repo: string, issue: number, body: string): Promise<unknown>;
};

/**
 * Verify a diverted Codra docs PR: re-run the docstring analysis on the PR's
 * changed files, scoped to the session's target files. If any scoped file still
 * has missing docstrings, Jules did not finish — post inline PR comments on the
 * still-undocumented functions that fall within the diff, plus a correction to
 * the Jules session (SDK) and a PR conversation comment. Deterministic; no LLM
 * in v1. Best-effort: never throws.
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

    // Inline PR comments — GitHub only accepts review comments on lines present
    // in the diff, so pre-filter to the diff's line numbers (add + context).
    // Undocumented functions outside the diff are still covered by the SDK
    // correction below, so nothing is lost.
    try {
      const diff = await gh.getPullRequestDiff(input.owner, input.repo, input.prNumber).catch(() => '');
      const linesByPath = new Map<string, Set<number>>();
      for (const f of parseUnifiedDiff(diff)) {
        const lines = new Set<number>();
        for (const h of f.hunks) for (const l of h.lines) if (l.newLineNumber != null) lines.add(l.newLineNumber);
        linesByPath.set(f.path, lines);
      }
      const comments: GitHubReviewComment[] = results.flatMap((r) => {
        const ok = linesByPath.get(r.fileName) ?? new Set<number>();
        return r.missingDocstrings
          .filter((d) => ok.has(d.line))
          .map((d) => ({
            path: r.fileName, line: d.line, side: 'RIGHT' as const,
            body: `Codra's Jules task asked for a docstring on \`${d.name}\`, but it still has none — please add one.`,
          }));
      });
      if (comments.length > 0) {
        await gh.createReview(input.owner, input.repo, input.prNumber, {
          commitSha: input.headSha, event: 'COMMENT',
          body: 'Codra verification: some docstrings from the assigned Jules task are still missing.',
          comments,
        });
      }
    } catch (err) {
      logger.warn('verify inline review failed', { error: err instanceof Error ? err.message : String(err) });
    }

    // SDK follow-up to the Jules session + PR conversation comment (full scope,
    // incl. functions not in the diff). Existing composed helper.
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
