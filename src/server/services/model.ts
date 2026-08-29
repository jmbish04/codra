import { reviewWithGoogle } from '../models/google';
import { reviewWithCloudflare } from '../models/cloudflare';
import type { BatchReviewItem, BatchPollResult } from '../models/cloudflare-batch';
import { reviewWithOpenAI } from '../models/openai';
import { reviewWithAnthropic } from '../models/anthropic';
import { buildFileReviewPrompts } from '../prompts/file-review';
import { buildSummaryPrompt, SUMMARY_SYSTEM_PROMPT } from '../prompts/summary';
import { parseFileReviewResponse } from '../core/model-output';
import { withTimeout } from '../core/timeout';
import { truncateFileDiff } from '../core/diff';
import type { RepoConfig } from '@shared/schema';
import type { TokenTracker } from '../core/token-tracker';
import type { ModelResponse, StructuredSchema } from '../models/types';
import { CHANGELOG_SCHEMA, REVIEW_SCHEMA } from '../models/schemas';
import { logger } from '../core/logger';
import { normalizeModelId } from '@shared/schema';
import { getResolvedModelConfig, type ResolvedModelConfig } from '@server/db/model-configs';
import { getMatchingBestPractices, convertPlateToMarkdown } from '@server/db/best-practices';

const PROVIDER_UNAVAILABLE_TTL_SECONDS = 24 * 60 * 60;
/**
 * Last-resort Workers AI coding models, appended to every chain so a repo with
 * no configured `fallbacks` still has somewhere to go when its main model has a
 * transient failure. Without this, an unconfigured chain is length 1 and any
 * blip escalates straight to a multi-minute RetryableModelError backoff.
 * Models absent from the DB resolve-fail and are skipped harmlessly.
 */
const DEFAULT_WORKERS_AI_FALLBACKS = [
  '@cf/moonshotai/kimi-k2.7-code',
  '@cf/zai-org/glm-5.2',
  '@cf/qwen/qwen2.5-coder-32b-instruct',
];
const COMPACT_REVIEW_PROMPT_LINE_CAP = 400;
const MODEL_ALIASES: Record<string, string> = {
  'gemma-4-31b': 'gemma-4-31b-it',
  'gemma-4-26b': 'gemma-4-26b-a4b-it',
};

