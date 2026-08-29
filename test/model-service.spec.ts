import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRetryableModelError, ModelService } from '@server/services/model';
import { reviewWithCloudflare, extractCloudflareText } from '@server/models/cloudflare';
import { createTestEnv, saveTestProviderApiKey, seedReviewModels } from './helpers';
import { defaultRepoConfig } from '@shared/schema';
import { runGuardianInference, type GuardianInferenceResult } from '@server/core/guardian-ai';

// All inference now routes through core-guardian. Mock the single transport seam
// (`runGuardianInference`) instead of the provider HTTP calls — the provider
// modules still build the native request body (asserted via the mock's `input`
// arg) and parse the native response `body` we return here.
vi.mock('@server/core/guardian-ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@server/core/guardian-ai')>();
  return { ...actual, runGuardianInference: vi.fn() };
});

const runMock = vi.mocked(runGuardianInference);

/** Wraps a provider-native response body as a guardian inference result. */
function gResult(body: unknown, tokensIn = 1, tokensOut = 1): GuardianInferenceResult {
  return { body, tokensIn, tokensOut, costUsd: 0, provider: 'test', model: 'test', requestUuid: 'uuid' };
}

/** A minimal valid Gemini review body. */
function geminiBody(text = '{"findings":[],"overall_correctness":"patch is correct","overall_explanation":"ok","overall_confidence_score":0.9}') {
  return { candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
}

/** A minimal valid Workers-AI review body. */
function cloudflareBody(json = '{"findings":[],"overall_correctness":"patch is correct","overall_explanation":"ok","overall_confidence_score":0.9}') {
  return { choices: [{ message: { content: json } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
}

describe('ModelService', () => {
  beforeEach(() => {
    runMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes legacy Kimi K2.5 ids to Kimi K2.6 for new Cloudflare requests', async () => {
    runMock.mockResolvedValue(gResult(cloudflareBody('{"findings":[]}')));
    const env = createTestEnv();
    await seedReviewModels(env);
    const service = new ModelService(env);
    const response = await (service as any).callModel('@cf/moonshotai/kimi-k2.5', {
      systemPrompt: 'system',
      userPrompt: 'user',
    });

    expect(runMock.mock.calls[0][1]).toBe('cloudflare-workers-ai');
    expect(runMock.mock.calls[0][2]).toBe('@cf/moonshotai/kimi-k2.6');
    expect(response.modelUsed).toBe('@cf/moonshotai/kimi-k2.6');
  });

  it('appends the default Workers AI fallbacks to a configured strategy', () => {
    const service = new ModelService(createTestEnv());
    const selected = (service as any).selectModel({
      totalLineCount: 500,
      config: {
        ...defaultRepoConfig,
        model: {
          main: 'gemma-4-31b-it',
          fallbacks: [],
          size_overrides: [],
        },
      },
    });

    // selectModel always appends DEFAULT_WORKERS_AI_FALLBACKS for resilience, so
    // an empty configured fallback list still resolves to the default chain.
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

    expect(() => (service as any).selectModel({
      totalLineCount: 1,
      config: defaultRepoConfig,
    })).toThrow('No review model strategy is configured');
  });

  // extractCloudflareText is the synthesize path (throwOnNoContent omitted). The
  // sync reviewWithCloudflare deliberately throws on reasoning-only responses so
  // the model service falls back to another provider instead.
  it('turns Cloudflare reasoning-only responses into inconclusive review JSON', () => {
    const result = {
      choices: [
        { message: { content: null, reasoning: 'Long reasoning that consumed the completion budget.' }, finish_reason: 'length' },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 4096 },
    };

    const parsed = JSON.parse(extractCloudflareText(result, '@cf/moonshotai/kimi-k2.6'));

    expect(parsed.findings).toEqual([]);
    expect(parsed.overall_correctness).toBe('patch is incorrect');
    expect(parsed.overall_explanation).toContain('inconclusive');
  });

  it('does not parse Cloudflare reasoning as review JSON when final content is missing', () => {
    const result = {
      choices: [
        { message: { content: null, reasoning: 'Reasoning mentioned an object like {"foo":"bar"} but never produced final JSON.' }, finish_reason: 'length' },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 8192 },
    };

    const parsed = JSON.parse(extractCloudflareText(result, '@cf/zai-org/glm-4.7-flash'));

    expect(parsed.findings).toEqual([]);
    expect(parsed.overall_explanation).toContain('reasoning-only response');
  });

  it('asks Cloudflare chat models for strict review JSON', async () => {
    runMock.mockResolvedValue(gResult(cloudflareBody()));

    await reviewWithCloudflare(createTestEnv(), '@cf/zai-org/glm-4.7-flash', {
      systemPrompt: 'system',
      userPrompt: 'user',
    });

    // The 4th arg to runGuardianInference is the native Workers-AI request body.
    const input = runMock.mock.calls[0][3] as any;
    expect(input.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'codra_file_review',
        strict: true,
      },
    });
    expect(input.messages[0].content).toContain('Return only the JSON object');
    expect(input.max_completion_tokens).toBe(8192);
  });

  it('propagates a Cloudflare guardian failure without an inline retry', async () => {
    runMock.mockRejectedValue(new Error('temporary provider error'));

    await expect(
      reviewWithCloudflare(createTestEnv(), '@cf/zai-org/glm-4.7-flash', {
        systemPrompt: 'system',
        userPrompt: 'user',
      }),
    ).rejects.toThrow('temporary provider error');
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it('tries the smaller Google fallback after the primary Google model fails', async () => {
    runMock.mockImplementation(async (_env, _fmt, model) => {
      if (model === 'gemma-4-31b-it') throw new Error('Internal error encountered.');
      return gResult(geminiBody());
    });
    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    await seedReviewModels(env);
    const service = new ModelService(env);

    const response = await service.reviewFile({
      file: {
        path: 'src/app.ts',
        lineCount: 1,
        hunks: [],
        isDeleted: false,
        isBinary: false,
        isNew: false,
        previousPath: null,
      },
      prTitle: 'Test',
      prDescription: null,
      config: {
        ...defaultRepoConfig,
        model: {
          main: 'gemma-4-31b-it',
          fallbacks: ['gemma-4-26b-a4b-it', '@cf/zai-org/glm-4.7-flash'],
          size_overrides: [],
        },
      },
      totalLineCount: 1,
    });

    expect(response.modelUsed).toBe('gemma-4-26b-a4b-it');
    // Workers AI is later in the chain and must never be reached once Gemini's
    // smaller fallback succeeds.
    expect(runMock.mock.calls.some((c) => c[1] === 'cloudflare-workers-ai')).toBe(false);
  });

  it('marks exhausted transient provider failures as retryable for the queue', async () => {
    runMock.mockRejectedValue(new Error('[REDACTED]'));
    const env = createTestEnv();

    await seedReviewModels(env);
    const service = new ModelService(env);
    await expect(
      service.reviewFile({
        file: {
          path: 'test/setup.ts',
          lineCount: 1,
          hunks: [],
          isDeleted: false,
          isBinary: false,
          isNew: false,
          previousPath: null,
        },
        prTitle: 'Test',
        prDescription: null,
        config: {
          ...defaultRepoConfig,
          model: {
            main: '@cf/zai-org/glm-4.7-flash',
            fallbacks: [],
            size_overrides: [],
          },
        },
        totalLineCount: 1,
      }),
    ).rejects.toSatisfy(isRetryableModelError);
  });

  it('skips Cloudflare for the rest of a job after allocation is exhausted', async () => {
    let cloudflareCalls = 0;
    runMock.mockImplementation(async (_env, fmt) => {
      if (fmt === 'cloudflare-workers-ai') {
        cloudflareCalls++;
        throw new Error('Cloudflare daily free allocation exhausted (4006)');
      }
      return gResult(geminiBody('{"findings":[]}'));
    });
    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    await seedReviewModels(env);
    const service = new ModelService(env, undefined, { jobId: 'job-provider-skip' });
    const file = {
      path: 'src/app.ts',
      lineCount: 1,
      hunks: [],
      isDeleted: false,
      isBinary: false,
      isNew: false,
      previousPath: null,
    };
    const config = {
      ...defaultRepoConfig,
      model: {
        main: '@cf/zai-org/glm-4.7-flash',
        fallbacks: ['gemma-4-31b-it'],
        size_overrides: [],
      },
    };

    await service.reviewFile({ file, prTitle: 'Test', prDescription: null, config, totalLineCount: 1 });
    await service.reviewFile({ file: { ...file, path: 'src/other.ts' }, prTitle: 'Test', prDescription: null, config, totalLineCount: 1 });

    // The 4006 marks the provider unavailable for the job, so the second file
    // never calls Workers AI again.
    expect(cloudflareCalls).toBe(1);
  });

  it('uses the configured Gemma prompt cap and output token budget on the first attempt', async () => {
    let input: any = null;
    runMock.mockImplementation(async (_env, _fmt, _model, body) => {
      input = body;
      return gResult(geminiBody());
    });
    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    await seedReviewModels(env);
    const service = new ModelService(env);
    const largeFile = {
      path: 'src/large.ts',
      previousPath: null,
      isNew: false,
      isDeleted: false,
      isBinary: false,
      lineCount: 900,
      hunks: [
        {
          header: '@@ -1,900 +1,900 @@',
          lines: Array.from({ length: 900 }, (_, index) => ({
            kind: 'add' as const,
            content: `const value${index} = ${index};`,
            newLineNumber: index + 1,
            position: index + 1,
          })),
        },
      ],
    };

    const response = await service.reviewFile({
      file: largeFile,
      prTitle: 'Test',
      prDescription: null,
      config: {
        ...defaultRepoConfig,
        model: {
          main: 'gemma-4-31b-it',
          fallbacks: [],
          size_overrides: [],
        },
      },
      totalLineCount: 500,
    });

    const userPrompt = input.contents[0].parts[0].text as string;
    expect(runMock).toHaveBeenCalledOnce();
    expect(input.generationConfig.maxOutputTokens).toBe(4096);
    expect(userPrompt).toContain('[NOTE: This diff has been truncated from 900 lines to 800 lines for brevity.]');
    expect(userPrompt).toContain('const value799 = 799;');
    expect(userPrompt).not.toContain('const value800 = 800;');
    expect(response.reviewedLineCount).toBe(800);
    expect(response.wasPromptTruncated).toBe(true);
  });

  it('uses a compact Gemma prompt only after a prior transient failure', async () => {
    let input: any = null;
    runMock.mockImplementation(async (_env, _fmt, _model, body) => {
      input = body;
      return gResult(geminiBody());
    });
    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    await seedReviewModels(env);
    const service = new ModelService(env);
    const largeFile = {
      path: 'src/large.ts',
      previousPath: null,
      isNew: false,
      isDeleted: false,
      isBinary: false,
      lineCount: 900,
      hunks: [
        {
          header: '@@ -1,900 +1,900 @@',
          lines: Array.from({ length: 900 }, (_, index) => ({
            kind: 'add' as const,
            content: `const value${index} = ${index};`,
            newLineNumber: index + 1,
            position: index + 1,
          })),
        },
      ],
    };

    const response = await service.reviewFile({
      file: largeFile,
      prTitle: 'Test',
      prDescription: null,
      config: {
        ...defaultRepoConfig,
        model: {
          main: 'gemma-4-31b-it',
          fallbacks: [],
          size_overrides: [],
        },
      },
      totalLineCount: 900,
      compactPrompt: true,
    });

    const userPrompt = input.contents[0].parts[0].text as string;
    expect(userPrompt).toContain('[NOTE: This diff has been truncated from 900 lines to 400 lines for brevity.]');
    expect(userPrompt).toContain('const value399 = 399;');
    expect(userPrompt).not.toContain('const value400 = 400;');
    expect(response.reviewedLineCount).toBe(400);
    expect(response.wasPromptTruncated).toBe(true);
  });
});
