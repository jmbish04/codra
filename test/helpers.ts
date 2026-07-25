import path from 'node:path';
import { encryptLlmApiKey } from '@server/core/llm-crypto';
import { createD1 } from './d1-sqlite';
import { getDb } from '@server/db/client';
import { repositories, repoConfigs } from '@server/db/schemas';
import { sql } from 'drizzle-orm';


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

function unusedEnv(key: string): string {
  throw new Error(`${key} is not required by the current test suite. Add it to the test env only when a test exercises that path.`);
}


export function hasConfiguredTestDatabaseUrl() {
  // DB is an in-memory node:sqlite D1 provisioned per createTestEnv (Codra is
  // D1-only — no Postgres), so a database is always available. Kept as a gate
  // so the DB-backed specs read clearly.
  return true;
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
    DB: createD1(path.resolve(process.cwd(), 'db/migrations/d1')) as any,
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
  const db = getDb(env);
  await db.run(sql`
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
/**
 * Seed an enabled repo (repositories + repo_configs rows) so services that
 * enumerate enabled repos (e.g. the open-PR sync) can find it.
 */
export async function seedEnabledRepo(
  env: Env,
  input: { installationId: number; owner: string; repo: string; enabled?: boolean },
) {
  const db = getDb(env);
  const [repoRow] = await db.insert(repositories)
    .values({ installation_id: input.installationId, owner: input.owner, repo: input.repo })
    .returning({ id: repositories.id });
  await db.insert(repoConfigs)
    .values({ repository_id: repoRow.id, enabled: input.enabled ?? true })
    .returning({ id: repoConfigs.id });
  return repoRow.id as number;
}

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
