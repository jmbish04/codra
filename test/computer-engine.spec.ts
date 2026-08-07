import { describe, expect, it } from 'vitest';
import {
  ComputerEngine,
  isRetryableComputerEngineError,
  type ComputerWorkspace,
  type ComputerWorkspaceFactory,
  type ComputerReviewerRunner,
} from '@server/engines/computer-engine';
import { parseUnifiedDiff } from '@server/core/diff';
import { defaultRepoConfig } from '@shared/schema';

function stubWorkspace(): ComputerWorkspace & { populateCalls: string[]; execCalls: Array<{ cmd: string; opts?: { backend?: string } }> } {
  return {
    populateCalls: [],
    execCalls: [],
    async populateFromTarball(url: string) { this.populateCalls.push(url); },
    async readFile(_path: string) { return null; },
    async exec(cmd: string, opts?: { backend?: 'isolate' | 'container' }) {
      this.execCalls.push({ cmd, opts });
      return { stdout: '', exitCode: 0 };
    },
  };
}

function stubFactory(workspace: ComputerWorkspace, opts: { available?: boolean; createErr?: Error } = {}): ComputerWorkspaceFactory & { createCalls: number } {
  return {
    createCalls: 0,
    isAvailable: (_env: Env) => opts.available ?? true,
    async create(_env: Env, _key: string) {
      this.createCalls++;
      if (opts.createErr) throw opts.createErr;
      return workspace;
    },
  };
}

function baseCtx(overrides: Partial<Record<string, unknown>> = {}) {
  const diff = 'diff --git a/src/a.ts b/src/a.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/a.ts\n@@ -0,0 +1,1 @@\n+export const a = 1;\n';
  const files = parseUnifiedDiff(diff);
  return {
    env: {} as any,
    job: { id: 'j1', owner: 'o', repo: 'r', prNumber: 1 },
    pr: { title: 'PR', body: 'body', head: { sha: 'abc123' } },
    config: defaultRepoConfig,
    files, totalLineCount: 8, // trivial tier -> security + correctness
    sharedContext: 'SHARED',
    model: {} as any,
    ...overrides,
  } as any;
}

const finding = (reviewerId: string, path: string) => ({
  path, line: 1, position: 1, severity: 'P2', category: 'security', title: `${reviewerId}-finding`, body: 'b',
});

function stubRunner(seen: Array<{ reviewerId: string; filePath: string; workspace: ComputerWorkspace }>): ComputerReviewerRunner {
  return async ({ reviewer, file, workspace }) => {
    seen.push({ reviewerId: reviewer.id, filePath: file.path, workspace });
    return {
      findings: [finding(reviewer.id, file.path)],
      inputTokens: 5, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0,
    };
  };
}

describe('ComputerEngine', () => {
  describe('healthCheck', () => {
    it('returns false without throwing when factory.isAvailable is false', async () => {
      const factory = stubFactory(stubWorkspace(), { available: false });
      const engine = new ComputerEngine({} as any, factory);
      expect(await engine.healthCheck()).toBe(false);
      expect(factory.createCalls).toBe(0);
    });

    it('returns true when available and the construct probe succeeds', async () => {
      const factory = stubFactory(stubWorkspace(), { available: true });
      const engine = new ComputerEngine({} as any, factory);
      expect(await engine.healthCheck()).toBe(true);
      expect(factory.createCalls).toBe(1);
    });

    it('returns false (not throw) when available but the construct probe fails', async () => {
      const factory = stubFactory(stubWorkspace(), { available: true, createErr: new Error('boom') });
      const engine = new ComputerEngine({} as any, factory);
      await expect(engine.healthCheck()).resolves.toBe(false);
    });
  });

  describe('reviewPullRequest', () => {
    it('populates the workspace from the head-sha tarball, fans out planned reviewers with workspace access, and aggregates results', async () => {
      const workspace = stubWorkspace();
      const factory = stubFactory(workspace);
      const seen: Array<{ reviewerId: string; filePath: string; workspace: ComputerWorkspace }> = [];
      const engine = new ComputerEngine({} as any, factory, stubRunner(seen));

      const res = await engine.reviewPullRequest(baseCtx());

      expect(workspace.populateCalls).toEqual(['https://codeload.github.com/o/r/tar.gz/abc123']);
      // trivial tier (totalLineCount=8) -> security + correctness, x1 file
      expect(seen.map((s) => s.reviewerId)).toEqual(['security', 'correctness']);
      expect(seen.every((s) => s.workspace === workspace)).toBe(true);
      expect(res.comments.length).toBe(2);
      expect(res.perReviewer.length).toBe(2);
      expect(res.perReviewer[0]).toMatchObject({ reviewer: 'security', file: 'src/a.ts', findings: 1 });
    });

    it('throws a retryable error (not an empty result) when the factory is unavailable', async () => {
      const factory = stubFactory(stubWorkspace(), { available: false });
      const engine = new ComputerEngine({} as any, factory, stubRunner([]));

      await expect(engine.reviewPullRequest(baseCtx())).rejects.toSatisfy((err: unknown) => isRetryableComputerEngineError(err));
    });

    it('throws a retryable error (not an empty result) when workspace creation throws', async () => {
      const factory = stubFactory(stubWorkspace(), { createErr: new Error('DO unreachable') });
      const engine = new ComputerEngine({} as any, factory, stubRunner([]));

      await expect(engine.reviewPullRequest(baseCtx())).rejects.toSatisfy((err: unknown) => isRetryableComputerEngineError(err));
    });

    it('threads backend:"container" through workspace.exec when a reviewer escalates to it', async () => {
      const workspace = stubWorkspace();
      const factory = stubFactory(workspace);
      const runner: ComputerReviewerRunner = async ({ reviewer, file, workspace: ws }) => {
        if (reviewer.id === 'correctness') {
          await ws.exec('npm test', { backend: 'container' });
        }
        return { findings: [finding(reviewer.id, file.path)] };
      };
      const engine = new ComputerEngine({} as any, factory, runner);

      await engine.reviewPullRequest(baseCtx());

      expect(workspace.execCalls).toEqual([{ cmd: 'npm test', opts: { backend: 'container' } }]);
    });

    it('skips a finding that fails parsedReviewCommentSchema instead of throwing', async () => {
      const workspace = stubWorkspace();
      const factory = stubFactory(workspace);
      const runner: ComputerReviewerRunner = async ({ reviewer, file }) => ({
        findings: reviewer.id === 'security' ? [{ path: 'x' }] : [finding(reviewer.id, file.path)],
      });
      const engine = new ComputerEngine({} as any, factory, runner);

      const res = await engine.reviewPullRequest(baseCtx());

      expect(res.comments.length).toBe(1);
      expect(res.perReviewer.find((r) => r.reviewer === 'security')?.findings).toBe(0);
    });
  });
});
