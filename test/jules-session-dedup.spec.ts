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
});
