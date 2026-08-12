import { describe, it, expect, beforeEach } from 'vitest';
import { detectJulesTaskId, classifyAndLinkJulesPr } from '@server/core/jules-pr';
import { stageJulesSession, markJulesLaunched, findJulesSessionBySessionId, getJulesSessionById } from '@server/db/jules-sessions';
import { setJulesSessionCreatedPr } from '@server/db/jules-interactions';
import { getDb } from '@server/db/client';
import { julesSessions } from '@server/db/schemas';
import { eq } from 'drizzle-orm';
import { createTestEnv } from './helpers';

describe('detectJulesTaskId', () => {
  it('extracts the id from the Jules PR body', () => {
    const body = 'Closes gaps.\n\n---\n*PR created automatically by Jules for task [6837743215401320221](https://jules.google.com/task/6837743215401320221) started by @jmbish04*';
    expect(detectJulesTaskId({ body, headRef: 'whatever' })).toBe('6837743215401320221');
  });

  it('falls back to the branch name when the body has no marker', () => {
    expect(detectJulesTaskId({ body: 'manual PR', headRef: 'jules-docs-gaps-6837743215401320221' })).toBe('6837743215401320221');
  });

  it('returns null for a non-Jules PR', () => {
    expect(detectJulesTaskId({ body: 'a normal PR', headRef: 'feature/foo' })).toBeNull();
    expect(detectJulesTaskId({ body: null, headRef: 'main' })).toBeNull();
  });
});

describe('findJulesSessionBySessionId', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('finds a launched session by its session_id, else null', async () => {
    const s = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'p', gapSummary: 'g' });
    await markJulesLaunched(env, s.id, { sessionId: '6837743215401320221', sessionUrl: 'u', sessionState: 'IN_PROGRESS' });
    const found = await findJulesSessionBySessionId(env, '6837743215401320221');
    expect(found?.session_id).toBe('6837743215401320221');
    expect(found?.category).toBe('INTERNAL_CODRA');
    expect(await findJulesSessionBySessionId(env, '404')).toBeNull();
  });
});

describe('classifyAndLinkJulesPr', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('links a Codra Jules PR and signals divert', async () => {
    const s = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'p', gapSummary: 'g' });
    await markJulesLaunched(env, s.id, { sessionId: '6837743215401320221', sessionUrl: 'u', sessionState: 'IN_PROGRESS' });

    const res = await classifyAndLinkJulesPr(env, {
      owner: 'o', repo: 'r', prNumber: 42, prUrl: 'https://github.com/o/r/pull/42',
      body: 'x https://jules.google.com/task/6837743215401320221 y', headRef: 'jules-docs-gaps-6837743215401320221',
    });

    expect(res.kind).toBe('diverted');
    expect(res.kind === 'diverted' && res.session.session_id).toBe('6837743215401320221');
    const after = await getJulesSessionById(env, s.id);
    expect(after?.created_pr_number).toBe(42);
    expect(after?.created_pr_url).toBe('https://github.com/o/r/pull/42');
  });

  it('does not divert a non-Jules PR', async () => {
    const res = await classifyAndLinkJulesPr(env, {
      owner: 'o', repo: 'r', prNumber: 5, prUrl: 'u', body: 'normal', headRef: 'feature/x',
    });
    expect(res.kind).toBe('none');
  });

  it('classifies as external when the task id matches no Codra session', async () => {
    const res = await classifyAndLinkJulesPr(env, {
      owner: 'o', repo: 'r', prNumber: 6, prUrl: 'u',
      body: 'https://jules.google.com/task/999999', headRef: 'jules-x-999999',
    });
    expect(res.kind).toBe('external');
    expect(res.kind === 'external' && res.taskId).toBe('999999');
  });

  it('classifies as external for a task id from a different repo (spoof)', async () => {
    const s = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'p', gapSummary: 'g' });
    await markJulesLaunched(env, s.id, { sessionId: '6837743215401320221', sessionUrl: 'u', sessionState: 'IN_PROGRESS' });

    const res = await classifyAndLinkJulesPr(env, {
      owner: 'o', repo: 'OTHER', prNumber: 99, prUrl: 'u',
      body: 'x https://jules.google.com/task/6837743215401320221 y', headRef: 'jules-docs-gaps-6837743215401320221',
    });

    expect(res.kind).toBe('external');
    const original = await getJulesSessionById(env, s.id);
    expect(original?.created_pr_number).toBeNull();
  });

  it('classifies as external for an already-linked session on a different PR', async () => {
    const s = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'p', gapSummary: 'g' });
    await markJulesLaunched(env, s.id, { sessionId: '6837743215401320221', sessionUrl: 'u', sessionState: 'IN_PROGRESS' });
    await setJulesSessionCreatedPr(env, '6837743215401320221', { number: 42, url: 'u' });

    const res = await classifyAndLinkJulesPr(env, {
      owner: 'o', repo: 'r', prNumber: 99, prUrl: 'u2',
      body: 'x https://jules.google.com/task/6837743215401320221 y', headRef: 'jules-docs-gaps-6837743215401320221',
    });

    expect(res.kind).toBe('external');
  });

  it('diverts idempotently on re-delivery of the same PR', async () => {
    const s = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'p', gapSummary: 'g' });
    await markJulesLaunched(env, s.id, { sessionId: '6837743215401320221', sessionUrl: 'u', sessionState: 'IN_PROGRESS' });

    const prPayload = {
      owner: 'o', repo: 'r', prNumber: 42, prUrl: 'u',
      body: 'x https://jules.google.com/task/6837743215401320221 y', headRef: 'jules-docs-gaps-6837743215401320221',
    };

    const res1 = await classifyAndLinkJulesPr(env, prPayload);
    expect(res1.kind).toBe('diverted');
    const after1 = await getJulesSessionById(env, s.id);
    expect(after1?.created_pr_number).toBe(42);

    const res2 = await classifyAndLinkJulesPr(env, prPayload);
    expect(res2.kind).toBe('diverted');
    const after2 = await getJulesSessionById(env, s.id);
    expect(after2?.created_pr_number).toBe(42);
  });

  it('does not divert a stale launched session (guessed old task id)', async () => {
    const s = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'p', gapSummary: 'g' });
    await markJulesLaunched(env, s.id, { sessionId: '6837743215401320221', sessionUrl: 'u', sessionState: 'IN_PROGRESS' });
    // Age the session past the 7-day divert window.
    await getDb(env).update(julesSessions)
      .set({ updated_at: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString() })
      .where(eq(julesSessions.session_id, '6837743215401320221'));

    const res = await classifyAndLinkJulesPr(env, {
      owner: 'o', repo: 'r', prNumber: 7, prUrl: 'u',
      body: 'x https://jules.google.com/task/6837743215401320221 y', headRef: 'jules-docs-gaps-6837743215401320221',
    });

    expect(res.kind).toBe('external'); // too old to divert → not treated as Codra's
    const after = await getJulesSessionById(env, s.id);
    expect(after?.created_pr_number).toBeNull(); // link not corrupted
  });
});
