
import { encryptLlmApiKey } from '@server/core/llm-crypto';


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

export function hasConfiguredTestDatabaseUrl() {
  return Boolean(usableEnvValue(process.env.TEST_DATABASE_URL));
}

export function createTestEnv(overrides: Partial<Record<keyof Env, unknown>> = {}): Env {
  return {
    AI: {
      async run() {
        return { response: '{"findings":[],"file_verdict":"approve","file_summary":"ok"}', usage: { prompt_tokens: 1, completion_tokens: 1 } };
      },
    },
    APP_KV: new MemoryKV() as unknown as KVNamespace,
    PROMPTS_KV: new MemoryKV() as unknown as KVNamespace,
    REVIEW_QUEUE: new MockQueue() as any,
    ASSETS: new MockAssets() as any,
    DB: {} as any,
    APP_PRIVATE_KEY: 'test-private-key',
    GITHUB_APP_ID: 'test-app-id',
    GITHUB_APP_SLUG: 'codra-app-personal',
    WORKER_API_KEY: { get: async () => 'test-webhook-secret' },
    GITHUB_CLIENT_ID: 'test-client-id',
    GITHUB_CLIENT_SECRET: 'test-client-secret',
    AUTH_CALLBACK_URL: 'https://codra.hacolby.workers.dev/auth/github/callback',
    APP_URL: 'https://codra.hacolby.workers.dev',
    DASHBOARD_ALLOWED_USERS: 'jmbish04',
    LLM_CONFIG_ENCRYPTION_KEY: 'test-llm-config-encryption-key',
    BOT_USERNAME: 'codra-app',
    ENVIRONMENT: 'production',
    CF_API_TOKEN: { get: async () => '' },
    CF_ACCOUNT_ID: { get: async () => '' },
    CF_DLQ_ID: '',
    RepoAgent: {} as any,
    Chat: {} as any,
    ReviewAgent: {} as any,
    GitHubLikeMCP: {} as any,
    LOADER: {} as any,
    BROWSER: {} as any,
    ...overrides,
  } as unknown as Env;
}

export async function saveTestProviderApiKey(env: Env, providerName = 'Google', apiKey = 'test-key') {
  const encrypted = await encryptLlmApiKey(env, apiKey);
  const db = require('@server/db/client').getDb(env);
  await db.run(require('drizzle-orm').sql`
    UPDATE llm_providers
    SET encrypted_api_key = ${encrypted}, enabled = 1, updated_at = CURRENT_TIMESTAMP
    WHERE name = ${providerName}
  `);
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
