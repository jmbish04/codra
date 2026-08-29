import { reviewViaGuardian, type GuardianTask } from '@server/services/guardian';
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

  /** Exposes the shared per-invocation subrequest tracker so callers can gate
   *  work (e.g. reviewer fan-out) against Cloudflare's subrequest cap before
   *  issuing more model calls. */
  getTracker() {
    return this.tracker;
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
   * Runs one inference through core-guardian. Guardian owns provider/model
   * selection, fallback, metering, and budgets — so this is a SINGLE call; there
   * is no client-side model-chain fan-out (that would fire identical guardian
   * requests and burn the subrequest budget). `task` sets guardian's routing
   * intent + usage bucket.
   */
  private async runGuardian(
    input: { systemPrompt: string; userPrompt: string },
    schema: StructuredSchema,
    task: GuardianTask,
  ): Promise<ModelResponse> {
    return reviewViaGuardian(this.env, { input, schema, task });
  }

  async callModel(
    model: string,
    input: { systemPrompt: string; userPrompt: string },
    schema: StructuredSchema = REVIEW_SCHEMA,
  ): Promise<ModelResponse> {
    // `model` is advisory only now (guardian picks). Resolve it first so a
    // misconfigured/disabled model id still surfaces a clear error.
    await this.resolveModel(model);
    return this.runGuardian(input, schema, 'CODE_REVIEW');
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

    // Validate that a review model strategy is configured (throws if none).
    // Guardian owns model selection + provider fallback, so we make ONE call.
    this.selectModel({ totalLineCount: params.totalLineCount, config: params.config });

    try {
      const response = await this.runGuardian({ systemPrompt, userPrompt }, REVIEW_SCHEMA, 'CODE_REVIEW');
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Guardian review failed for ${params.file.path}`, { error: errorMessage });
      // Guardian outages/empty responses are transient — let the queue retry.
      if (isTransientModelFailure(error)) {
        throw new RetryableModelError(
          `Guardian review failed for ${params.file.path}; retrying later. Last error: ${errorMessage}`,
          error,
        );
      }
      throw error;
    }
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
    // Validate config, then a single guardian call (task = CHANGELOG).
    this.selectModel({ totalLineCount: 0, config: params.config });
    const response = await this.runGuardian(
      { systemPrompt: params.systemPrompt, userPrompt: params.userPrompt },
      CHANGELOG_SCHEMA,
      'CHANGELOG',
    );
    this.tracker?.record(response.modelUsed, response.inputTokens, response.outputTokens);
    return response;
  }

  async generateSummary(params: {
    prTitle: string | null;
    verdict: 'approve' | 'comment';
    fileSummaries: Array<{ path: string; summary: string; verdict: string }>;
    config: RepoConfig;
  }) {
    // Validate config, then a single guardian call (task = SUMMARY).
    this.selectModel({ totalLineCount: 0, config: params.config });
    try {
      const response = await this.runGuardian(
        { systemPrompt: SUMMARY_SYSTEM_PROMPT, userPrompt: buildSummaryPrompt(params) },
        REVIEW_SCHEMA,
        'SUMMARY',
      );
      if (this.tracker) {
        this.tracker.record(response.modelUsed, response.inputTokens, response.outputTokens);
      }
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('Guardian summary failed', { error: errorMessage });
      if (isTransientModelFailure(error)) {
        throw new RetryableModelError(`Guardian summary failed; retrying later. Last error: ${errorMessage}`, error);
      }
      throw error;
    }
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
