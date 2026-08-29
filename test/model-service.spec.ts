import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRetryableModelError, ModelService } from '@server/services/model';
import { reviewWithGoogle } from '@server/models/google';
import { createTestEnv, seedReviewModels } from './helpers';
import { defaultRepoConfig } from '@shared/schema';

/**
 * A GUARDIAN service-binding stub. `capture` receives the parsed request body of
 * each `/api/ai-router/run` call; `review` is the JSON the (fake) model returns.
 */
function guardianStub(
  review: Record<string, unknown>,
  opts: { capture?: (body: any) => void; status?: number } = {},
) {
  return {
    fetch: async (_url: string, init: any) => {
      if (opts.status && opts.status >= 400) {
        return new Response('guardian error', { status: opts.status });
      }
      opts.capture?.(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          request_uuid: 't', status: 200, provider: 'ollama', model: 'auto',
          mode: 'gateway', gateway: null, tokens_in: 1, tokens_out: 1, cost_usd: 0,
          body: { response: JSON.stringify(review) },
        }),
        { status: 200 },
      );
    },
  } as any;
}

const APPROVE = {
  findings: [],
  overall_correctness: 'patch is correct',
  overall_explanation: 'ok',
  overall_confidence_score: 0.9,
  file_verdict: 'approve',
  file_summary: 'ok',
};

const largeFile = (lines: number) => ({
  path: 'src/large.ts',
  previousPath: null,
  isNew: false,
  isDeleted: false,
  isBinary: false,
  lineCount: lines,
  hunks: [
    {
      header: `@@ -1,${lines} +1,${lines} @@`,
      lines: Array.from({ length: lines }, (_, i) => ({
        kind: 'add' as const,
        content: `const value${i} = ${i};`,
        newLineNumber: i + 1,
        position: i + 1,
      })),
    },
  ],
});

describe('ModelService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('appends the default Workers AI fallbacks to a configured strategy', () => {
    const service = new ModelService(createTestEnv());
    const selected = (service as any).selectModel({
      totalLineCount: 500,
      config: {
        ...defaultRepoConfig,
        model: { main: 'gemma-4-31b-it', fallbacks: [], size_overrides: [] },
      },
    });

    expect(selected).toEqual({
      primary: 'gemma-4-31b-it',
      fallbacks: [
        '@cf/moonshotai/kimi-k2.7-code',
        '@cf/zai-org/glm-5.2',
        '@cf/qwen/qwen2.5-coder-32b-instruct',
      ],
    });
  });

  it('fails clearly when no model strategy is configured', () => {
    const service = new ModelService(createTestEnv());
    expect(() => (service as any).selectModel({ totalLineCount: 1, config: defaultRepoConfig }))
      .toThrow('No review model strategy is configured');
  });

  it('routes review inference through core-guardian and returns the parsed result', async () => {
    let body: any = null;
    const env = createTestEnv({ GUARDIAN: guardianStub(APPROVE, { capture: (b) => { body = b; } }) });
    await seedReviewModels(env);
    const service = new ModelService(env);

    const response = await (service as any).callModel('@cf/moonshotai/kimi-k2.6', {
      systemPrompt: 'system',
      userPrompt: 'user',
    });

    // Guardian owns model selection (task = CODE_REVIEW, model = auto).
    expect(body.project).toBe('codra');
    expect(body.task).toBe('CODE_REVIEW');
    expect(body.model).toBe('auto');
    expect(body.input.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'codra_file_review', strict: true } });
    expect(response.provider).toBe('ollama');
    expect(response.rawText).toContain('findings');
  });

  it('truncates an oversized diff before sending it through guardian', async () => {
    let body: any = null;
    const env = createTestEnv({ GUARDIAN: guardianStub(APPROVE, { capture: (b) => { body = b; } }) });
    await seedReviewModels(env);
    const service = new ModelService(env);

    const response = await service.reviewFile({
      file: largeFile(900),
      prTitle: 'Test',
      prDescription: null,
      config: { ...defaultRepoConfig, model: { main: 'gemma-4-31b-it', fallbacks: [], size_overrides: [] } },
      totalLineCount: 500,
    });

    const userPrompt = body.input.messages[1].content as string;
    expect(userPrompt).toContain('[NOTE: This diff has been truncated from 900 lines to 800 lines for brevity.]');
    expect(userPrompt).toContain('const value799 = 799;');
    expect(userPrompt).not.toContain('const value800 = 800;');
    expect(response.reviewedLineCount).toBe(800);
    expect(response.wasPromptTruncated).toBe(true);
  });

  it('marks a guardian outage as retryable so the queue retries the job', async () => {
    const env = createTestEnv({ GUARDIAN: guardianStub(APPROVE, { status: 502 }) });
    await seedReviewModels(env);
    const service = new ModelService(env);

    await expect(
      service.reviewFile({
        file: { path: 'src/app.ts', lineCount: 1, hunks: [], isDeleted: false, isBinary: false, isNew: false, previousPath: null },
        prTitle: 'Test',
        prDescription: null,
        config: { ...defaultRepoConfig, model: { main: '@cf/zai-org/glm-4.7-flash', fallbacks: [], size_overrides: [] } },
        totalLineCount: 1,
      }),
    ).rejects.toSatisfy(isRetryableModelError);
  });

  it('retries Google once for transient 524 edge timeouts (provider client unit)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 524, message: 'A timeout occurred.' } }), { status: 524, headers: { 'content-type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"findings":[],"overall_correctness":"patch is correct","overall_explanation":"ok","overall_confidence_score":0.9}' }] } }],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const response = await reviewWithGoogle({ apiKey: 'test-key' }, 'gemma-4-31b-it', { systemPrompt: 'system', userPrompt: 'user' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.rawText).toContain('"findings"');
  });
});
