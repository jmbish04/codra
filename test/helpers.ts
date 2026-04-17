import type { AppBindings } from '@server/env';

class MemoryKV {
  private readonly store = new Map<string, string>();

  async put(key: string, value: string) {
    this.store.set(key, value);
  }

  async get(key: string, type?: 'text' | 'json' | Partial<KVNamespaceGetOptions<undefined>>) {
    const value = this.store.get(key) ?? null;
    if (value === null) return null;
    if (type === 'json') {
      return JSON.parse(value);
    }
    return value;
  }

  async getWithMetadata(key: string, type?: 'text' | 'json' | Partial<KVNamespaceGetOptions<undefined>>) {
    return {
      value: await this.get(key, type as 'text' | 'json'),
      metadata: null,
      cacheStatus: null,
    } as any;
  }

  async list() {
    return {
      keys: Array.from(this.store.keys()).map((name) => ({ name })),
      list_complete: true,
      cursor: '',
    } as any;
  }

  async delete(key: string) {
    this.store.delete(key);
  }
}

class MockAssets {
  async fetch(input: RequestInfo | URL) {
    const request = input instanceof Request ? input : new Request(input);
    return new Response(`<html><body>${new URL(request.url).pathname}</body></html>`, {
      headers: { 'content-type': 'text/html' },
    });
  }
}

class MockQueue {
  public readonly sent: unknown[] = [];

  async send(message: unknown) {
    this.sent.push(message);
  }
}

export function createTestEnv(overrides: Partial<AppBindings> = {}): AppBindings {
  return {
    AI: {
      async run() {
        return { response: '{"comments":[],"file_verdict":"approve","file_summary":"ok"}', usage: { prompt_tokens: 1, completion_tokens: 1 } };
      },
    },
    APP_KV: new MemoryKV() as unknown as KVNamespace,
    REVIEW_QUEUE: new MockQueue(),
    ASSETS: new MockAssets(),
    APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----',
    GITHUB_APP_ID: '123',
    GITHUB_APP_WEBHOOK_SECRET: 'topsecret',
    GEMINI_API_KEY: 'gemini-key',
    NEON_DATABASE_URL: 'postgres://user:pass@localhost/db',
    DASHBOARD_PASSWORD: 'letmein',
    BOT_USERNAME: 'codra-app',
    ENVIRONMENT: 'test',
    ...overrides,
  };
}
