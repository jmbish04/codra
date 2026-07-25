import { encryptLlmApiKey, decryptLlmApiKey } from '@server/core/llm-crypto';

/**
 * Per-repo configuration for codra's PR testing: the base URL to hit, plus the
 * API key / frontend password to use when the standard WORKER_API_KEY is
 * rejected. Secrets are stored AES-GCM encrypted in APP_KV; only a masked hint
 * is ever returned to the dashboard.
 */
export type RepoTestConfig = {
  baseUrl: string | null;
  hasApiKey: boolean;
  hasFrontendPassword: boolean;
};

type StoredTestConfig = {
  baseUrl?: string | null;
  apiKeyEnc?: string | null;
  frontendPasswordEnc?: string | null;
};

type CryptoEnv = Pick<Env, 'APP_KV' | 'LLM_CONFIG_ENCRYPTION_KEY'>;

function kvKey(owner: string, repo: string) {
  return `test_config:${owner}/${repo}`;
}

async function readStored(env: CryptoEnv, owner: string, repo: string): Promise<StoredTestConfig> {
  return (await env.APP_KV.get(kvKey(owner, repo), 'json')) as StoredTestConfig ?? {};
}

/** Dashboard-safe view: base URL + whether each secret is set (never the secret). */
export async function getRepoTestConfig(env: CryptoEnv, owner: string, repo: string): Promise<RepoTestConfig> {
  const s = await readStored(env, owner, repo);
  return {
    baseUrl: s.baseUrl ?? null,
    hasApiKey: Boolean(s.apiKeyEnc),
    hasFrontendPassword: Boolean(s.frontendPasswordEnc),
  };
}

/**
 * Patch the config. Pass a string to set a secret, '' to clear it, or omit to
 * leave it unchanged. baseUrl follows the same rule.
 */
export async function setRepoTestConfig(
  env: CryptoEnv,
  owner: string,
  repo: string,
  patch: { baseUrl?: string | null; apiKey?: string; frontendPassword?: string },
): Promise<RepoTestConfig> {
  const s = await readStored(env, owner, repo);

  if (patch.baseUrl !== undefined) s.baseUrl = patch.baseUrl?.trim() || null;
  if (patch.apiKey !== undefined) {
    s.apiKeyEnc = patch.apiKey ? await encryptLlmApiKey(env, patch.apiKey) : null;
  }
  if (patch.frontendPassword !== undefined) {
    s.frontendPasswordEnc = patch.frontendPassword ? await encryptLlmApiKey(env, patch.frontendPassword) : null;
  }

  await env.APP_KV.put(kvKey(owner, repo), JSON.stringify(s));
  return getRepoTestConfig(env, owner, repo);
}

/** Decrypt the stored API key for testing, or null if none set. */
export async function getRepoTestApiKey(env: CryptoEnv, owner: string, repo: string): Promise<string | null> {
  const s = await readStored(env, owner, repo);
  return s.apiKeyEnc ? decryptLlmApiKey(env, s.apiKeyEnc) : null;
}

/** Decrypt the stored frontend password for testing, or null if none set. */
export async function getRepoTestFrontendPassword(env: CryptoEnv, owner: string, repo: string): Promise<string | null> {
  const s = await readStored(env, owner, repo);
  return s.frontendPasswordEnc ? decryptLlmApiKey(env, s.frontendPasswordEnc) : null;
}
