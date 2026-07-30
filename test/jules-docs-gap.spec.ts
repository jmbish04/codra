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
    }, { owner: 'o', repo: 'r', defaultBranch: 'main', router: "Match the repository's existing routing setup — inspect how routes/pages are already registered (e.g. react-router, Next.js app router, file-based routing) and follow that exact pattern; do NOT assume a framework. This repo uses react-router-dom." });

    expect(p).toContain('README.md');
    expect(p).toContain('docs/'); // doc suite layout
    expect(p).toMatch(/never (overwrite|delete|remove) .*existing docstring/i);
    expect(p).toContain('a.ts');
    expect(p).toContain('foo');
    expect(p).toContain('react-router-dom'); // routing spelled out
  });
});

describe('evaluateDocsGaps (heuristic path)', () => {
  const throwingModel: any = { callModel: async () => { throw new Error('no model'); } };

  const makeGithub = (tree: { type: string; path: string }[]): any => ({
    getRepoFileWithRefOrNull: async (_o: string, _r: string, path: string) => {
      if (path === 'README.md') return null;        // missing README
      if (path === 'AGENTS.md') return { content: 'x'.repeat(500), sha: 's' }; // present
      return null;
    },
    getRepoTree: async () => ({ tree }),
    getFileLastCommitDate: async () => null,
    getPullRequestDiff: async () => '',
  });

  it('flags a missing README and an absent docs suite for a repo with a frontend', async () => {
    const fakeGithub = makeGithub([{ type: 'blob', path: 'src/client/App.tsx' }]);
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

  it('never flags frontend-docs for a backend-only repo (no frontend, no docs/)', async () => {
    const fakeGithub = makeGithub([{ type: 'blob', path: 'src/index.ts' }]);
    const report = await evaluateDocsGaps(
      { DB: {} } as any, fakeGithub,
      { id: 'j', owner: 'o', repo: 'r', prNumber: 3, headSha: 'sha' },
      { model: { main: null } } as any,
      throwingModel,
    );
    const kinds = report.items.map((i) => i.kind);
    expect(kinds).toContain('readme');
    expect(kinds).not.toContain('frontend-docs');
    expect(report.summary.length).toBeGreaterThan(0);
  });

  it('exports a stale-days threshold', () => { expect(STALE_DAYS).toBe(180); });
});

describe('evaluateDocsGaps (docstrings gate)', () => {
  const fakeGithub: any = {
    getRepoFileWithRefOrNull: async (_o: string, _r: string, path: string) => {
      if (path === 'README.md') return { content: 'x'.repeat(500), sha: 's' }; // present
      if (path === 'AGENTS.md') return { content: 'x'.repeat(500), sha: 's' }; // present
      if (path === 'src/index.ts') return { content: 'function foo() {}\nfunction bar() {}\n', sha: 's' }; // changed file body: 2 missing, 0 documented -> requiresJulesTask
      return null;
    },
    getRepoTree: async () => ({ tree: [{ type: 'blob', path: 'src/index.ts' }] }),
    getFileLastCommitDate: async () => null,
    getPullRequestDiff: async () => [
      'diff --git a/src/index.ts b/src/index.ts',
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
      '@@ -1,2 +1,2 @@',
      '+function foo() {}',
      '+function bar() {}',
      '',
    ].join('\n'),
  };
  const throwingModel: any = { callModel: async () => { throw new Error('no model'); } };

  it('only flags docstrings when missing > documented (requiresJulesTask)', async () => {
    const report = await evaluateDocsGaps(
      { DB: {} } as any, fakeGithub,
      { id: 'j', owner: 'o', repo: 'r', prNumber: 3, headSha: 'sha' },
      { model: { main: null } } as any,
      throwingModel,
    );
    const kinds = report.items.map((i) => i.kind);
    expect(kinds).toContain('docstrings');
    const docItem = report.items.find((i) => i.kind === 'docstrings');
    expect(docItem?.docstrings?.[0]?.functions).toEqual(expect.arrayContaining(['foo', 'bar']));
  });
});
