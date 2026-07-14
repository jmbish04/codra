import { defaultRepoConfig, normalizeRepoModelConfig, repoConfigSchema, type RepoConfig } from '@shared/schema';
import { REPO_CONFIG_CACHE_VERSION } from '@shared/config';
import { getRepoConfigRecord, syncRepoConfig } from '@server/db/repo-configs';

type CachedConfig = {
  parsedJson: RepoConfig;
  enabled: boolean;
};

const REPO_CONFIG_CACHE_PREFIX = `config:${REPO_CONFIG_CACHE_VERSION}:db:`;
const REPO_CONFIG_REVISION_KEY = `config:${REPO_CONFIG_CACHE_VERSION}:db_revision`;

async function getRepoConfigCacheRevision(env: Pick<Env, 'APP_KV'>) {
  return (await env.APP_KV.get(REPO_CONFIG_REVISION_KEY)) ?? '0';
}

async function cacheKey(env: Pick<Env, 'APP_KV'>, owner: string, repo: string) {
  const revision = await getRepoConfigCacheRevision(env);
  return `${REPO_CONFIG_CACHE_PREFIX}${revision}:${owner}/${repo}`;
}

const GLOBAL_CONFIG_KEY = 'config:global_model';

const EMPTY_GLOBAL_CONFIG: RepoConfig['model'] = {
  main: null,
  fallbacks: [],
  size_overrides: [],
};

function hasRepoModelOverride(existing: Awaited<ReturnType<typeof getRepoConfigRecord>> | null) {
  return Boolean(
    existing?.mainModel ||
    (Array.isArray(existing?.fallbackModels) && existing.fallbackModels.length > 0) ||
    (Array.isArray(existing?.sizeOverrides) && existing.sizeOverrides.length > 0),
  );
}

export async function getGlobalConfig(env: Pick<Env, 'APP_KV'>): Promise<RepoConfig['model']> {
  const cached = await env.APP_KV.get(GLOBAL_CONFIG_KEY, 'json');
  if (cached) {
    const parsed = repoConfigSchema.shape.model.safeParse(cached);
    if (parsed.success) {
      return normalizeRepoModelConfig(parsed.data);
    }
  }

  return EMPTY_GLOBAL_CONFIG;
}

export async function updateGlobalConfig(env: Pick<Env, 'APP_KV'>, config: RepoConfig['model']) {
  await env.APP_KV.put(GLOBAL_CONFIG_KEY, JSON.stringify(normalizeRepoModelConfig(config)));
  await invalidateAllRepoConfigCache(env);
}

export async function invalidateRepoConfigCache(env: Pick<Env, 'APP_KV'>, owner: string, repo: string) {
  await env.APP_KV.delete(await cacheKey(env, owner, repo));
}

export async function invalidateAllRepoConfigCache(env: Pick<Env, 'APP_KV'>) {
  await env.APP_KV.put(REPO_CONFIG_REVISION_KEY, String(Date.now()));
}


export async function loadRepoConfig(
  env: Pick<Env, 'APP_KV' | 'DB'>,
  input: { installationId: string; owner: string; repo: string },
) {
  const key = await cacheKey(env, input.owner, input.repo);
  const cached = await env.APP_KV.get(key, 'json');
  if (cached) {
    return cached as CachedConfig;
  }

  // Check DB for existing config
  const existing = await getRepoConfigRecord(env, input.owner, input.repo);

  let parsedJson = existing?.parsedJson ?? defaultRepoConfig;
  const enabled = existing?.enabled ?? true;

  // If there's no DB override, use the GLOBAL config
  if (!hasRepoModelOverride(existing)) {
    const globalModel = await getGlobalConfig(env);
    parsedJson = {
      ...parsedJson,
      model: globalModel
    };
  }

  const finalConfig: CachedConfig = {
    parsedJson,
    enabled,
  };

  await env.APP_KV.put(key, JSON.stringify(finalConfig), { expirationTtl: 60 * 10 });

  if (!existing) {
    await syncRepoConfig(env, input);
  }

  return finalConfig;
}
