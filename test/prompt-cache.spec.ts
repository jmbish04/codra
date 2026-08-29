import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { reviewWithAnthropic } from '@server/models/anthropic';
import { TokenTracker } from '@server/core/token-tracker';

describe('anthropic cache_control', () => {
  let calls: any[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      calls.push(JSON.parse(init.body));
      return new Response(JSON.stringify({
        content: [{ type: 'tool_use', input: { comments: [], verdict: 'approve' } }],
        usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 },
      }), { status: 200 });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends system as a cache_control block and surfaces cache tokens', async () => {
    const res = await reviewWithAnthropic(
      { apiKey: 'k', providerName: 'anthropic', baseUrl: null },
      'claude-x',
      { systemPrompt: 'STABLE SYSTEM', userPrompt: 'diff' },
      undefined,
      undefined,
      { system: true },
    );
    const body = calls[0];
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(res.cacheReadTokens).toBe(7);
    expect(res.cacheWriteTokens).toBe(3);
  });
});

describe('TokenTracker cache counters', () => {
  it('accumulates cache read/write', () => {
    const t = new TokenTracker();
    t.recordCache(5, 2);
    t.recordCache(3, 0);
    expect(t.getCacheUsage()).toEqual({ read: 8, write: 2 });
  });
});
