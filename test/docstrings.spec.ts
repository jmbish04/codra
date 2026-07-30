import { describe, it, expect } from 'vitest';
import { analyzePrFileDocstrings, analyzeChangedFiles } from '@server/core/docstrings';

describe('analyzePrFileDocstrings', () => {
  it('flags a TS function missing JSDoc and counts one with it', () => {
    const src = [
      '/** does a thing */',
      'export function documented() { return 1; }',
      'export function undocumented() { return 2; }',
    ].join('\n');
    const r = analyzePrFileDocstrings('a.ts', src);
    expect(r.totalFunctions).toBe(2);
    expect(r.functionsWithDocstrings).toBe(1);
    expect(r.functionsMissingDocstrings).toEqual(['undocumented']);
  });

  it('detects Python docstrings under a def', () => {
    const src = ['def a():', '    """doc"""', '    return 1', 'def b():', '    return 2'].join('\n');
    const r = analyzePrFileDocstrings('x.py', src);
    expect(r.functionsWithDocstrings).toBe(1);
    expect(r.functionsMissingDocstrings).toEqual(['b']);
  });

  it('detects SQL function comments', () => {
    const src = ['-- comment', 'CREATE FUNCTION foo() RETURNS int AS $$ $$;', 'CREATE PROCEDURE bar() AS $$ $$;'].join('\n');
    const r = analyzePrFileDocstrings('s.sql', src);
    expect(r.functionsWithDocstrings).toBe(1);
    expect(r.functionsMissingDocstrings).toEqual(['bar']);
  });

  it('sets requiresJulesTask when missing outnumber documented', () => {
    const src = 'export function a(){}\nexport function b(){}\n/** d */\nexport function c(){}';
    expect(analyzePrFileDocstrings('a.ts', src).requiresJulesTask).toBe(true);
  });

  it('ignores unsupported extensions', () => {
    const r = analyzePrFileDocstrings('README.md', '# hi');
    expect(r.totalFunctions).toBe(0);
    expect(r.requiresJulesTask).toBe(false);
  });
});

describe('analyzeChangedFiles', () => {
  it('returns only files with missing docstrings', () => {
    const out = analyzeChangedFiles([
      { path: 'good.ts', content: '/** d */\nexport function a(){}' },
      { path: 'bad.ts', content: 'export function b(){}' },
      { path: 'note.md', content: 'x' },
    ]);
    expect(out.map((r) => r.fileName)).toEqual(['bad.ts']);
  });
});