// RetryableModelError / isRetryableModelError moved to `model-errors.ts` to
// break an import cycle (model → provider modules → guardian-ai → model).
// Re-exported here so existing importers keep working.
export { RetryableModelError, isRetryableModelError } from './model-errors';
import { RetryableModelError, isRetryableModelError } from './model-errors';

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

  /** Exposes the shared per-invocation subrequest tracker so callers can gate
   *  work (e.g. reviewer fan-out) against Cloudflare's subrequest cap before
   *  issuing more model calls. */
  getTracker() {
    return this.tracker;
  }

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

    const configured = uniqueModels([...(selectedModel ? [selectedModel] : []), ...fallbackModels]);
    if (configured.length === 0) {
      throw new Error('No review model strategy is configured. Choose a global model strategy in Settings, or configure this repository.');
    }

    const chain = uniqueModels([...configured, ...DEFAULT_WORKERS_AI_FALLBACKS]);

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

  /**
   * Dispatches one structured model call through core-guardian.
   *
   * Every provider format routes through the guardian AI router now (see
   * `src/server/core/guardian-ai.ts`) — Codra no longer holds provider API keys
   * or an `env.AI` binding on the review hot path, and it no longer resolves an
   * AI-Gateway base URL itself. Guardian injects the key, meters the spend
   * against the `codra` project budget, and is the ledger of record, so there is
   * no per-call D1 `logApiUsage` write here any more (that spend is captured by
   * the AI-Gateway usage sync + guardian's own accounting).
   */
  private async callResolvedModel(
    config: ResolvedModelConfig,
    input: { systemPrompt: string; userPrompt: string },
    schema: StructuredSchema = REVIEW_SCHEMA,
    cacheSystem?: boolean,
  ): Promise<ModelResponse> {
    if (config.apiFormat === 'cloudflare-workers-ai') {
      return reviewWithCloudflare(this.env, config.modelName, input, this.tracker, config.providerName, schema);
    }

    if (config.apiFormat === 'gemini') {
      return reviewWithGoogle(this.env, config.modelName, input, this.tracker, schema);
    }

    if (config.apiFormat === 'openai') {
      return reviewWithOpenAI(this.env, config.modelName, input, this.tracker, schema);
    }

    return reviewWithAnthropic(this.env, config.modelName, input, this.tracker, schema, { system: cacheSystem });
  }

  async callModel(
    model: string,
    input: { systemPrompt: string; userPrompt: string },
    schema: StructuredSchema = REVIEW_SCHEMA,
  ): Promise<ModelResponse> {
    return this.callResolvedModel(await this.resolveModel(model), input, schema);
  }

  /**
   * Resolves the batch-capable Workers AI model for this config, or null when
   * the chain's primary model cannot be batched (callers then use the
   * synchronous chunked path).
   */
  async resolveBatchModel(_config: RepoConfig, _totalLineCount: number): Promise<string | null> {
    // ponytail: the Workers AI async Batch API requires a local `env.AI`
    // binding, which Codra dropped when it moved all inference to core-guardian
    // (guardian exposes no batch proxy). Returning null makes every review take
    // the proven synchronous fan-out path — the already-designed fallback.
    // Upgrade path: add a batch proxy to core-guardian, then route it here.
    return null;
  }

  /**
   * Batch submit is disabled post-guardian-migration (see {@link resolveBatchModel}).
   * Unreachable because `resolveBatchModel` always returns null; kept as a stub
   * so the review pipeline's batch branch still type-checks. Returns null →
   * caller falls back to synchronous review.
   */
  async submitReviewBatch(_model: string, _items: BatchReviewItem[]): Promise<string | null> {
    return null;
  }

  /**
   * Polls a legacy in-flight Workers AI batch. Only reachable for a job that
   * submitted a batch BEFORE this deploy dropped `env.AI`; there is no longer a
   * binding to poll, so it fails fast and non-retryably. The review pipeline's
   * catch abandons the stranded batch and re-reviews the files synchronously.
   */
  async pollReviewBatch(_model: string, _requestId: string): Promise<BatchPollResult> {
    throw new Error('Workers AI batch polling is disabled after the core-guardian migration; falling back to synchronous review.');
  }

  /**
   * Builds the system/user prompts for one file review. Shared by the
   * synchronous path and the Workers AI batch path, which needs every prompt up
   * front without calling a model.
   */
  async buildReviewPrompt(params: {
    file: any;
    prTitle: string | null;
    prDescription: string | null;
    config: RepoConfig;
    totalLineCount: number;
    compactPrompt?: boolean;
    projectContext?: string;
    systemPromptOverride?: string;
    cacheSystem?: boolean;
    sharedContext?: string;
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

    if (matchedPractices.length > 0) {
      customRules.push(
        `=== Best-Practice Check Reporting ===\n` +
        `Each "Best Practice [name]" above is a CHECK PROCEDURE for this file. ` +
        `Run each one against this file and report the result in the "best_practice_checks" ` +
        `output array as { "practice": "<exact name>", "status": "pass" | "violation", "note": "<short evidence>" }. ` +
        `Report one entry per applicable best practice above. If a practice's trigger condition does not apply to this file, use status "pass". ` +
        `If none of the listed best practices apply to this file, set "best_practice_checks" to [] and do not invent checks.`,
      );
    }

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

    const { systemPrompt: builtSystemPrompt, userPrompt: builtUserPrompt } = buildFileReviewPrompts({
      ...params,
      file: reviewFile,
      config: {
        ...params.config.review,
        custom_rules: customRules,
      },
      projectContext: params.projectContext,
    });

    const systemPrompt = params.systemPromptOverride ?? builtSystemPrompt;
    const userPrompt = params.sharedContext ? `${params.sharedContext}\n\n${builtUserPrompt}` : builtUserPrompt;

    return { systemPrompt, userPrompt, reviewFile };
  }

  async reviewFile(params: {
    file: any;
    prTitle: string | null;
    prDescription: string | null;
    config: RepoConfig;
    totalLineCount: number;
    compactPrompt?: boolean;
    projectContext?: string;
    systemPromptOverride?: string;
    cacheSystem?: boolean;
    sharedContext?: string;
  }) {
    const { systemPrompt, userPrompt, reviewFile } = await this.buildReviewPrompt(params);

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
          const response = await this.callResolvedModel(resolved, { systemPrompt, userPrompt }, REVIEW_SCHEMA, params.cacheSystem);

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

  /**
   * Generates the structured changelog entry for a PR, walking the same model
   * chain as the review path. Returns raw JSON text matching
   * CHANGELOG_RESPONSE_SCHEMA; the caller validates it with Zod.
   */
  async generateChangelog(params: {
    config: RepoConfig;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<ModelResponse> {
    const { primary, fallbacks } = this.selectModel({ totalLineCount: 0, config: params.config });

    let lastError: unknown;
    for (const currentModel of [primary, ...fallbacks]) {
      let resolved: ResolvedModelConfig;
      try {
        resolved = await this.resolveModel(currentModel);
      } catch (error) {
        lastError = error;
        continue;
      }

      if (resolved.apiFormat === 'cloudflare-workers-ai' && (await this.isProviderUnavailable(resolved.providerId))) {
        continue;
      }

      try {
        const response = await this.callResolvedModel(
          resolved,
          { systemPrompt: params.systemPrompt, userPrompt: params.userPrompt },
          CHANGELOG_SCHEMA,
        );
        this.tracker?.record(response.modelUsed, response.inputTokens, response.outputTokens);
        return response;
      } catch (error) {
        lastError = error;
        logger.warn(`Changelog model ${currentModel} failed`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    throw lastError ?? new Error('No model could generate the changelog entry.');
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

interface EdgraphLesson {
  commentText: string;
  feedbackText: string;
}

async function fetchLessonsLearned(env: Pick<Env, 'EDGRAPH'>, filePath: string): Promise<EdgraphLesson[]> {
  if (!env.EDGRAPH) return [];
  try {
    // EDGRAPH is a service binding, so the runtime ignores the URL host and
    // routes on path/query to the bound worker — use a neutral host rather than
    // a hardcoded external URL. Supplementary context: time-bounded so a hung
    // binding never stalls a file review, and the catch turns any failure
    // (including a timeout) into an empty list.
    const res = await withTimeout<Response>('EDGRAPH lessons', 10000, (signal) =>
      env.EDGRAPH.fetch(`https://edgraph/api/lessons?file=${encodeURIComponent(filePath)}`, { signal }),
    );
    if (!res.ok) return [];
    const data = await res.json() as { lessons?: EdgraphLesson[] };
    return data.lessons ?? [];
  } catch (err) {
    console.error('Failed to fetch lessons learned from EDGRAPH service binding', err);
    return [];
  }
}
