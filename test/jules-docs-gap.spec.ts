import { describe, it, expect } from 'vitest';
import { buildJulesPrompt, evaluateDocsGaps, STALE_DAYS } from '@server/core/jules-docs-gap';

describe('buildJulesPrompt', () => {
  it('spells out doc-suite + routing and lists docstring targets, never overwriting', () => {
    const p = buildJulesPrompt({
      items: [
        { kind: 'readme', reason: 'missing' },
        { kind: 'frontend-docs', reason: 'no docs/ suite' },
        { kind: 'docstrings', reason: '2 files', docstrings: [{ path: 'a.ts', functions: ['foo', 'bar'] }] },
      ],
      summary: 'README, docs suite, docstrings',
    }, { owner: 'o', repo: 'r', defaultBranch: 'main', router: 'react-router-dom createBrowserRouter' });

    expect(p).toContain('README.md');
    expect(p).toContain('docs/'); // doc suite layout
    expect(p).toMatch(/never (overwrite|delete|remove) .*existing docstring/i);
    expect(p).toContain('a.ts');
    expect(p).toContain('foo');
    expect(p).toContain('react-router-dom'); // routing spelled out
  });
});

describe('evaluateDocsGaps (heuristic path)', () => {
  const fakeGithub: any = {
    getRepoFileWithRefOrNull: async (_o: string, _r: string, path: string) => {
      if (path === 'README.md') return null;        // missing README
      if (path === 'AGENTS.md') return { content: 'x'.repeat(500), sha: 's' }; // present
      return null;
    },
    getRepoTree: async () => ({ tree: [{ type: 'blob', path: 'src/index.ts' }] }), // no docs/ dir
    getFileLastCommitDate: async () => null,
    getPullRequestDiff: async () => '',
  };
  const throwingModel: any = { callModel: async () => { throw new Error('no model'); } };

  it('flags a missing README and an absent docs suite, tolerates model failure', async () => {
    const report = await evaluateDocsGaps(
      { DB: {} } as any, fakeGithub,
      { id: 'j', owner: 'o', repo: 'r', prNumber: 3, headSha: 'sha' },
      { model: { main: null } } as any,
      throwingModel,
    );
    const kinds = report.items.map((i) => i.kind);
    expect(kinds).toContain('readme');
    expect(kinds).toContain('frontend-docs');
    expect(report.summary.length).toBeGreaterThan(0);
  });

  it('exports a stale-days threshold', () => { expect(STALE_DAYS).toBe(180); });
});
