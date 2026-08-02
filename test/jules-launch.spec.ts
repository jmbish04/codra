import { describe, it, expect, vi } from 'vitest';
import { launchStagedJulesSessions } from '@server/core/jules';
import * as db from '@server/db/jules-sessions';

function fakeEnv() { return { JULES_API_KEY: { get: async () => 'K' } } as any; }
function fakeGithub() {
  return {
    getRepo: async () => ({ default_branch: 'main' }),
    createIssueComment: vi.fn(async () => ({ id: 1 })),
    updateIssueComment: vi.fn(async () => ({ id: 1 })),
  } as any;
}

describe('launchStagedJulesSessions', () => {
  it('launches when the repo is a connected source', async () => {
    vi.spyOn(db, 'listStagedJulesSessions').mockResolvedValue([
      { id: 'row1', owner: 'o', repo: 'r', triggering_pr_number: 5, prompt: 'P', pr_comment_id: 9 } as any,
    ]);
    const marked = vi.spyOn(db, 'markJulesLaunched').mockResolvedValue();
    const deps = {
      isRepoConnected: async () => true,
      startJulesSession: async () => ({ id: 'sid', url: 'https://jules.google.com/session/sid', state: 'QUEUED', pullRequestUrl: null }),
    };
    const count = await launchStagedJulesSessions(fakeEnv(), fakeGithub(), { owner: 'o', repo: 'r', prNumber: 5 }, deps);
    expect(count).toBe(1);
    expect(marked).toHaveBeenCalledWith(expect.anything(), 'row1', expect.objectContaining({ sessionId: 'sid' }));
  });

  it('skips (not launched) when the repo is not connected', async () => {
    vi.spyOn(db, 'listStagedJulesSessions').mockResolvedValue([
      { id: 'row2', owner: 'o', repo: 'r', triggering_pr_number: 6, prompt: 'P', pr_comment_id: null } as any,
    ]);
    const outcome = vi.spyOn(db, 'markJulesOutcome').mockResolvedValue();
    const deps = { isRepoConnected: async () => false, startJulesSession: async () => { throw new Error('should not call'); } };
    const count = await launchStagedJulesSessions(fakeEnv(), fakeGithub(), { owner: 'o', repo: 'r', prNumber: 6 }, deps);
    expect(count).toBe(0);
    expect(outcome).toHaveBeenCalledWith(expect.anything(), 'row2', expect.objectContaining({ state: 'skipped' }));
  });

  it('comments on the PR and marks skipped when JULES_API_KEY is not configured', async () => {
    vi.spyOn(db, 'listStagedJulesSessions').mockResolvedValue([
      { id: 'row3', owner: 'o', repo: 'r', triggering_pr_number: 7, prompt: 'P', pr_comment_id: 42 } as any,
    ]);
    const outcome = vi.spyOn(db, 'markJulesOutcome').mockResolvedValue();
    const env = { JULES_API_KEY: { get: async () => '' } } as any;
    const github = fakeGithub();
    const count = await launchStagedJulesSessions(env, github, { owner: 'o', repo: 'r', prNumber: 7 });
    expect(count).toBe(0);
    expect(outcome).toHaveBeenCalledWith(expect.anything(), 'row3', expect.objectContaining({ state: 'skipped', errorMsg: 'JULES_API_KEY not configured' }));
    expect(github.updateIssueComment).toHaveBeenCalledWith('o', 'r', 42, expect.stringContaining('JULES_API_KEY'));
  });

  it('never throws on internal failure', async () => {
    vi.spyOn(db, 'listStagedJulesSessions').mockRejectedValue(new Error('db down'));
    await expect(launchStagedJulesSessions(fakeEnv(), fakeGithub(), { owner: 'o', repo: 'r', prNumber: 1 })).resolves.toBe(0);
  });
});
