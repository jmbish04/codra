import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  stageJulesSession, markJulesLaunched, markJulesFolded, findOutstandingCodraDocsSession, getJulesSessionById,
} from '@server/db/jules-sessions';
import { setJulesSessionCreatedPr } from '@server/db/jules-interactions';
import { getDb } from '@server/db/client';
import { julesSessions } from '@server/db/schemas';
import { createTestEnv } from './helpers';
import { collectTargetFiles } from '@server/core/jules-docs-gap';
import { foldIntoOutstandingDocsSession, launchStagedJulesSessions } from '@server/core/jules';

// The launch→fold wiring test exercises the REAL sendJulesLogged path, so the
// SDK's outbound message is stubbed; everything else stays the actual module.
vi.mock('@server/services/jules', async (importActual) => ({
  ...(await importActual<typeof import('@server/services/jules')>()),
  sendJulesMessage: vi.fn(async () => {}),
}));

describe('jules_sessions ledger columns', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('stamps INTERNAL_CODRA / docs defaults and stores target_files', async () => {
    const row = await stageJulesSession(env, {
      owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'p', gapSummary: 'g',
    });
    expect(row.category).toBe('INTERNAL_CODRA');
    expect(row.kind).toBe('docs');
    expect(row.target_files).toEqual([]);
  });
});

describe('stageJulesSession threads ledger fields', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('persists explicit targetFiles and keeps them on update', async () => {
    const first = await stageJulesSession(env, {
      owner: 'o', repo: 'r', triggeringPrNumber: 2, prompt: 'p1', gapSummary: 'g1',
      targetFiles: ['src/a.ts', 'src/b.ts'],
    });
    expect(first.target_files).toEqual(['src/a.ts', 'src/b.ts']);

    // Re-stage the same PR (upsert path): new files replace the old set.
    const second = await stageJulesSession(env, {
      owner: 'o', repo: 'r', triggeringPrNumber: 2, prompt: 'p2', gapSummary: 'g2',
      targetFiles: ['src/c.ts'],
    });
    expect(second.id).toBe(first.id);
    expect(second.target_files).toEqual(['src/c.ts']);
  });

  it('preserves existing targetFiles when update omits the field', async () => {
    const first = await stageJulesSession(env, {
      owner: 'o', repo: 'r', triggeringPrNumber: 3, prompt: 'p1', gapSummary: 'g1',
      targetFiles: ['src/x.ts'],
    });
    expect(first.target_files).toEqual(['src/x.ts']);

    // Re-stage the same PR WITHOUT targetFiles: existing set should be preserved.
    const second = await stageJulesSession(env, {
      owner: 'o', repo: 'r', triggeringPrNumber: 3, prompt: 'p2', gapSummary: 'g2',
    });
    expect(second.id).toBe(first.id);
    expect(second.target_files).toEqual(['src/x.ts']);
  });

  it('preserves existing targetFiles when the update passes an empty array', async () => {
    const first = await stageJulesSession(env, {
      owner: 'o', repo: 'r', triggeringPrNumber: 4, prompt: 'p1', gapSummary: 'g1',
      targetFiles: ['src/y.ts'],
    });
    expect(first.target_files).toEqual(['src/y.ts']);

    // A re-review that finds no docstring gaps passes []: that carries no new
    // information, so the previously-captured paths must survive.
    const second = await stageJulesSession(env, {
      owner: 'o', repo: 'r', triggeringPrNumber: 4, prompt: 'p2', gapSummary: 'g2',
      targetFiles: [],
    });
    expect(second.id).toBe(first.id);
    expect(second.target_files).toEqual(['src/y.ts']);
  });
});

describe('markJulesFolded', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('marks the folded row skipped with the session link and merges target files', async () => {
    const outstanding = await stageJulesSession(env, {
      owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'first', gapSummary: 'g',
      targetFiles: ['src/a.ts', 'src/b.ts'],
    });
    await markJulesLaunched(env, outstanding.id, { sessionId: 'sess-A', sessionUrl: 'u', sessionState: 'IN_PROGRESS' });

    const foldedRow = await stageJulesSession(env, {
      owner: 'o', repo: 'r', triggeringPrNumber: 2, prompt: 'second', gapSummary: 'g2',
      targetFiles: ['src/b.ts', 'src/c.ts'],
    });

    await markJulesFolded(env, foldedRow.id, {
      sessionId: 'sess-A', sessionUrl: 'u', sessionRowId: outstanding.id,
      mergeTargetFiles: ['src/b.ts', 'src/c.ts'],
    });

    const after = await getJulesSessionById(env, foldedRow.id);
    expect(after?.state).toBe('skipped');
    expect(after?.session_id).toBe('sess-A');
    expect(after?.session_url).toBe('u');

    const merged = await getJulesSessionById(env, outstanding.id);
    expect(merged?.target_files).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });
});

