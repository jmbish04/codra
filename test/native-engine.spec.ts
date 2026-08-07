import { describe, expect, it } from 'vitest';
import { NativeEngine } from '@server/engines/native-engine';
import { parseUnifiedDiff } from '@server/core/diff';
import { defaultRepoConfig } from '@shared/schema';

// Stub ModelService: records the reviewer system prompts it was asked to run.
function stubModel(seen: string[]) {
  return {
    async reviewFile(params: any) {
      seen.push(params.systemPromptOverride ?? 'default');
      return {
        modelUsed: 'stub', provider: 'stub', rawText: '{}',
        inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
        parsed: { comments: [{ path: params.file.path, line: 1, position: 1, severity: 'P2',
          category: 'security', title: 't', body: 'b' }], verdict: 'comment', fileSummary: 's',
          overallCorrectness: 'ok', confidenceScore: 0.9 },
      };
    },
  } as any;
}

describe('NativeEngine', () => {
  it('runs the planned reviewer set per file and aggregates findings', async () => {
    const diff = 'diff --git a/src/a.ts b/src/a.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/a.ts\n@@ -0,0 +1,1 @@\n+export const a = 1;\n';
    const files = parseUnifiedDiff(diff);
    const seen: string[] = [];
    const engine = new NativeEngine();
    const res = await engine.reviewPullRequest({
      env: {} as any,
      job: { id: 'j1', owner: 'o', repo: 'r', prNumber: 1 } as any,
      pr: { title: 'PR', body: 'body' } as any,
      config: defaultRepoConfig,
      files, totalLineCount: 8, // trivial → security+correctness
      sharedContext: 'SHARED',
      model: stubModel(seen),
    });
    // trivial tier = 2 reviewers × 1 file = 2 calls
    expect(seen.length).toBe(2);
    expect(res.comments.length).toBe(2);
    expect(res.perReviewer.length).toBe(2);
  });
});
