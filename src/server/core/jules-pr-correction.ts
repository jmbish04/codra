import { getSecretStoreBinding } from '@server/utils/secrets';
import { resolveSessionForPr } from '@server/db/jules-interactions';
import { sendJulesLogged } from '@server/services/jules-interactions';
import { logger } from '@server/core/logger';

type CorrectionComment = { path: string; line?: number | null; severity?: string | null; title?: string | null; body?: string | null };

interface CommentPoster {
  createIssueComment(owner: string, repo: string, issueNumber: number, body: string): Promise<unknown>;
}

/** Turn review findings into a concise, actionable instruction for Jules. */
export function buildCorrectionInstruction(prNumber: number, comments: CorrectionComment[]): string {
  const lines = comments.slice(0, 30).map((c) => {
    const loc = `${c.path}${c.line != null ? `:${c.line}` : ''}`;
    const sev = c.severity ? `[${c.severity}] ` : '';
    const body = (c.body ?? '').replace(/\s+/g, ' ').slice(0, 300);
    return `- ${loc} — ${sev}${c.title ?? ''}${body ? `: ${body}` : ''}`;
  }).join('\n');
  const more = comments.length > 30 ? `\n(+${comments.length - 30} more — see the full review on the PR)` : '';
  return [
    `Codra reviewed the pull request (#${prNumber}) you opened and is requesting changes.`,
    `Apply these fixes on this session's branch and update the PR:`,
    ``,
    lines + more,
  ].join('\n');
}

/**
 * When a reviewed PR was opened by a live Jules session, send the requested
 * corrections to Jules directly (SDK) in addition to the normal PR review, and
 * index the interaction. A jules_interactions row with status 'started'→'sent'
 * is the signal that codra has kicked off the Jules fix.
 */
export async function directCorrectionsToJules(
  env: Pick<Env, 'DB' | 'JULES_API_KEY'>, github: CommentPoster,
  ctx: { owner: string; repo: string; prNumber: number; comments: CorrectionComment[] },
): Promise<{ sent: boolean }> {
  try {
    const resolved = await resolveSessionForPr(env, ctx.owner, ctx.repo, ctx.prNumber);
    if (!resolved) return { sent: false };

    const apiKey = await getSecretStoreBinding(env, 'JULES_API_KEY').catch(() => '');
    if (!apiKey) return { sent: false };

    const instruction = buildCorrectionInstruction(ctx.prNumber, ctx.comments);
    const { ok } = await sendJulesLogged(env, apiKey, {
      sessionId: resolved.sessionId, kind: 'correction', text: instruction,
      repository: `${ctx.owner}/${ctx.repo}`, prNumber: ctx.prNumber,
    });
    if (!ok) return { sent: false };

    await github.createIssueComment(ctx.owner, ctx.repo, ctx.prNumber,
      `🤖 Codra sent these review corrections **directly to the Jules session** that opened this PR, so it can apply the fixes.`,
    ).catch(() => {});
    return { sent: true };
  } catch (err) {
    logger.warn('directCorrectionsToJules failed', { error: err instanceof Error ? err.message : String(err) });
    return { sent: false };
  }
}
