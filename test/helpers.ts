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

  async send(message: any) {
    this.sent.push(message);
  }
}

function usableEnvValue(value: string | undefined) {
  return value && value !== 'undefined' && value !== 'null' ? value : null;
}

function requiredEnv(key: keyof NodeJS.ProcessEnv) {
  const value = usableEnvValue(process.env[key]);
  if (!value) {
    throw new Error(`Missing required test environment variable: ${key}`);
  }
  return value;
}

function unusedEnv(key: string): string {
  throw new Error(`${key} is not required by the current test suite. Add it to the test env only when a test exercises that path.`);
}

export function getTestDatabaseUrl() {
  return requiredEnv('TEST_DATABASE_URL');
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
    get APP_PRIVATE_KEY() { return unusedEnv('APP_PRIVATE_KEY'); },
    get GITHUB_APP_ID() { return unusedEnv('GITHUB_APP_ID'); },
    GITHUB_APP_SLUG: requiredEnv('GITHUB_APP_SLUG'),
    GITHUB_APP_WEBHOOK_SECRET: requiredEnv('GITHUB_APP_WEBHOOK_SECRET'),
    GITHUB_CLIENT_ID: requiredEnv('GITHUB_CLIENT_ID'),
    GITHUB_CLIENT_SECRET: requiredEnv('GITHUB_CLIENT_SECRET'),
    AUTH_CALLBACK_URL: requiredEnv('AUTH_CALLBACK_URL'),
    APP_URL: requiredEnv('APP_URL'),
    DASHBOARD_ALLOWED_USERS: requiredEnv('DASHBOARD_ALLOWED_USERS'),
    get GEMINI_API_KEY() { return unusedEnv('GEMINI_API_KEY'); },
    BOT_USERNAME: requiredEnv('BOT_USERNAME'),
    get ENVIRONMENT() { return unusedEnv('ENVIRONMENT'); },
    get CF_API_TOKEN() { return unusedEnv('CF_API_TOKEN'); },
    get CF_ACCOUNT_ID() { return unusedEnv('CF_ACCOUNT_ID'); },
    get CF_DLQ_ID() { return unusedEnv('CF_DLQ_ID'); },
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
