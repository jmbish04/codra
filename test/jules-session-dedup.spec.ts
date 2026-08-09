import { describe, it, expect, beforeEach } from 'vitest';
import { stageJulesSession } from '@server/db/jules-sessions';
import { createTestEnv } from './helpers';

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
