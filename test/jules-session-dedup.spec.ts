import { describe, it, expect, beforeEach } from 'vitest';
import { stageJulesSession, markJulesLaunched, findOutstandingCodraDocsSession } from '@server/db/jules-sessions';
import { setJulesSessionCreatedPr } from '@server/db/jules-interactions';
import { createTestEnv } from './helpers';
import { collectTargetFiles } from '@server/core/jules-docs-gap';

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
});
