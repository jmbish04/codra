import type { AppBindings } from '../env';
import { reviewWithGoogle } from '../models/google';
import { reviewWithCloudflare } from '../models/cloudflare';
import { buildFileReviewPrompts } from '../prompts/file-review';
import { buildSummaryPrompt, SUMMARY_SYSTEM_PROMPT } from '../prompts/summary';
import { parseFileReviewResponse } from '../core/model-output';
import type { RepoConfig } from '@shared/schema';
import type { TokenTracker } from '../core/token-tracker';
import type { ModelResponse } from '../models/types';
import { logger } from '../core/logger';
import { normalizeModelId } from '@shared/schema';

const DEFAULT_GOOGLE_FALLBACK = 'gemma-4-31b-it';
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
      (this as any).cause = cause;
    }
  }
}

export function isRetryableModelError(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as any).retryable === true);
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
  constructor(private env: AppBindings, private tracker?: TokenTracker) {}

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
  }) {
    const { systemPrompt, userPrompt } = buildFileReviewPrompts({
      ...params,
      config: params.config.review,
    });

    const { primary, fallbacks } = this.selectModel({
      totalLineCount: params.totalLineCount,
      config: params.config,
    });
    const modelsToTry = [primary, ...fallbacks];

    let lastError: any;
    let sawTransientFailure = false;
    const unavailableProviders = new Set<string>();
    for (const currentModel of modelsToTry) {
      if (isCloudflareModel(currentModel) && unavailableProviders.has('cloudflare')) {
        logger.warn(`Skipping Cloudflare model ${currentModel} because Cloudflare AI allocation is unavailable`);
        continue;
      }

      let attempts = 0;
      const maxAttempts = 2;

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
          };
        } catch (error: any) {
          lastError = error;
          if (isTransientModelFailure(error)) {
            sawTransientFailure = true;
          }
          attempts++;
          if (isCloudflareModel(currentModel) && isCloudflareAllocationError(error)) {
            unavailableProviders.add('cloudflare');
          }

          const isRateLimit = isGoogleRateLimitError(error);
          const isRetryable = false;

          logger.warn(`Model ${currentModel} failed for ${params.file.path} (attempt ${attempts}/${maxAttempts})`, {
            error: error.message || error,
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
      const lastMessage = lastError instanceof Error ? lastError.message : String(lastError ?? 'Unknown model error');
      throw new RetryableModelError(
        `All configured review models failed for ${params.file.path}; retrying later. Last error: ${lastMessage}`,
        lastError,
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

    let lastError: any;
    const unavailableProviders = new Set<string>();
    for (const currentModel of modelsToTry) {
      if (isCloudflareModel(currentModel) && unavailableProviders.has('cloudflare')) {
        logger.warn(`Skipping Cloudflare summary model ${currentModel} because Cloudflare AI allocation is unavailable`);
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
      } catch (error: any) {
        lastError = error;
        if (isCloudflareModel(currentModel) && isCloudflareAllocationError(error)) {
          unavailableProviders.add('cloudflare');
        }
        logger.warn(`Summary model ${currentModel} failed`, { error: error.message || error });
      }
    }

    throw lastError;
  }
}
