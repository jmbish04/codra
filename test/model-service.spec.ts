import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRetryableModelError, ModelService } from '@server/services/model';
import { reviewWithCloudflare } from '@server/models/cloudflare';
import { createTestEnv } from './helpers';
import { defaultRepoConfig } from '@shared/schema';

describe('ModelService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes legacy Kimi K2.5 ids to Kimi K2.6 for new Cloudflare requests', async () => {
    let requestedModel = '';
    const env = createTestEnv({
      AI: {
        async run(model: string) {
          requestedModel = model;
          return { response: '{"findings":[]}', usage: { prompt_tokens: 1, completion_tokens: 1 } };
        },
      } as any,
    });

    const service = new ModelService(env);
    const response = await (service as any).callModel('@cf/moonshotai/kimi-k2.5', {
      systemPrompt: 'system',
      userPrompt: 'user',
    });

    expect(requestedModel).toBe('@cf/moonshotai/kimi-k2.6');
    expect(response.modelUsed).toBe('@cf/moonshotai/kimi-k2.6');
  });

  it('preserves an explicitly empty fallback chain', () => {
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

    expect(selected).toEqual({
      primary: 'gemma-4-31b-it',
      fallbacks: [],
    });
  });

  it('rejects Cloudflare reasoning-only responses instead of trying to parse the response envelope', async () => {
    const env = createTestEnv({
      AI: {
        async run() {
          return {
            choices: [
              {
                message: {
                  content: null,
                  reasoning: 'Long reasoning that consumed the completion budget.',
                },
                finish_reason: 'length',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 4096 },
          };
        },
      } as any,
    });

    await expect(
      reviewWithCloudflare(env, '@cf/moonshotai/kimi-k2.6', {
        systemPrompt: 'system',
        userPrompt: 'user',
      }),
    ).rejects.toThrow('returned no review content');
  });

  it('does not spend an extra queue slice retrying the same Cloudflare model inline', async () => {
    let attempts = 0;
    const env = createTestEnv({
      AI: {
        async run() {
          attempts++;
          throw new Error('temporary provider error');
        },
      } as any,
    });

    await expect(
      reviewWithCloudflare(env, '@cf/zai-org/glm-4.7-flash', {
        systemPrompt: 'system',
        userPrompt: 'user',
      }),
    ).rejects.toThrow('temporary provider error');
    expect(attempts).toBe(1);
  });

  it('skips later models from the same provider after a transient provider failure', async () => {
    let cloudflareCalls = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 500,
            message: 'Internal error encountered.',
            status: 'INTERNAL',
          },
        }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ),
    );
    const env = createTestEnv({
      AI: {
        async run() {
          cloudflareCalls++;
          return {
            response: JSON.stringify({
              findings: [],
              overall_correctness: 'patch is correct',
              overall_explanation: 'ok',
              overall_confidence_score: 0.9,
            }),
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          };
        },
      } as any,
      GEMINI_API_KEY: 'test-key',
    });
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cloudflareCalls).toBe(1);
    expect(response.modelUsed).toBe('@cf/zai-org/glm-4.7-flash');
  });

  it('marks exhausted transient provider failures as retryable for the queue', async () => {
    const env = createTestEnv({
      AI: {
        async run() {
          throw new Error('[REDACTED]');
        },
      } as any,
    });

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
          review: {
            on: ['opened'],
            ignore_drafts: true,
            mention_trigger: '@codra-app',
            skip_files: [],
            max_files: 15,
            large_file_threshold_lines: 200,
            max_diff_lines_per_file: 800,
            max_total_diff_chars: 150_000,
            focus: ['quality'],
            custom_rules: [],
            labels: false,
            exec: {
              enabled: false,
              on_file_types: ['.ts'],
              command: 'npm run lint',
            },
          },
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
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"findings":[]}' }] } }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const env = createTestEnv({
      AI: {
        async run() {
          cloudflareCalls++;
          throw new Error('Cloudflare daily free allocation exhausted (4006)');
        },
      } as any,
      GEMINI_API_KEY: 'test-key',
    });
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

    await service.reviewFile({
      file,
      prTitle: 'Test',
      prDescription: null,
      config,
      totalLineCount: 1,
    });
    await service.reviewFile({
      file: { ...file, path: 'src/other.ts' },
      prTitle: 'Test',
      prDescription: null,
      config,
      totalLineCount: 1,
    });

    expect(cloudflareCalls).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the configured Gemma prompt cap and output token budget on the first attempt', async () => {
    let requestBody: any = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"findings":[],"overall_correctness":"patch is correct","overall_explanation":"ok","overall_confidence_score":0.9}' }] } }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const env = createTestEnv({ GEMINI_API_KEY: 'test-key' });
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

    const userPrompt = requestBody.contents[0].parts[0].text as string;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requestBody.generationConfig.maxOutputTokens).toBe(3072);
    expect(userPrompt).toContain('[NOTE: This diff has been truncated from 900 lines to 800 lines for brevity.]');
    expect(userPrompt).toContain('const value799 = 799;');
    expect(userPrompt).not.toContain('const value800 = 800;');
    expect(response.reviewedLineCount).toBe(800);
    expect(response.wasPromptTruncated).toBe(true);
  });

  it('uses a compact Gemma prompt only after a prior transient failure', async () => {
    let requestBody: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"findings":[],"overall_correctness":"patch is correct","overall_explanation":"ok","overall_confidence_score":0.9}' }] } }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const env = createTestEnv({ GEMINI_API_KEY: 'test-key' });
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

    const userPrompt = requestBody.contents[0].parts[0].text as string;
    expect(userPrompt).toContain('[NOTE: This diff has been truncated from 900 lines to 400 lines for brevity.]');
    expect(userPrompt).toContain('const value399 = 399;');
    expect(userPrompt).not.toContain('const value400 = 400;');
    expect(response.reviewedLineCount).toBe(400);
    expect(response.wasPromptTruncated).toBe(true);
  });
});
