import path from 'node:path';
import { encryptLlmApiKey } from '@server/core/llm-crypto';
import { createLlmProvider, findLlmProviderByName } from '@server/db/model-configs';
import { createD1 } from './d1-sqlite';
import { getDb } from '@server/db/client';
import { repositories, repoConfigs } from '@server/db/schemas';
import type { LlmApiFormat } from '@shared/schema';
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

/** Minimal in-memory R2 bucket — enough for planning-package transcript put/get. */
export class MemoryR2 {
  public readonly store = new Map<string, Uint8Array>();

  async put(key: string, value: ArrayBuffer | Uint8Array | string) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value)
      : value instanceof Uint8Array ? value : new Uint8Array(value);
    this.store.set(key, bytes);
    return { key, size: bytes.byteLength } as any;
  }

  async get(key: string) {
    const bytes = this.store.get(key);
    if (!bytes) return null;
    return {
      key,
      size: bytes.byteLength,
      body: new Response(bytes as unknown as BodyInit).body,
      async text() { return new TextDecoder().decode(bytes); },
      async arrayBuffer() { return bytes.buffer; },
    } as any;
  }

  async head(key: string) {
    const bytes = this.store.get(key);
    return bytes ? ({ key, size: bytes.byteLength } as any) : null;
  }

  async delete(key: string) { this.store.delete(key); }
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
    APP_KV: new MemoryKV() as unknown as KVNamespace,
    PROMPTS_KV: new MemoryKV() as unknown as KVNamespace,
    PLANNING_ARTIFACTS: new MemoryR2() as unknown as R2Bucket,
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
    cf_paid_api_token: { get: async () => 'test-cf-api-token' },
    cf_paid_account_id: { get: async () => 'test-cf-account' },
    cf_free_api_token: { get: async () => '' },
    cf_free_account_id: { get: async () => '' },
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
 * Seed a `model_configs` row (and its `llm_providers` row) so
 * `ModelService.resolveModel` can resolve `modelId`. Cloudflare Workers AI needs
 * no API key (it uses the `env.AI` binding); the HTTP providers (gemini/openai/
 * anthropic) get an encrypted test key. Idempotent per provider name.
 */
export async function seedModelConfig(
  env: Env,
  input: { modelId: string; apiFormat?: LlmApiFormat; providerName?: string; modelName?: string; apiKey?: string },
) {
  const apiFormat = input.apiFormat ?? 'cloudflare-workers-ai';
  const providerName = input.providerName ?? (
    apiFormat === 'cloudflare-workers-ai' ? 'Cloudflare Workers' : apiFormat === 'gemini' ? 'Google' : apiFormat
  );
  const needsKey = apiFormat !== 'cloudflare-workers-ai';
  const encryptedApiKey = needsKey ? await encryptLlmApiKey(env, input.apiKey ?? 'test-key') : null;

  const provider = (await findLlmProviderByName(env, providerName)) ?? (await createLlmProvider(env, {
    name: providerName, apiFormat, baseUrl: null, encryptedApiKey, enabled: true,
  }));

  const db = getDb(env);
  await db.run(sql`
    INSERT OR REPLACE INTO model_configs (model_id, provider, provider_id, model_name, rpm, tpm, rpd)
    VALUES (${input.modelId}, ${providerName}, ${provider.id}, ${input.modelName ?? input.modelId}, 1000, 1000000, 100000)
  `);
  return provider;
}

/**
 * Seed the standard review model set — the Cloudflare Workers AI models plus the
 * DEFAULT_WORKERS_AI_FALLBACKS that ModelService always appends to a strategy,
 * and the Gemma-on-Google models — so any review chain resolves in tests.
 */
export async function seedReviewModels(env: Env) {
  const cloudflareModels = [
    '@cf/moonshotai/kimi-k2.6',
    '@cf/zai-org/glm-4.7-flash',
    '@cf/moonshotai/kimi-k2.7-code',
    '@cf/zai-org/glm-5.2',
    '@cf/qwen/qwen2.5-coder-32b-instruct',
  ];
  for (const modelId of cloudflareModels) {
    await seedModelConfig(env, { modelId, apiFormat: 'cloudflare-workers-ai' });
  }
  for (const modelId of ['gemma-4-31b-it', 'gemma-4-26b-a4b-it']) {
    await seedModelConfig(env, { modelId, apiFormat: 'gemini', providerName: 'Google' });
  }
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
