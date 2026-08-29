import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCloudflareChat } from '@server/models/cloudflare';
import { createTestEnv } from './helpers';

const PAYLOAD = { messages: [{ role: 'user', content: 'hi' }] };

function freebieCreds() {
  return {
    CF_FREEBIE_API_TOKEN: { get: async () => 'freebie-token' },
    CF_FREEBIE_ACCOUNT_ID: { get: async () => 'freebie-acct' },
  };
}

describe('runCloudflareChat freebie-first routing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('runs on the free account (REST) when creds are present, not the AI binding', async () => {
    const bindingRun = vi.fn(async () => ({ response: 'from-binding' }));
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ result: { response: 'from-freebie' }, success: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const env = createTestEnv({ AI: { run: bindingRun } as any, ...freebieCreds() });

    const result = await runCloudflareChat(env, '@cf/some/model', PAYLOAD);

    expect(result).toEqual({ response: 'from-freebie' }); // REST envelope unwrapped
    expect(bindingRun).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/freebie-acct/ai/run/@cf/some/model');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer freebie-token' });
  });

  it('falls back to the AI binding when the free account is out of quota (429)', async () => {
    const bindingRun = vi.fn(async () => ({ response: 'from-binding' }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('daily free allocation exceeded', { status: 429 })));
    const env = createTestEnv({ AI: { run: bindingRun } as any, ...freebieCreds() });

    const result = await runCloudflareChat(env, '@cf/some/model', PAYLOAD);

    expect(result).toEqual({ response: 'from-binding' });
    expect(bindingRun).toHaveBeenCalledOnce();
  });

  it('uses the AI binding directly when no freebie creds are configured', async () => {
    const bindingRun = vi.fn(async () => ({ response: 'from-binding' }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const env = createTestEnv({ AI: { run: bindingRun } as any }); // no CF_FREEBIE_* bindings

    const result = await runCloudflareChat(env, '@cf/some/model', PAYLOAD);

    expect(result).toEqual({ response: 'from-binding' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(bindingRun).toHaveBeenCalledOnce();
  });
});
