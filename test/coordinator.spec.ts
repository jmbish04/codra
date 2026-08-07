import { describe, expect, it, vi } from 'vitest';
import { coordinateFindings, parseCoordinatorKeep, windowSourceLines } from '@server/core/coordinator';

const c = (over: any) => ({ path: 'a.ts', line: 1, position: 1, severity: 'P2',
  category: 'security', title: 't', body: 'b', confidenceScore: 0.9, ...over });

describe('coordinateFindings', () => {
  it('keeps only the coordinator-approved indices', async () => {
    const comments = [c({ title: 'dup' }), c({ title: 'dup' }), c({ title: 'real' })];
    const runModel = vi.fn(async () => ({ keep: [0, 2] })); // collapse the duplicate
    const out = await coordinateFindings({ comments, sharedContext: 'S', runModel, fetchSource: async () => null });
    expect(out.map((x) => x.title)).toEqual(['dup', 'real']);
  });

  it('passes findings through unchanged when the coordinator model throws', async () => {
    const comments = [c({}), c({})];
    const runModel = vi.fn(async () => { throw new Error('provider down'); });
    const out = await coordinateFindings({ comments, sharedContext: 'S', runModel, fetchSource: async () => null });
    expect(out).toHaveLength(2);
  });

  it('short-circuits with 0 or 1 findings (no model call)', async () => {
    const runModel = vi.fn(async () => ({ keep: [] }));
    const out = await coordinateFindings({ comments: [c({})], sharedContext: 'S', runModel, fetchSource: async () => null });
    expect(runModel).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
  });
});

describe('windowSourceLines', () => {
  it('returns a window centered on the given line', () => {
    const content = Array.from({ length: 100 }, (_, i) => `line${i + 1}`).join('\n');
    const out = windowSourceLines(content, 50, 5);
    expect(out.split('\n')).toEqual(['line45', 'line46', 'line47', 'line48', 'line49', 'line50', 'line51', 'line52', 'line53', 'line54', 'line55']);
  });

  it('clamps the window at the start of the file', () => {
    const content = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n');
    const out = windowSourceLines(content, 2, 5);
    expect(out.split('\n')[0]).toBe('line1');
  });

  it('returns the file head when line is null', () => {
    const content = Array.from({ length: 100 }, (_, i) => `line${i + 1}`).join('\n');
    const out = windowSourceLines(content, null, 5);
    expect(out.split('\n')).toEqual(Array.from({ length: 10 }, (_, i) => `line${i + 1}`));
  });
});

describe('parseCoordinatorKeep', () => {
  it('parses a well-formed keep array', () => {
    expect(parseCoordinatorKeep('{"keep":[0,2]}')).toEqual({ keep: [0, 2] });
  });

  it('defaults to an empty array when keep is missing or malformed', () => {
    expect(parseCoordinatorKeep('{}')).toEqual({ keep: [] });
    expect(parseCoordinatorKeep('{"keep":"nope"}')).toEqual({ keep: [] });
  });
});
