import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordInteraction, updateInteractionStatus, listInteractions,
  setJulesSessionCreatedPr, resolveSessionForPr,
} from '@server/db/jules-interactions';
import { stageJulesSession, markJulesLaunched } from '@server/db/jules-sessions';
import { createOrchestrationTask, updateTaskStatus } from '@server/db/jules-orchestration';
import { createTestEnv } from './helpers';

describe('jules-interactions db', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('records interactions and updates status', async () => {
    const row = await recordInteraction(env, { sessionId: 's1', repository: 'o/r', prNumber: 5, kind: 'correction', text: 'fix X', status: 'started' });
    expect(row.status).toBe('started');
    await updateInteractionStatus(env, row.id, 'sent');
    const list = await listInteractions(env, { sessionId: 's1' });
    expect(list[0]).toMatchObject({ kind: 'correction', status: 'sent', pr_number: 5 });
  });

  it('resolves a PR to a codra-launched Jules session by captured PR number', async () => {
    const staged = await stageJulesSession(env, { owner: 'o', repo: 'r', triggeringPrNumber: 1, prompt: 'p', gapSummary: 'g' });
    await markJulesLaunched(env, staged.id, { sessionId: 'sess-A', sessionUrl: 'u', sessionState: 'QUEUED' });
    await setJulesSessionCreatedPr(env, 'sess-A', { number: 42, url: 'https://github.com/o/r/pull/42' });

    expect(await resolveSessionForPr(env, 'o', 'r', 42)).toEqual({ sessionId: 'sess-A', source: 'jules_session' });
    expect(await resolveSessionForPr(env, 'o', 'r', 99)).toBeNull();
  });

  it('resolves a PR to an orchestration session by last_pr_url', async () => {
    const t = await createOrchestrationTask(env, { packageId: 'p', repositoryId: 1 });
    await updateTaskStatus(env, t.task_id, { status: 'executing', sessionId: 'sess-B', lastPrUrl: 'https://github.com/o/r/pull/7' });
    expect(await resolveSessionForPr(env, 'o', 'r', 7)).toEqual({ sessionId: 'sess-B', source: 'orchestration' });
  });
});
