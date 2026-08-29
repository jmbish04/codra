import { describe, expect, it, vi, beforeEach } from 'vitest';
import { reviewWithAnthropic } from '@server/models/anthropic';
import { TokenTracker } from '@server/core/token-tracker';
import { createTestEnv } from './helpers';
import { runGuardianInference, type GuardianInferenceResult } from '@server/core/guardian-ai';

// Inference routes through core-guardian; mock the transport seam and assert on
// the native Anthropic request body Codra builds (now the `input` arg).
vi.mock('@server/core/guardian-ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@server/core/guardian-ai')>();
  return { ...actual, runGuardianInference: vi.fn() };
});
const runMock = vi.mocked(runGuardianInference);

describe('anthropic cache_control', () => {
  beforeEach(() => {
    runMock.mockReset();
    runMock.mockResolvedValue({
      body: {
        content: [{ type: 'tool_use', input: { comments: [], verdict: 'approve' } }],
        usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 },
      },
      tokensIn: 10,
      tokensOut: 2,
      costUsd: 0,
      provider: 'anthropic',
      model: 'claude-x',
      requestUuid: 'uuid',
    } satisfies GuardianInferenceResult);
  });

  it('sends system as a cache_control block and surfaces cache tokens', async () => {
    const res = await reviewWithAnthropic(
      createTestEnv(),
      'claude-x',
      { systemPrompt: 'STABLE SYSTEM', userPrompt: 'diff' },
      undefined,
      undefined,
      { system: true },
    );
    const body = runMock.mock.calls[0][3] as any;
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
