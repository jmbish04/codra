import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv } from './helpers';
import { getRepoConfigRecord, resetAllRepoConfigs, syncRepoConfig, updateRepoConfigFlags } from '@server/db/repo-configs';

describe('repo config external Jules flag', () => {
  let env: Env;
  const owner = 'test-owner';
  const repo = 'app';
  const installationId = '123';

  beforeEach(() => {
    env = createTestEnv();
  });

  it('defaults externalJulesEnabled to false and persists updates', async () => {
    await syncRepoConfig(env, { installationId, owner, repo });

    const initial = await getRepoConfigRecord(env, owner, repo);
    expect(initial?.externalJulesEnabled).toBe(false);

    await updateRepoConfigFlags(env, { owner, repo, externalJulesEnabled: true });

    const updated = await getRepoConfigRecord(env, owner, repo);
    expect(updated?.externalJulesEnabled).toBe(true);
  });

  it('resetAllRepoConfigs turns externalJulesEnabled back off', async () => {
    await syncRepoConfig(env, { installationId, owner, repo });
    await updateRepoConfigFlags(env, { owner, repo, externalJulesEnabled: true });

    const beforeReset = await getRepoConfigRecord(env, owner, repo);
    expect(beforeReset?.externalJulesEnabled).toBe(true);

    await resetAllRepoConfigs(env);

    const afterReset = await getRepoConfigRecord(env, owner, repo);
    expect(afterReset?.externalJulesEnabled).toBe(false);
  });
});
