import { reviewWithGoogle } from '../models/google';
import { reviewWithCloudflare } from '../models/cloudflare';
import { reviewWithOpenAI } from '../models/openai';
import { reviewWithAnthropic } from '../models/anthropic';
import { buildFileReviewPrompts } from '../prompts/file-review';
import { buildSummaryPrompt, SUMMARY_SYSTEM_PROMPT } from '../prompts/summary';
import { parseFileReviewResponse } from '../core/model-output';
import { truncateFileDiff } from '../core/diff';
import type { RepoConfig } from '@shared/schema';
import type { TokenTracker } from '../core/token-tracker';
import type { ModelResponse } from '../models/types';
import { logger } from '../core/logger';
import { normalizeModelId } from '@shared/schema';
import { getResolvedModelConfig, type ResolvedModelConfig } from '@server/db/model-configs';
import { decryptLlmApiKey, resolveLlmApiKey } from '@server/core/llm-crypto';
import { getMatchingBestPractices, convertPlateToMarkdown } from '@server/db/best-practices';
import { getSecretStoreBinding } from '@server/utils/secrets';
import { logApiUsage } from '@server/db/api-usage';

const PROVIDER_UNAVAILABLE_TTL_SECONDS = 24 * 60 * 60;
const COMPACT_REVIEW_PROMPT_LINE_CAP = 400;
const MODEL_ALIASES: Record<string, string> = {
  'gemma-4-31b': 'gemma-4-31b-it',
  'gemma-4-26b': 'gemma-4-26b-a4b-it',
};

export class RetryableModelError extends Error {
  readonly retryable = true;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'RetryableModelError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: cause,
        writable: true,
        configurable: true,
      });
    }
  }
}

export function isRetryableModelError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'retryable' in error && error.retryable === true);
}

function normalizeModel(model: string) {
  return normalizeModelId(MODEL_ALIASES[model] ?? model);
}

function uniqueModels(models: string[]) {
  return Array.from(new Set(models.map(normalizeModel)));
}

function isCloudflareAllocationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('4006') || message.toLowerCase().includes('daily free allocation');
}

function isGoogleRateLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('429') || message.includes('RESOURCE_EXHAUSTED') || message.toLowerCase().includes('quota exceeded');
}

function isTransientModelFailure(error: unknown) {
  if (isRetryableModelError(error)) return true;
  if (isCloudflareAllocationError(error)) return false;
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  return (
    isGoogleRateLimitError(error) ||
    /\b50[0-9]\b/.test(message) ||
    lower.includes('internal error') ||
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('fetch failed') ||
    lower.includes('network') ||
    lower.includes('temporar') ||
    lower.includes('returned no review content') ||
    lower.includes('empty response') ||
    lower.includes('[redacted]')
  );
}

export class ModelService {
  constructor(
    private env: Env,
    private tracker?: TokenTracker,
    private options: { jobId?: string } = {},
  ) {}

  private providerUnavailableKey(providerId: string) {
    return this.options.jobId ? `jobs:${this.options.jobId}:provider-unavailable:${providerId}` : null;
  }

