import type { AppBindings } from '@server/env';
import { vi } from 'vitest';

export class MemoryKV {
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

export class MockAssets {
  async fetch(input: RequestInfo | URL) {
    const request = input instanceof Request ? input : new Request(input);
    return new Response(`<html><body>${new URL(request.url).pathname}</body></html>`, {
      headers: { 'content-type': 'text/html' },
    });
  }
}

export class MockQueue {
  public readonly sent: any[] = [];

  async send(message: any) {
    this.sent.push(message);
  }
}

// A valid PKCS#8 dummy private key (2048-bit RSA)
export const DUMMY_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCuG/W/29qB8S3q
/U4+4M1v8XJ/U0zZ5y8/Y+Y/W9J/4M1v8XJ/U0zZ5y8/Y+Y/W9J/4M1v8XJ/U0zZ
5y8/Y+Y/W9J/4M1v8XJ/U0zZ5y8/Y+Y/W9J/4M1v8XJ/U0zZ5y8/Y+Y/W9J/4M1v
8XJ/U0zZ5y8/Y+Y/W9J/4M1v8XJ/U0zZ5y8/Y+Y/W9J/4M1v8XJ/U0zZ5y8/Y+Y/
W9J/4M1v8XJ/U0zZ5y8/Y+Y/W9J/4M1v8XJ/U0zZ5y8/Y+Y/W9J/4M1v8XJ/U0zZ
5y8/Y+Y/W9J/4M1v8XJ/U0zZ5y8/Y+Y/W9J/4M1v8XJ/U0zZ5y8/Y+Y/W9J/4M1v
8XJ/U0zZ5y8/Y+Y/W9J/4M1v8XJ/U0zZ5y8/Y+Y/W9J/4M1v8XJ/U0zZ5y8/Y+Y/
W9J/AgMBAAECggEAIl77HjE=
-----END PRIVATE KEY-----`;

export const TEST_NEON_DB_URL = 'postgresql://neondb_owner:npg_SZg5DNCBdl0T@ep-twilight-bonus-a1xcg0jb-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

export function createTestEnv(overrides: Partial<AppBindings> = {}): AppBindings {
  return {
    AI: {
      async run() {
        return { response: '{"findings":[],"file_verdict":"approve","file_summary":"ok"}', usage: { prompt_tokens: 1, completion_tokens: 1 } };
      },
    },
    APP_KV: new MemoryKV() as unknown as KVNamespace,
    REVIEW_QUEUE: new MockQueue() as any,
    ASSETS: new MockAssets() as any,
    APP_PRIVATE_KEY: DUMMY_PRIVATE_KEY,
    GITHUB_APP_ID: '123',
    GITHUB_APP_WEBHOOK_SECRET: 'topsecret',
    GEMINI_API_KEY: 'gemini-key',
    NEON_DATABASE_URL: TEST_NEON_DB_URL,
    DASHBOARD_PASSWORD: 'letmein',
    BOT_USERNAME: 'codra-app',
    ENVIRONMENT: 'test',
    ...overrides,
  };
}

/**
 * Generates a mock Unified Diff string for testing.
 */
export function generateMockDiff(files: { path: string; content: string }[]): string {
  return files
    .map((f) => {
      const lines = f.content.split('\n');
      return `diff --git a/${f.path} b/${f.path}
index 1234567..890abcd 100644
--- a/${f.path}
+++ b/${f.path}
@@ -1,${lines.length} +1,${lines.length} @@
${lines.map((l) => `+${l}`).join('\n')}`;
    })
    .join('\n');
}

/**
 * Creates a mock GitHub Webhook payload for a PR opened event.
 */
export function createMockPRWebhook(overrides: any = {}) {
  return {
    action: 'opened',
    installation: { id: 12345 },
    repository: {
      name: 'test-repo',
      owner: { login: 'test-owner' },
    },
    pull_request: {
      number: 1,
      title: 'Initial PR',
      body: 'Testing PR body',
      user: { login: 'dev-author' },
      head: { sha: 'headsha', ref: 'feature' },
      base: { sha: 'basesha', ref: 'main' },
      draft: false,
    },
    ...overrides,
  };
}
