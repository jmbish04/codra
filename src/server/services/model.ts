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
      return { primary: 'gemma-4-31b-it', fallbacks: [] };
    }

    let selectedModel = modelCfg.main;
    let fallbackModels = modelCfg.fallbacks || [];

    // Apply size overrides based on total PR lines
    if (modelCfg.size_overrides && modelCfg.size_overrides.length > 0) {
      const sortedOverrides = [...modelCfg.size_overrides].sort((a, b) => a.max_lines - b.max_lines);
      const matched = sortedOverrides.find(o => thresholdBase <= o.max_lines);
      if (matched) {
        selectedModel = matched.model;
        fallbackModels = matched.fallbacks || fallbackModels;
      }
    }

    return { primary: selectedModel, fallbacks: fallbackModels };
  }

  private async callModel(model: string, input: { systemPrompt: string; userPrompt: string }): Promise<ModelResponse> {
    // Determine provider based on model name
    // Cloudflare models start with @cf/
    if (model.startsWith('@cf/')) {
      return await reviewWithCloudflare(this.env, model, input);
    } else {
      // Default to Google for gemma/gemini
      return await reviewWithGoogle(this.env, model, input);
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
    for (const currentModel of modelsToTry) {
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
        logger.warn(`Model ${currentModel} failed for ${params.file.path}`, { 
          error: error.message || error,
          willRetry: modelsToTry.indexOf(currentModel) < modelsToTry.length - 1
        });
      }
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
    for (const currentModel of modelsToTry) {
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
        logger.warn(`Summary model ${currentModel} failed`, { error: error.message || error });
      }
    }

    throw lastError;
  }
}
