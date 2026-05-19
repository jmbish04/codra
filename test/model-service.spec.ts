import { describe, expect, it } from 'vitest';
import { isRetryableModelError, ModelService } from '@server/services/model';
import { reviewWithCloudflare } from '@server/models/cloudflare';
import { createTestEnv } from './helpers';

describe('ModelService', () => {
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

  it('retries the same Cloudflare model once before failing it', async () => {
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
    expect(attempts).toBe(2);
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
});