describe('findOutstandingCodraDocsSession', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  async function launched(owner: string, repo: string, pr: number, sessionId: string) {
    const s = await stageJulesSession(env, { owner, repo, triggeringPrNumber: pr, prompt: 'p', gapSummary: 'g' });
    await markJulesLaunched(env, s.id, { sessionId, sessionUrl: 'u', sessionState: 'IN_PROGRESS' });
    return s;
  }

  it('finds a launched docs session with no PR yet', async () => {
    await launched('o', 'r', 1, 'sess-A');
    const found = await findOutstandingCodraDocsSession(env, { owner: 'o', repo: 'r' });
    expect(found?.session_id).toBe('sess-A');
  });

  it('ignores a session that already opened a PR', async () => {
    await launched('o', 'r', 1, 'sess-A');
    await setJulesSessionCreatedPr(env, 'sess-A', { number: 5, url: 'https://github.com/o/r/pull/5' });
    expect(await findOutstandingCodraDocsSession(env, { owner: 'o', repo: 'r' })).toBeNull();
  });

  it('ignores still-staged (not launched) sessions and other repos', async () => {
    await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'p', gapSummary: 'g' });
    await launched('o', 'other', 1, 'sess-B');
    expect(await findOutstandingCodraDocsSession(env, { owner: 'o', repo: 'r' })).toBeNull();
  });

  it('returns a session launched within the recency window', async () => {
    await launched('o', 'r', 1, 'sess-NEW');
    const found = await findOutstandingCodraDocsSession(env, { owner: 'o', repo: 'r' });
    expect(found?.session_id).toBe('sess-NEW');
  });

  it('ignores a stalled session launched outside the recency window', async () => {
    await launched('o', 'r', 1, 'sess-OLD');
    await getDb(env).update(julesSessions)
      .set({ updated_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString() })
      .where(eq(julesSessions.session_id, 'sess-OLD'));
    expect(await findOutstandingCodraDocsSession(env, { owner: 'o', repo: 'r' })).toBeNull();
  });

  it('prefers the most recently launched session', async () => {
    await launched('o', 'r', 1, 'sess-OLDER');
    await getDb(env).update(julesSessions)
      .set({ updated_at: new Date(Date.now() - 3600 * 1000).toISOString() })
      .where(eq(julesSessions.session_id, 'sess-OLDER'));
    await launched('o', 'r', 2, 'sess-NEWER');
    const found = await findOutstandingCodraDocsSession(env, { owner: 'o', repo: 'r' });
    expect(found?.session_id).toBe('sess-NEWER');
  });
});

