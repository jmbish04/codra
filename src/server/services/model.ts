import type { AppBindings } from '../env';
import { reviewWithGoogle } from '../models/google';
import { reviewWithCloudflare } from '../models/cloudflare';
import { buildFileReviewPrompts } from '../prompts/file-review';
import { buildSummaryPrompt, SUMMARY_SYSTEM_PROMPT } from '../prompts/summary';
import { parseFileReviewResponse } from '../core/model-output';
import { truncateFileDiff } from '../core/diff';
import type { RepoConfig } from '@shared/schema';
import type { TokenTracker } from '../core/token-tracker';
import type { ModelResponse } from '../models/types';
import { logger } from '../core/logger';
import { normalizeModelId } from '@shared/schema';

const DEFAULT_GOOGLE_FALLBACK = 'gemma-4-31b-it';
const PROVIDER_UNAVAILABLE_TTL_SECONDS = 24 * 60 * 60;
const COMPACT_REVIEW_PROMPT_LINE_CAP = 400;
const MODEL_ALIASES: Record<string, string> = {
  'gemma-4-31b': 'gemma-4-31b-it',
  'gemma-4-26b': 'gemma-4-26b-a4b-it',
};
type ModelProvider = 'cloudflare';

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

function isCloudflareModel(model: string) {
  return model.startsWith('@cf/');
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
    private env: AppBindings,
    private tracker?: TokenTracker,
    private options: { jobId?: string } = {},
  ) {}

  private providerUnavailableKey(provider: ModelProvider) {
    return this.options.jobId ? `jobs:${this.options.jobId}:provider-unavailable:${provider}` : null;
  }

  private async isProviderUnavailable(provider: ModelProvider) {
    const key = this.providerUnavailableKey(provider);
    if (!key) return false;

    try {
      return (await this.env.APP_KV.get(key)) !== null;
    } catch (error) {
      logger.warn(`Failed to read unavailable provider marker for ${provider}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async markProviderUnavailable(provider: ModelProvider, reason: string) {
    const key = this.providerUnavailableKey(provider);
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
      logger.warn(`Failed to write unavailable provider marker for ${provider}`, {
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

    // Use default if not configured
    if (!modelCfg) {
      return {
        primary: 'gemma-4-31b-it',
        fallbacks: ['gemma-4-26b-a4b-it', '@cf/zai-org/glm-4.7-flash']
      };
    }

    let selectedModel = normalizeModel(modelCfg.main ?? 'gemma-4-31b-it');
    let fallbackModels = (modelCfg.fallbacks || []).map(normalizeModel);

    // Apply size overrides based on total PR lines
    if (modelCfg.size_overrides && modelCfg.size_overrides.length > 0) {
      const sortedOverrides = [...modelCfg.size_overrides].sort((a, b) => a.max_lines - b.max_lines);
      const matched = sortedOverrides.find(o => thresholdBase <= o.max_lines);
      if (matched) {
        selectedModel = normalizeModel(matched.model);
        fallbackModels = (matched.fallbacks || fallbackModels).map(normalizeModel);
      }
    }

    const chain = uniqueModels([selectedModel, ...fallbackModels]);
    selectedModel = chain[0] ?? 'gemma-4-31b-it';
    fallbackModels = chain.slice(1);
    if (chain.length > 0 && chain.every(isCloudflareModel)) {
      fallbackModels = [...fallbackModels, DEFAULT_GOOGLE_FALLBACK];
    }

    return { primary: selectedModel, fallbacks: fallbackModels };
  }

  private async callModel(model: string, input: { systemPrompt: string; userPrompt: string }): Promise<ModelResponse> {
    model = normalizeModel(model);
    // Determine provider based on model name
    // Cloudflare models start with @cf/
    if (model.startsWith('@cf/')) {
      return await reviewWithCloudflare(this.env, model, input, this.tracker);
    } else {
      // Default to Google for gemma/gemini
      return await reviewWithGoogle(this.env, model, input, this.tracker);
    }
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
    const { systemPrompt, userPrompt } = buildFileReviewPrompts({
      ...params,
      file: reviewFile,
      config: params.config.review,
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
      if (isCloudflareModel(currentModel) && await this.isProviderUnavailable('cloudflare')) {
        logger.warn(`Skipping Cloudflare model ${currentModel} because Cloudflare AI allocation is unavailable for job ${this.options.jobId ?? 'unknown'}`);
        continue;
      }

      let attempts = 0;
      const maxAttempts = 1;

      while (attempts < maxAttempts) {
        try {
          const response = await this.callModel(currentModel, { systemPrompt, userPrompt });

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
          if (isCloudflareModel(currentModel) && isCloudflareAllocationError(error)) {
            await this.markProviderUnavailable('cloudflare', error instanceof Error ? error.message : String(error));
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
      if (isCloudflareModel(currentModel) && await this.isProviderUnavailable('cloudflare')) {
        logger.warn(`Skipping Cloudflare summary model ${currentModel} because Cloudflare AI allocation is unavailable for job ${this.options.jobId ?? 'unknown'}`);
        continue;
      }

      try {
        const response = await this.callModel(currentModel, {
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
        if (isCloudflareModel(currentModel) && isCloudflareAllocationError(error)) {
          await this.markProviderUnavailable('cloudflare', error instanceof Error ? error.message : String(error));
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
