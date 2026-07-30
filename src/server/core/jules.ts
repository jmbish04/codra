import { logger } from '@server/core/logger';
import { getSecretStoreBinding } from '@server/utils/secrets';
import { listStagedJulesSessions, markJulesLaunched, markJulesOutcome } from '@server/db/jules-sessions';
import { isRepoConnected as realIsRepoConnected, startJulesSession as realStartJulesSession } from '@server/services/jules';

type Deps = { isRepoConnected: typeof realIsRepoConnected; startJulesSession: typeof realStartJulesSession };
const DEFAULT_DEPS: Deps = { isRepoConnected: realIsRepoConnected, startJulesSession: realStartJulesSession };

type MergeGithub = {
  getRepo(owner: string, repo: string): Promise<{ default_branch: string }>;
  createIssueComment(owner: string, repo: string, issueNumber: number, body: string): Promise<{ id: number }>;
  updateIssueComment(owner: string, repo: string, commentId: number, body: string): Promise<unknown>;
};

/** On PR merge, launch any staged Jules docs sessions. Best-effort; never throws. */
export async function launchStagedJulesSessions(
  env: Env, github: MergeGithub, ctx: { owner: string; repo: string; prNumber: number; defaultBranch?: string },
  deps: Deps = DEFAULT_DEPS,
): Promise<number> {
  try {
    const staged = await listStagedJulesSessions(env, ctx);
    if (staged.length === 0) return 0;

    let apiKey = '';
    try { apiKey = await getSecretStoreBinding(env, 'JULES_API_KEY'); } catch { apiKey = ''; }
    if (!apiKey) {
      for (const row of staged) {
        await markJulesOutcome(env, row.id, { state: 'skipped', errorMsg: 'JULES_API_KEY not configured' }).catch(() => {});
        if (row.pr_comment_id != null) {
          await github.updateIssueComment(ctx.owner, ctx.repo, row.pr_comment_id,
            `📚 Codra staged a Jules docs session, but \`JULES_API_KEY\` is not configured, so no session was opened.`,
          ).catch(() => {});
        }
      }
      return 0;
    }

    const connected = await deps.isRepoConnected(apiKey, ctx.owner, ctx.repo).catch(() => false);
    if (!connected) {
      for (const row of staged) {
        await markJulesOutcome(env, row.id, { state: 'skipped', errorMsg: 'Repo is not connected to the Jules GitHub app' }).catch(() => {});
        if (row.pr_comment_id != null) {
          await github.updateIssueComment(ctx.owner, ctx.repo, row.pr_comment_id,
            `📚 Codra wanted to open a Jules docs session, but **${ctx.owner}/${ctx.repo}** is not connected to Jules. Connect it at https://jules.google.com and re-run.`,
          ).catch(() => {});
        }
      }
      return 0;
    }

    const branch = ctx.defaultBranch ?? (await github.getRepo(ctx.owner, ctx.repo).then((r) => r.default_branch).catch(() => 'main'));

    let launched = 0;
    for (const row of staged) {
      try {
        const s = await deps.startJulesSession(apiKey, { owner: ctx.owner, repo: ctx.repo, branch, prompt: row.prompt, title: 'Codra: documentation improvements' });
        await markJulesLaunched(env, row.id, { sessionId: s.id, sessionUrl: s.url, sessionState: s.state });
        launched++;
        const body = `✅ **Jules session opened** to address the documentation gaps.\n\n- Session: ${s.url}\n- ID: \`${s.id}\``;
        if (row.pr_comment_id != null) await github.updateIssueComment(ctx.owner, ctx.repo, row.pr_comment_id, body).catch(() => {});
        else await github.createIssueComment(ctx.owner, ctx.repo, ctx.prNumber, body).catch(() => {});
      } catch (err) {
        logger.error('Failed to launch Jules session', err instanceof Error ? err : new Error(String(err)));
        await markJulesOutcome(env, row.id, { state: 'error', errorMsg: String(err) }).catch(() => {});
      }
    }
    return launched;
  } catch (err) {
    logger.error('launchStagedJulesSessions failed', err instanceof Error ? err : new Error(String(err)));
    return 0;
  }
}
