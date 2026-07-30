import { describe, it, expect, beforeEach } from 'vitest';
import {
  stageJulesSession, listStagedJulesSessions, markJulesLaunched, markJulesOutcome, listJulesSessions,
} from '@server/db/jules-sessions';
import { createTestEnv } from './helpers';

describe('jules-sessions db', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('stages, lists, launches, and reflects state', async () => {
    const row = await stageJulesSession(env, {
      owner: 'o', repo: 'r', triggeringPrNumber: 7, triggeringJobId: 'j1',
      prompt: 'P', gapSummary: 'gaps', prCommentId: 123,
    });
    expect(row.state).toBe('staged');

    const staged = await listStagedJulesSessions(env, { owner: 'o', repo: 'r', prNumber: 7 });
    expect(staged).toHaveLength(1);

    await markJulesLaunched(env, row.id, { sessionId: 'sid', sessionUrl: 'https://jules.google.com/session/sid', sessionState: 'QUEUED' });
    const afterLaunch = await listStagedJulesSessions(env, { owner: 'o', repo: 'r', prNumber: 7 });
    expect(afterLaunch).toHaveLength(0); // no longer 'staged'

    const all = await listJulesSessions(env, { limit: 10, offset: 0 });
    expect(all[0]).toMatchObject({ session_id: 'sid', state: 'launched' });
  });

  it('upserts an existing non-terminal staged row instead of duplicating', async () => {
    await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 9, prompt: 'A', gapSummary: 'g' });
    await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 9, prompt: 'B', gapSummary: 'g2' });
    const staged = await listStagedJulesSessions(env, { owner: 'o', repo: 'r', prNumber: 9 });
    expect(staged).toHaveLength(1);
    expect(staged[0].prompt).toBe('B');
  });

  it('marks skipped outcome', async () => {
    const row = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'P', gapSummary: 'g' });
    await markJulesOutcome(env, row.id, { state: 'skipped', errorMsg: 'not connected' });
    const all = await listJulesSessions(env, { limit: 10, offset: 0 });
    expect(all[0]).toMatchObject({ state: 'skipped', error_msg: 'not connected' });
  });
});
