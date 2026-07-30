import { describe, it, expect } from 'vitest';
import { buildDeployWorkflowYaml, deployWorkflowNeeded } from '@server/core/deploy-workflow';

describe('buildDeployWorkflowYaml', () => {
  const yaml = buildDeployWorkflowYaml({ dbName: 'codra', packageManager: 'pnpm' });
  it('is manual (workflow_dispatch) with deploy/migrate/logs actions', () => {
    expect(yaml).toContain('workflow_dispatch:');
    expect(yaml).toContain('cloudflare/wrangler-action@v4');
    expect(yaml).toContain('d1 migrations apply codra --remote');
    expect(yaml).toContain('deployments list');
    expect(yaml).toContain('CLOUDFLARE_API_TOKEN');
    expect(yaml).toContain('CLOUDFLARE_ACCOUNT_ID');
  });
  it('ships the push-to-main auto-deploy block commented out', () => {
    // every line of the push trigger must be commented
    expect(yaml).toMatch(/#\s*on:\s*\n#\s*push:/);
    expect(yaml).not.toMatch(/^\s*on:\s*\n\s*push:/m);
  });
});

describe('deployWorkflowNeeded', () => {
  it('false when a deploy workflow already exists', async () => {
    const github: any = {
      getRepoFileWithRefOrNull: async (_o: string, _r: string, p: string) =>
        p === 'wrangler.jsonc' ? { content: '{}', sha: 's' } : null,
      getRepoTree: async () => ({ tree: [{ type: 'blob', path: '.github/workflows/deploy.yml' }] }),
    };
    expect(await deployWorkflowNeeded(github, 'o', 'r', 'main', 'sha')).toBe(false);
  });
  it('false when not a worker repo (no wrangler config)', async () => {
    const github: any = {
      getRepoFileWithRefOrNull: async () => null,
      getRepoTree: async () => ({ tree: [] }),
    };
    expect(await deployWorkflowNeeded(github, 'o', 'r', 'main', 'sha')).toBe(false);
  });
  it('true for a worker repo with no deploy workflow', async () => {
    const github: any = {
      getRepoFileWithRefOrNull: async (_o: string, _r: string, p: string) =>
        p === 'wrangler.jsonc' ? { content: '{ "name": "x" }', sha: 's' } : null,
      getRepoTree: async () => ({ tree: [{ type: 'blob', path: 'src/index.ts' }, { type: 'blob', path: '.github/workflows/ci.yml' }] }),
    };
    expect(await deployWorkflowNeeded(github, 'o', 'r', 'main', 'sha')).toBe(true);
  });
});
