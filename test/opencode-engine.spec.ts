import { describe, expect, it } from 'vitest';
import { OpenCodeEngine } from '@server/engines/opencode-engine';
import { parseUnifiedDiff } from '@server/core/diff';
import { defaultRepoConfig } from '@shared/schema';
import { isRetryableOpenCodeError, OpenCodeError } from '@server/engines/opencode-client';

function stubClient(lines: string[], reviewImpl?: () => AsyncIterable<string>) {
  return {
    healthCalls: 0,
    async health(_signal?: AbortSignal) {
      this.healthCalls++;
      return true;
    },
    review: reviewImpl ?? (async function* () {
      for (const line of lines) yield line;
    }),
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
    files, totalLineCount: 8,
    sharedContext: 'SHARED',
    model: {} as any,
    ...overrides,
  };
}

const finding = (title: string) => JSON.stringify({
  path: 'src/a.ts', line: 1, position: 1, severity: 'P2', category: 'security', title, body: 'b',
});

describe('OpenCodeEngine', () => {
  it('parses finding lines + a terminal summary line into comments/perReviewer', async () => {
    const usage = [{ reviewer: 'security', file: 'src/a.ts', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, findings: 3 }];
    const client = stubClient([
      finding('f1'), finding('f2'), finding('f3'),
      JSON.stringify({ type: 'summary', perReviewer: usage }),
    ]);
    const engine = new OpenCodeEngine({} as any, client as any);
    const res = await engine.reviewPullRequest(baseCtx() as any);

    expect(res.comments.length).toBe(3);
    expect(res.comments.map((c) => c.title)).toEqual(['f1', 'f2', 'f3']);
    expect(res.perReviewer).toEqual(usage);
  });

  it('skips a malformed/non-JSON line among valid ones', async () => {
    const client = stubClient([finding('f1'), 'not json {{{', finding('f2')]);
    const engine = new OpenCodeEngine({} as any, client as any);
    const res = await engine.reviewPullRequest(baseCtx() as any);

    expect(res.comments.length).toBe(2);
    expect(res.comments.map((c) => c.title)).toEqual(['f1', 'f2']);
  });

  it('skips a line that is valid JSON but fails parsedReviewCommentSchema', async () => {
    const client = stubClient([finding('f1'), JSON.stringify({ path: 'x' }), finding('f2')]);
    const engine = new OpenCodeEngine({} as any, client as any);
    const res = await engine.reviewPullRequest(baseCtx() as any);

    expect(res.comments.length).toBe(2);
    expect(res.comments.map((c) => c.title)).toEqual(['f1', 'f2']);
  });

  it('returns empty comments + perReviewer when the stream completes with zero findings', async () => {
    const client = stubClient([]);
    const engine = new OpenCodeEngine({} as any, client as any);
    const res = await engine.reviewPullRequest(baseCtx() as any);

    expect(res).toEqual({ comments: [], perReviewer: [] });
  });

  it('propagates a retryable OpenCodeError from client.review instead of returning empty', async () => {
    const client = stubClient([], async function* () {
      throw new OpenCodeError('unreachable', true);
      // eslint-disable-next-line no-unreachable
      yield '';
    });
    const engine = new OpenCodeEngine({} as any, client as any);

    await expect(engine.reviewPullRequest(baseCtx() as any)).rejects.toSatisfy((err: unknown) => isRetryableOpenCodeError(err));
  });

  it('healthCheck delegates to client.health', async () => {
    const client = stubClient([]);
    const engine = new OpenCodeEngine({} as any, client as any);

    expect(await engine.healthCheck()).toBe(true);
    expect(client.healthCalls).toBe(1);
  });
});