describe('collectTargetFiles', () => {
  it('flattens docstring gap paths, ignoring non-docstring items', () => {
    const report = {
      summary: 's',
      items: [
        { kind: 'readme', reason: 'r' },
        { kind: 'docstrings', reason: 'r', docstrings: [
          { path: 'src/a.ts', functions: ['f'] },
          { path: 'src/b.ts', functions: ['g', 'h'] },
        ] },
      ],
    } as const;
    expect(collectTargetFiles(report as any)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('returns [] when there are no docstring items', () => {
    expect(collectTargetFiles({ summary: 's', items: [] } as any)).toEqual([]);
  });

  it('dedupes a path repeated across docstring items', () => {
    const report = {
      summary: 's',
      items: [
        { kind: 'docstrings', reason: 'r', docstrings: [{ path: 'src/a.ts', functions: ['f'] }] },
        { kind: 'docstrings', reason: 'r', docstrings: [
          { path: 'src/a.ts', functions: ['g'] },
          { path: 'src/b.ts', functions: ['h'] },
        ] },
      ],
    } as const;
    expect(collectTargetFiles(report as any)).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('foldIntoOutstandingDocsSession', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  function fakeGithub() {
    const calls: any[] = [];
    return {
      calls,
      getRepo: async () => ({ default_branch: 'main' }),
      createIssueComment: async (_o: string, _r: string, n: number, body: string) => { calls.push({ n, body }); return { id: 1 }; },
      updateIssueComment: async (_o: string, _r: string, id: number, body: string) => { calls.push({ id, body }); return {}; },
    };
  }

  it('folds into a running session and does not launch a new one', async () => {
    // Seed an outstanding launched session for the repo.
    const running = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'first', gapSummary: 'g' });
    await markJulesLaunched(env, running.id, { sessionId: 'sess-A', sessionUrl: 'u', sessionState: 'IN_PROGRESS' });

    // A fresh staged row from a later PR.
    const next = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 2, prompt: 'second', gapSummary: 'g2' });

    const sends: any[] = [];
    const send = async (_e: any, _k: string, input: any) => { sends.push(input); return { ok: true, interactionId: 'x' }; };

    const folded = await foldIntoOutstandingDocsSession(
      env, 'api-key', fakeGithub(), { owner: 'o', repo: 'r', prNumber: 2 }, next, send as any,
    );

    expect(folded).toBe(true);
    expect(sends).toHaveLength(1);
    // The follow-up is a reframed summary of the new gaps, not the raw kickoff
    // prompt (whose "this pull request" would alias the running session's PR).
    expect(sends[0]).toMatchObject({
      sessionId: 'sess-A', kind: 'improve',
      text: 'Additional documentation gaps found in a later PR (#2) for o/r. Please also address these in this session:\n\ng2',
    });
    const after = await getJulesSessionById(env, next.id);
    expect(after?.state).toBe('skipped');
  });

  it('returns false when no session is running (caller launches normally)', async () => {
    const row = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'p', gapSummary: 'g' });
    const send = async () => ({ ok: true, interactionId: 'x' });
    const folded = await foldIntoOutstandingDocsSession(
      env, 'api-key', fakeGithub(), { owner: 'o', repo: 'r', prNumber: 1 }, row, send as any,
    );
    expect(folded).toBe(false);
  });

  it('never folds an EXTERNAL_MANUAL row into a docs session', async () => {
    const running = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'first', gapSummary: 'g' });
    await markJulesLaunched(env, running.id, { sessionId: 'sess-A', sessionUrl: 'u', sessionState: 'IN_PROGRESS' });

    const external = await stageJulesSession(env, {
      owner: 'o', repo: 'r', triggeringPrNumber: 2, prompt: 'external task', gapSummary: 'g2',
      category: 'EXTERNAL_MANUAL',
    });

    const sends: any[] = [];
    const send = async (_e: any, _k: string, input: any) => { sends.push(input); return { ok: true, interactionId: 'x' }; };

    const folded = await foldIntoOutstandingDocsSession(
      env, 'api-key', fakeGithub(), { owner: 'o', repo: 'r', prNumber: 2 }, external, send as any,
    );

    expect(folded).toBe(false);
    expect(sends).toHaveLength(0);
  });

  it('does not mark the row skipped when the send fails', async () => {
    // Seed an outstanding launched session for the repo.
    const running = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'first', gapSummary: 'g' });
    await markJulesLaunched(env, running.id, { sessionId: 'sess-A', sessionUrl: 'u', sessionState: 'IN_PROGRESS' });

    // A fresh staged row from a later PR whose send to the outstanding session fails.
    const next = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 2, prompt: 'second', gapSummary: 'g2' });
    const sendFail = async () => ({ ok: false, interactionId: 'x' });

    const folded = await foldIntoOutstandingDocsSession(
      env, 'api-key', fakeGithub(), { owner: 'o', repo: 'r', prNumber: 2 }, next, sendFail as any,
    );

    expect(folded).toBe(false);
    const after = await getJulesSessionById(env, next.id);
    expect(after?.state).not.toBe('skipped');
  });
});

describe('launchStagedJulesSessions folds instead of launching a duplicate', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv({ JULES_API_KEY: { get: async () => 'K' } } as any); });

  function fakeGithub() {
    return {
      getRepo: async () => ({ default_branch: 'main' }),
      createIssueComment: vi.fn(async () => ({ id: 1 })),
      updateIssueComment: vi.fn(async () => ({ id: 1 })),
    } as any;
  }

  it('folds a new docs task into the running session and does not launch', async () => {
    // A docs session already running for the repo (launched, no PR yet).
    const running = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'p', gapSummary: 'g', targetFiles: ['src/a.ts'] });
    await markJulesLaunched(env, running.id, { sessionId: 'sess-A', sessionUrl: 'u', sessionState: 'IN_PROGRESS' });
    // A new staged docs task from a later merged PR.
    const next = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 2, prompt: 'p2', gapSummary: 'g2', targetFiles: ['src/b.ts'] });

    const startSpy = vi.fn(async () => { throw new Error('should not launch a duplicate'); });
    const deps = { isRepoConnected: async () => true, startJulesSession: startSpy } as any;

    const launched = await launchStagedJulesSessions(env, fakeGithub(), { owner: 'o', repo: 'r', prNumber: 2 }, deps);

    expect(startSpy).not.toHaveBeenCalled();       // no duplicate launch
    expect(launched).toBe(0);                       // nothing launched (folded)
    const after = await getJulesSessionById(env, next.id);
    expect(after?.state).toBe('skipped');           // folded row marked skipped
    expect(after?.session_id).toBe('sess-A');       // and linked to the session that got the work
  });
});
