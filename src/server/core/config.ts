import { parse as parseYaml } from 'yaml';
import { defaultRepoConfig, repoConfigSchema, type RepoConfig } from '@shared/schema';
import { REPO_CONFIG_CACHE_VERSION, REPO_CONFIG_FILENAME } from '@shared/config';
import type { AppBindings } from '@server/env';
import { upsertRepoConfig } from '@server/db/repo-configs';
import { GitHubClient } from './github';

type CachedConfig = {
  rawYaml: string | null;
  parsedJson: RepoConfig;
  configMissing: boolean;
};

function cacheKey(owner: string, repo: string) {
  return `config:${REPO_CONFIG_CACHE_VERSION}:${REPO_CONFIG_FILENAME}:${owner}/${repo}`;
}

export function parseRepoConfig(rawYaml: string | null) {
  if (!rawYaml) {
    return {
      rawYaml: null,
      parsedJson: defaultRepoConfig,
      configMissing: true,
    } satisfies CachedConfig;
  }

  const parsed = parseYaml(rawYaml) as unknown;
  return {
    rawYaml,
    parsedJson: repoConfigSchema.parse(parsed ?? {}),
    configMissing: false,
  } satisfies CachedConfig;
}

export async function loadRepoConfig(
  env: Pick<AppBindings, 'APP_KV' | 'NEON_DATABASE_URL'>,
  github: GitHubClient,
  input: { installationId: string; owner: string; repo: string },
) {
  const key = cacheKey(input.owner, input.repo);
  const cached = await env.APP_KV.get(key, 'json');
  if (cached) {
    return cached as CachedConfig;
  }

  const repoFile = await github.getRepoFileOrNull(input.owner, input.repo, REPO_CONFIG_FILENAME);
  const parsed = parseRepoConfig(repoFile);

  await env.APP_KV.put(key, JSON.stringify(parsed), { expirationTtl: 60 * 10 });
  await upsertRepoConfig(env, {
    installationId: input.installationId,
    owner: input.owner,
    repo: input.repo,
    rawYaml: parsed.rawYaml,
    parsedJson: parsed.parsedJson,
    configMissing: parsed.configMissing,
  });

  return parsed;
}