  private async isProviderUnavailable(providerId: string) {
    const key = this.providerUnavailableKey(providerId);
    if (!key) return false;

    try {
      return (await this.env.APP_KV.get(key)) !== null;
    } catch (error) {
      logger.warn(`Failed to read unavailable provider marker for ${providerId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async markProviderUnavailable(providerId: string, reason: string) {
    const key = this.providerUnavailableKey(providerId);
    if (!key) return;

    try {
      await this.env.APP_KV.put(
        key,
        JSON.stringify({
          reason,
          markedAt: new Date().toISOString(),
        }),
        { expirationTtl: PROVIDER_UNAVAILABLE_TTL_SECONDS },
      );
    } catch (error) {
      logger.warn(`Failed to write unavailable provider marker for ${providerId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private selectModel(params: {
    totalLineCount: number;
    config: RepoConfig;
  }): { primary: string; fallbacks: string[] } {
    const { model: modelCfg } = params.config;
    const thresholdBase = params.totalLineCount;

    let selectedModel = modelCfg?.main ? normalizeModel(modelCfg.main) : null;
    let fallbackModels = (modelCfg?.fallbacks || []).map(normalizeModel);

    // Apply size overrides based on total PR lines
    if (modelCfg?.size_overrides && modelCfg.size_overrides.length > 0) {
      const sortedOverrides = [...modelCfg.size_overrides].sort((a, b) => a.max_lines - b.max_lines);
      const matched = sortedOverrides.find(o => thresholdBase <= o.max_lines);
      if (matched) {
        selectedModel = normalizeModel(matched.model);
        fallbackModels = (matched.fallbacks || fallbackModels).map(normalizeModel);
      }
    }

    const chain = uniqueModels([...(selectedModel ? [selectedModel] : []), ...fallbackModels]);
    if (chain.length === 0) {
      throw new Error('No review model strategy is configured. Choose a global model strategy in Settings, or configure this repository.');
    }

    selectedModel = chain[0];
    fallbackModels = chain.slice(1);

    return { primary: selectedModel, fallbacks: fallbackModels };
  }

  private async resolveModel(model: string) {
    const normalized = normalizeModel(model);
    const resolved = await getResolvedModelConfig(this.env, normalized);
    if (!resolved) {
      throw new Error(`Model ${normalized} is not configured. Add it in Settings before using it in a route.`);
    }

    if (!resolved.providerEnabled) {
      throw new Error(`Provider ${resolved.providerName} is disabled.`);
    }

    return resolved;
  }

  private async resolveApiKey(config: ResolvedModelConfig) {
    const key = await resolveLlmApiKey(this.env, config.apiFormat, config.encryptedApiKey);
    if (!key) {
      throw new Error(`Provider ${config.providerName} does not have an API key configured.`);
    }
    return key;
  }

  private async callResolvedModel(
    config: ResolvedModelConfig,
    input: { systemPrompt: string; userPrompt: string },
  ): Promise<ModelResponse> {
    if (config.apiFormat === 'cloudflare-workers-ai') {
      return reviewWithCloudflare(this.env, config.modelName, input, this.tracker, config.providerName);
    }

    let resolvedBaseUrl = config.baseUrl;
    if (this.env.AI_GATEWAY_ID) {
      try {
        const accountId = await getSecretStoreBinding(this.env, 'CF_ACCOUNT_ID');
        resolvedBaseUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${this.env.AI_GATEWAY_ID}`;
        if (accountId) {
          if (config.apiFormat === 'openai') {
            resolvedBaseUrl = `${resolvedBaseUrl}/openai`;
          } else if (config.apiFormat === 'gemini') {
            resolvedBaseUrl = `${resolvedBaseUrl}/google-ai-studio`;
          } else if (config.apiFormat === 'anthropic') {
            resolvedBaseUrl = `${resolvedBaseUrl}/anthropic`;
          }
        }
      } catch (err) {
        logger.warn('Failed to resolve CF_ACCOUNT_ID for AI Gateway routing', err);
      }
    }

    let result: ModelResponse;

    if (config.apiFormat === 'gemini') {
      result = await reviewWithGoogle(
        { apiKey: await this.resolveApiKey(config), baseUrl: resolvedBaseUrl, providerName: config.providerName },
        config.modelName,
        input,
        this.tracker,
      );
    } else if (config.apiFormat === 'openai') {
      result = await reviewWithOpenAI(
        {
          apiKey: await this.resolveApiKey(config),
          baseUrl: resolvedBaseUrl || 'https://api.openai.com/v1',
          providerName: config.providerName,
        },
        config.modelName,
        input,
        this.tracker,
      );
    } else {
      result = await reviewWithAnthropic(
        { apiKey: await this.resolveApiKey(config), baseUrl: resolvedBaseUrl, providerName: config.providerName },
        config.modelName,
        input,
        this.tracker,
      );
    }

    // Log the API usage locally in the database
    await logApiUsage(this.env, {
      provider: config.providerName,
      model: config.modelName,
      promptTokens: result.inputTokens || 0,
      completionTokens: result.outputTokens || 0,
      source: 'local',
      gatewayId: this.env.AI_GATEWAY_ID || '',
    });

    return result;
  }

  async callModel(model: string, input: { systemPrompt: string; userPrompt: string }): Promise<ModelResponse> {
    return this.callResolvedModel(await this.resolveModel(model), input);
  }

  async reviewFile(params: {
    file: any;
    prTitle: string | null;
    prDescription: string | null;
    config: RepoConfig;
    totalLineCount: number;
    compactPrompt?: boolean;
  }) {
    const configuredLineCap = params.config.review.max_diff_lines_per_file;
    const modelLineCap = params.compactPrompt
      ? Math.min(configuredLineCap, COMPACT_REVIEW_PROMPT_LINE_CAP)
      : configuredLineCap;
    const reviewFile = truncateFileDiff(params.file, modelLineCap);

    const diffContent = params.file.hunks
      ? params.file.hunks.flatMap((h: any) => h.lines.map((l: any) => l.content)).join('\n')
      : '';
    const matchedPractices = await getMatchingBestPractices(this.env, params.file.path, diffContent);
    const lessons = await fetchLessonsLearned(this.env, params.file.path);
    const customRules = [
      ...params.config.review.custom_rules,
      ...matchedPractices.map(p => `Best Practice [${p.name}]:\n${convertPlateToMarkdown(p.instructions)}`),
    ];

    if (lessons && lessons.length > 0) {
      customRules.push(`
=== Lessons Learned from Past Incorrect Code Review Comments on this file ===
Coding agents previously marked the following comments as INCORRECT. You must follow these guidelines:
${lessons.map((lesson, idx) => `
Lesson #${idx + 1}:
- Wrong comment previously made: "${lesson.commentText}"
- Correction/Feedback provided: "${lesson.feedbackText}"
- Action required: If you are going to make a similar comment, you MUST include a solid justification explaining why it is still relevant in this specific context. If you agree the comment would be wrong, you MUST skip making the comment. In either case, be transparent. If you skip making a comment because of this lesson, you can declare that in a skipped-comment log, or if you include it, specify the justification.
`).join('\n')}
`);
    }

    const { systemPrompt, userPrompt } = buildFileReviewPrompts({
      ...params,
      file: reviewFile,
      config: {
        ...params.config.review,
        custom_rules: customRules,
      },
    });

    const { primary, fallbacks } = this.selectModel({
      totalLineCount: params.totalLineCount,
      config: params.config,
    });
    const modelsToTry = [primary, ...fallbacks];

    let lastError: unknown;
    let lastTransientError: unknown;
    let sawTransientFailure = false;
    for (const currentModel of modelsToTry) {
      let resolved: ResolvedModelConfig;
      try {
        resolved = await this.resolveModel(currentModel);
      } catch (error) {
        lastError = error;
        logger.warn(`Model ${currentModel} could not be resolved`, {
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (resolved.apiFormat === 'cloudflare-workers-ai' && await this.isProviderUnavailable(resolved.providerId)) {
        logger.warn(`Skipping ${resolved.providerName} model ${currentModel} because the provider is unavailable for job ${this.options.jobId ?? 'unknown'}`);
        continue;
      }

      let attempts = 0;
      const maxAttempts = 1;

      while (attempts < maxAttempts) {
        try {
          const response = await this.callResolvedModel(resolved, { systemPrompt, userPrompt });

          if (this.tracker) {
            this.tracker.record(response.modelUsed, response.inputTokens, response.outputTokens);
          }

          const parsed = parseFileReviewResponse(response.rawText, params.file);
          return {
            ...response,
            parsed,
            userPrompt,
            reviewedLineCount: reviewFile.lineCount,
            wasPromptTruncated: reviewFile.isTruncated === true,
          };
        } catch (error) {
          lastError = error;
          if (isTransientModelFailure(error)) {
            sawTransientFailure = true;
            lastTransientError = error;
          }
          attempts++;
          if (resolved.apiFormat === 'cloudflare-workers-ai' && isCloudflareAllocationError(error)) {
            await this.markProviderUnavailable(resolved.providerId, error instanceof Error ? error.message : String(error));
          }

          const isRateLimit = isGoogleRateLimitError(error);
          const isRetryable = false;
          const errorMessage = error instanceof Error ? error.message : String(error);

          logger.warn(`Model ${currentModel} failed for ${params.file.path} (attempt ${attempts}/${maxAttempts})`, {
            error: errorMessage,
            rateLimited: isRateLimit,
            willRetrySameModel: isRetryable,
            willTryFallback: !isRetryable && modelsToTry.indexOf(currentModel) < modelsToTry.length - 1
          });

          if (isRetryable) {
            continue;
          }
          break; // Move to next model in fallbacks
        }
      }
    }

    if (sawTransientFailure) {
      const retryCause = lastTransientError ?? lastError;
      const lastMessage = retryCause instanceof Error ? retryCause.message : String(retryCause ?? 'Unknown model error');
      throw new RetryableModelError(
        `All configured review models failed for ${params.file.path}; retrying later. Last error: ${lastMessage}`,
        retryCause,
      );
    }

    throw lastError;
  }

  async generateSummary(params: {
    prTitle: string | null;
    verdict: 'approve' | 'comment';
    fileSummaries: Array<{ path: string; summary: string; verdict: string }>;
    config: RepoConfig;
  }) {
    const { primary, fallbacks } = this.selectModel({ totalLineCount: 0, config: params.config });
    const modelsToTry = [primary, ...fallbacks];

    let lastError: unknown;
    let lastTransientError: unknown;
    let sawTransientFailure = false;
    for (const currentModel of modelsToTry) {
      let resolved: ResolvedModelConfig;
      try {
        resolved = await this.resolveModel(currentModel);
      } catch (error) {
        lastError = error;
        logger.warn(`Summary model ${currentModel} could not be resolved`, {
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (resolved.apiFormat === 'cloudflare-workers-ai' && await this.isProviderUnavailable(resolved.providerId)) {
        logger.warn(`Skipping ${resolved.providerName} summary model ${currentModel} because the provider is unavailable for job ${this.options.jobId ?? 'unknown'}`);
        continue;
      }

      try {
        const response = await this.callResolvedModel(resolved, {
          systemPrompt: SUMMARY_SYSTEM_PROMPT,
          userPrompt: buildSummaryPrompt(params),
        });

        if (this.tracker) {
          this.tracker.record(response.modelUsed, response.inputTokens, response.outputTokens);
        }

        return response;
      } catch (error) {
        lastError = error;
        if (isTransientModelFailure(error)) {
          sawTransientFailure = true;
          lastTransientError = error;
        }
        if (resolved.apiFormat === 'cloudflare-workers-ai' && isCloudflareAllocationError(error)) {
          await this.markProviderUnavailable(resolved.providerId, error instanceof Error ? error.message : String(error));
        }
        logger.warn(`Summary model ${currentModel} failed`, { error: error instanceof Error ? error.message : String(error) });
      }
    }

    if (sawTransientFailure) {
      const retryCause = lastTransientError ?? lastError;
      const lastMessage = retryCause instanceof Error ? retryCause.message : String(retryCause ?? 'Unknown model error');
      throw new RetryableModelError(
        `All configured summary models failed; retrying later. Last error: ${lastMessage}`,
        retryCause,
      );
    }

    throw lastError;
  }
}

async function fetchLessonsLearned(env: any, filePath: string): Promise<any[]> {
  if (!env.EDGRAPH) return [];
  try {
    const res = await env.EDGRAPH.fetch(`https://github.com/jmbish04/core-github-api-edgraph/api/lessons?file=${encodeURIComponent(filePath)}`);
    if (!res.ok) return [];
    const data = await res.json() as any;
    return data.lessons || [];
  } catch (err) {
    console.error('Failed to fetch lessons learned from EDGRAPH service binding', err);
    return [];
  }
}
