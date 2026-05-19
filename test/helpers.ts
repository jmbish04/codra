import type { AppBindings } from '@server/env';

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

  async send(message: any, options?: { delaySeconds?: number }) {
    this.sent.push({ ...message, options });
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

export const TEST_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/codra_test';

function usableEnvValue(value: string | undefined) {
  return value && value !== 'undefined' && value !== 'null' ? value : null;
}

export function getTestDatabaseUrl() {
  return (
    usableEnvValue(process.env.TEST_DATABASE_URL) ??
    TEST_DATABASE_URL
  );
}

export function hasConfiguredTestDatabaseUrl() {
  return Boolean(usableEnvValue(process.env.TEST_DATABASE_URL));
}

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
    HYPERDRIVE: {
      connectionString: getTestDatabaseUrl(),
    },
    APP_PRIVATE_KEY: DUMMY_PRIVATE_KEY,
    GITHUB_APP_ID: '123',
    GITHUB_APP_SLUG: 'codra-app',
    GITHUB_APP_WEBHOOK_SECRET: 'topsecret',
    GITHUB_CLIENT_ID: 'dashboard-client-id',
    GITHUB_CLIENT_SECRET: 'dashboard-client-secret',
    AUTH_CALLBACK_URL: 'https://codra.test/auth/github/callback',
    APP_URL: 'https://codra.test',
    DASHBOARD_ALLOWED_USERS: 'devarshishimpi',
    GEMINI_API_KEY: 'gemini-key',
    BOT_USERNAME: 'codra-app',
    ENVIRONMENT: 'test',
    CF_API_TOKEN: 'cf-api-token',
    CF_ACCOUNT_ID: 'cf-account-id',
    CF_DLQ_ID: 'cf-dlq-id',
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
