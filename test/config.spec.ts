import { REPO_CONFIG_CACHE_VERSION, REPO_CONFIG_FILENAME } from '@shared/config';
import { loadRepoConfig, parseRepoConfig } from '@server/core/config';

const upsertRepoConfigMock = vi.fn();

vi.mock('@server/db/repo-configs', () => ({
  upsertRepoConfig: upsertRepoConfigMock,
}));

describe('parseRepoConfig', () => {
  it('returns defaults when config is missing', () => {
    const parsed = parseRepoConfig(null);
    expect(parsed.configMissing).toBe(true);
    expect(parsed.parsedJson.review.max_files).toBe(15);
  });

  it('merges custom values through schema defaults', () => {
    const parsed = parseRepoConfig(`
review:
  max_files: 5
  custom_rules:
    - Never skip audit logs
`);

    expect(parsed.configMissing).toBe(false);
    expect(parsed.parsedJson.review.max_files).toBe(5);
    expect(parsed.parsedJson.review.ignore_drafts).toBe(true);
    expect(parsed.parsedJson.review.custom_rules).toContain('Never skip audit logs');
  });

  it('loads the shared config filename and caches under the versioned key', async () => {
    const kvGet = vi.fn().mockResolvedValue(null);
    const kvPut = vi.fn().mockResolvedValue(undefined);
    const getRepoFileOrNull = vi.fn().mockResolvedValue('review:\n  max_files: 7\n');

    const parsed = await loadRepoConfig(
      {
        APP_KV: {
          get: kvGet,
          put: kvPut,
        } as never,
        NEON_DATABASE_URL: 'postgres://test',
      },
      {
        getRepoFileOrNull,
      } as never,
      {
        installationId: '123',
        owner: 'acme',
        repo: 'widget',
      },
    );

    expect(getRepoFileOrNull).toHaveBeenCalledWith('acme', 'widget', REPO_CONFIG_FILENAME);
    expect(kvGet).toHaveBeenCalledWith(`config:${REPO_CONFIG_CACHE_VERSION}:${REPO_CONFIG_FILENAME}:acme/widget`, 'json');
    expect(kvPut).toHaveBeenCalledWith(
      `config:${REPO_CONFIG_CACHE_VERSION}:${REPO_CONFIG_FILENAME}:acme/widget`,
      JSON.stringify(parsed),
      { expirationTtl: 60 * 10 },
    );
    expect(parsed.parsedJson.review.max_files).toBe(7);
    expect(upsertRepoConfigMock).toHaveBeenCalled();
  });
});
