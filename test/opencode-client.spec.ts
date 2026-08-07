import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenCodeClient, isRetryableOpenCodeError } from '@server/engines/opencode-client';

function secret(value: string) {
  return { get: async () => value };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenCodeClient', () => {
  it('health() returns true on a VPC success', async () => {
    const vpcFetch = vi.fn(async (_req: Request) => new Response(null, { status: 200 }));
    const bindings = { OPENCODE_VPC: { fetch: vpcFetch } };

    const client = new OpenCodeClient(bindings as unknown as Env);
    expect(await client.health()).toBe(true);
    expect(vpcFetch).toHaveBeenCalledTimes(1);
    const req = vpcFetch.mock.calls[0][0];
    expect(req.url).toBe('https://opencode.internal/health');
  });

  it('falls back to Tunnel with Access headers when VPC fails connectivity', async () => {
    const tunnelFetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', tunnelFetch);

    const bindings = {
      OPENCODE_VPC: { fetch: vi.fn(async () => { throw new Error('network unreachable'); }) },
      OPENCODE_TUNNEL_URL: 'https://opencode.example.com',
      OPENCODE_ACCESS_CLIENT_ID: secret('client-id-123'),
      OPENCODE_ACCESS_CLIENT_SECRET: secret('client-secret-456'),
    };

    const client = new OpenCodeClient(bindings as unknown as Env);
    expect(await client.health()).toBe(true);

    expect(tunnelFetch).toHaveBeenCalledTimes(1);
    const [url, init] = tunnelFetch.mock.calls[0];
    expect(url).toBe('https://opencode.example.com/health');
    const headers = new Headers(init.headers);
    expect(headers.get('CF-Access-Client-Id')).toBe('client-id-123');
    expect(headers.get('CF-Access-Client-Secret')).toBe('client-secret-456');
  });

  it('health() returns false, review() throws retryable, when both transports fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('tunnel down'); }));

    const env = {
      OPENCODE_VPC: { fetch: vi.fn(async () => { throw new Error('vpc down'); }) },
      OPENCODE_TUNNEL_URL: 'https://opencode.example.com',
    } as unknown as Env;

    const client = new OpenCodeClient(env);
    expect(await client.health()).toBe(false);

    await expect(async () => {
      for await (const _line of client.review({ job: 'x' })) {
        // no-op
      }
    }).rejects.toSatisfy((err: unknown) => isRetryableOpenCodeError(err));
  });

  it('a 401 from the Tunnel is non-retryable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })));

    const env = {
      OPENCODE_TUNNEL_URL: 'https://opencode.example.com',
      OPENCODE_ACCESS_CLIENT_ID: secret('id'),
      OPENCODE_ACCESS_CLIENT_SECRET: secret('secret'),
    } as unknown as Env;

    const client = new OpenCodeClient(env);
    let caught: unknown;
    try {
      for await (const _line of client.review({ job: 'x' })) {
        // no-op
      }
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(isRetryableOpenCodeError(caught)).toBe(false);
  });

  it('review() yields each JSONL line of the response body', async () => {
    const lines = [
      JSON.stringify({ path: 'a.ts', line: 1 }),
      JSON.stringify({ path: 'b.ts', line: 2 }),
      JSON.stringify({ summary: true }),
    ];
    const env = {
      OPENCODE_VPC: { fetch: vi.fn(async () => new Response(lines.join('\n') + '\n', { status: 200 })) },
    } as unknown as Env;

    const client = new OpenCodeClient(env);
    const seen: string[] = [];
    for await (const line of client.review({ job: 'x' })) {
      seen.push(line);
    }
    expect(seen).toEqual(lines);
  });

  it('no transport configured: health() false, review() throws', async () => {
    const client = new OpenCodeClient({} as unknown as Env);
    expect(await client.health()).toBe(false);
    await expect(async () => {
      for await (const _line of client.review({ job: 'x' })) {
        // no-op
      }
    }).rejects.toThrow();
  });
});
