import { logger } from '@server/core/logger';
import { TimeoutError } from '@server/core/timeout';
import { ProviderRequestError, type ModelResponse, type StructuredSchema } from './types';
import { REVIEW_SCHEMA } from './schemas';

/** Max wall-clock time allowed for a single Workers-AI call. */
const CLOUDFLARE_TIMEOUT_MS = 180_000;
const CLOUDFLARE_MAX_RETRIES = 0;
const CLOUDFLARE_MAX_OUTPUT_TOKENS = 8192;

type UnknownRecord = Record<string, unknown>;


function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function getRecord(value: unknown, key: string): UnknownRecord | null {
  if (!isRecord(value)) return null;
  const child = value[key];
  return isRecord(child) ? child : null;
}

function getText(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const child = value[key];
  return isText(child) ? child.trim() : null;
}

function getNumber(value: unknown, key: string) {
  if (!isRecord(value)) return null;
  const child = value[key];
  return typeof child === 'number' ? child : null;
}

function isLocalWorkersAiBindingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes('binding ai') && normalized.includes('run remotely');
}

function synthesizeInconclusiveReview(model: string, reason: string): string {
  logger.warn(`Cloudflare model ${model} returned no parseable review content; synthesizing inconclusive review JSON`, {
    reason,
  });
  return JSON.stringify({
    findings: [],
    overall_correctness: 'patch is incorrect',
    overall_explanation: `Cloudflare model ${model} returned no parseable review content (${reason}). The file review is inconclusive.`,
    overall_confidence_score: 0,
  });
}

function extractMessageContent(content: unknown): string | null {
  if (isText(content)) return content.trim();

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (isText(part)) return part;
        if (isRecord(part) && isText(part.text)) return part.text;
        return '';
      })
      .join('')
      .trim();
    return text || null;
  }

  return null;
}

export function extractCloudflareText(result: unknown, model: string): string {
  if (isText(result)) return result.trim();
  const response = getText(result, 'response');
  if (response) return response;

  const nestedResult = getRecord(result, 'result');
  const nestedResponse = getText(nestedResult, 'response');
  if (nestedResponse) return nestedResponse;

  const choices = isRecord(result) && Array.isArray(result.choices) ? result.choices : null;
  const choice = choices?.[0];
  const message = getRecord(choice, 'message');
  const content = extractMessageContent(message?.content);
  if (content) return content;

  const finishReason = isRecord(choice) ? choice.finish_reason ?? choice.stop_reason : null;
  const reasoning = isText(message?.reasoning) ? message.reasoning : isText(message?.reasoning_content) ? message.reasoning_content : null;
  if (reasoning) {
    return synthesizeInconclusiveReview(model, `reasoning-only response${finishReason ? `, finish_reason=${String(finishReason)}` : ''}`);
  }

  if (finishReason) {
    return synthesizeInconclusiveReview(model, `finish_reason=${String(finishReason)}`);
  }

  return synthesizeInconclusiveReview(model, 'empty response');
}

export function extractCloudflareUsage(result: unknown) {
  const usage = getRecord(result, 'usage') ?? getRecord(getRecord(result, 'result'), 'usage');
  return {
    inputTokens: getNumber(usage, 'prompt_tokens') ?? 0,
    outputTokens: getNumber(usage, 'completion_tokens') ?? 0,
  };
}

/** Chat payload for a single file review. Shared by the sync and batch paths. */
export function buildCloudflareReviewRequest(
  input: { systemPrompt: string; userPrompt: string },
  schema: StructuredSchema = REVIEW_SCHEMA,
) {
  return {
    messages: [
      {
        role: 'system',
        content: `${input.systemPrompt}\n\nReturn only the JSON object. Do not include chain-of-thought, analysis, markdown, code fences, or explanatory prose.`,
      },
      { role: 'user', content: `${input.userPrompt}\n\nRespond with the required JSON object only.` },
    ],
    max_completion_tokens: CLOUDFLARE_MAX_OUTPUT_TOKENS,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: schema.name,
        strict: true,
        schema: schema.schema,
      },
    },
    temperature: 0,
    top_p: 0.1,
  };
}

/**
 * Routes Workers AI calls through AI Gateway so usage shows up alongside the
 * other providers. Without this the AI binding bypasses the gateway entirely.
 */
export function cloudflareAiOptions(env: Pick<Env, 'AI_GATEWAY_ID'>) {
  return env.AI_GATEWAY_ID ? { gateway: { id: env.AI_GATEWAY_ID } } : {};
}

export async function reviewWithCloudflare(
  env: Pick<Env, 'AI' | 'AI_GATEWAY_ID'>,
  model: string,
  input: { systemPrompt: string; userPrompt: string },
  tracker?: { incrementSubrequests(count?: number): void },
  providerName = 'Cloudflare',
  schema: StructuredSchema = REVIEW_SCHEMA,
): Promise<ModelResponse> {
  const maxRetries = CLOUDFLARE_MAX_RETRIES;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError(`Cloudflare (${model})`, CLOUDFLARE_TIMEOUT_MS)), CLOUDFLARE_TIMEOUT_MS);
    });

    try {
      if (tracker) tracker.incrementSubrequests(1);
      if (attempt > 0) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        logger.info(`Retrying Cloudflare request (attempt ${attempt}/${maxRetries}) in ${Math.round(delay)}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      logger.info(`Calling Cloudflare model: ${model}`);
      const startTime = Date.now();
      const result = await Promise.race([
        env.AI.run(model as any, buildCloudflareReviewRequest(input, schema), cloudflareAiOptions(env)),
        timeoutPromise,
      ]);
      const durationMs = Date.now() - startTime;
      logger.info(`AI model ${model} responded in ${durationMs}ms`);

      const rawText = extractCloudflareText(result, model);
      const usage = extractCloudflareUsage(result);

      return {
        rawText,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        modelUsed: model,
        provider: providerName,
      };
    } catch (error) {
      lastError = error;
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (isLocalWorkersAiBindingError(error)) {
        const message = 'Cloudflare Workers AI is not available in local Wrangler. Run with remote bindings or deploy the Worker to test Cloudflare models.';
        logger.warn(message, { model });
        throw new ProviderRequestError(providerName, 400, message);
      }

      logger.error(`Cloudflare request failed (attempt ${attempt}/${maxRetries})`, { error: errorMsg });

      // If we've used up our neuron quota, don't retry - it's a persistent error for this account/day
      if (errorMsg.includes('4006') || errorMsg.includes('daily free allocation')) {
        throw error;
      }

      const isTimeout = error instanceof TimeoutError;
      if ((isTimeout || attempt < maxRetries) && attempt < maxRetries) {
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}
