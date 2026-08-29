import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveWorkersAiAccounts, runWorkersAiWithFallback } from '@server/models/workers-ai';
import { createTestEnv } from './helpers';

const PAYLOAD = { messages: [{ role: 'user', content: 'hi' }] };

function withFreebie(env: any) {
  env.CF_FREEBIE_API_TOKEN = { get: async () => 'freebie-token' };
  env.CF_FREEBIE_ACCOUNT_ID = { get: async () => 'freebie-acct' };
  return env;
}

function ok(response: string) {
  return new Response(JSON.stringify({ result: { response, usage: { prompt_tokens: 1, completion_tokens: 1 } } }), { status: 200 });
}

describe('Workers AI account resolution + REST fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('orders the free account before the primary account', async () => {
    const accounts = await resolveWorkersAiAccounts(withFreebie(createTestEnv()));
    expect(accounts.map((a) => a.label)).toEqual(['freebie', 'primary']);
    expect(accounts[0].accountId).toBe('freebie-acct');
  });

  it('runs on the free account first when it is configured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok('from-freebie'));
    const { account } = await runWorkersAiWithFallback(withFreebie(createTestEnv()), '@cf/some/model', PAYLOAD);

    expect(account.label).toBe('freebie');
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://api.cloudflare.com/client/v4/accounts/freebie-acct/ai/run/@cf/some/model',
    );
  });

  it('falls back to the primary account when the free account is out of quota (429)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).includes('freebie-acct')
        ? new Response('daily free allocation exceeded', { status: 429 })
        : ok('from-primary'),
    );

    const { account } = await runWorkersAiWithFallback(withFreebie(createTestEnv()), '@cf/some/model', PAYLOAD);

    expect(account.label).toBe('primary');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the primary account directly when no free-account creds are configured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok('from-primary'));
    const { account } = await runWorkersAiWithFallback(createTestEnv(), '@cf/some/model', PAYLOAD);

    expect(account.label).toBe('primary');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not fall back on a non-quota error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).includes('freebie-acct')
        ? new Response('internal error', { status: 500 })
        : ok('from-primary'),
    );

    await expect(
      runWorkersAiWithFallback(withFreebie(createTestEnv()), '@cf/some/model', PAYLOAD),
    ).rejects.toThrow('Workers AI REST 500');
    expect(fetchMock).toHaveBeenCalledOnce(); // freebie only; no primary fallback
  });
});
