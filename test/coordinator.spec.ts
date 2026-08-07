import { describe, expect, it, vi } from 'vitest';
import { coordinateFindings } from '@server/core/coordinator';

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
