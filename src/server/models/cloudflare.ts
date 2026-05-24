import { logger } from '@server/core/logger';
import type { AppBindings } from '@server/env';
import { TimeoutError } from '@server/core/timeout';
import type { ModelResponse } from './types';

/** Max wall-clock time allowed for a single Workers-AI call. */
const CLOUDFLARE_TIMEOUT_MS = 120_000;
const CLOUDFLARE_MAX_RETRIES = 0;
const CLOUDFLARE_MAX_OUTPUT_TOKENS = 4096;

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

function extractCloudflareText(result: unknown, model: string): string {
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
  if (finishReason) {
    throw new Error(`Cloudflare model ${model} returned no review content (finish_reason=${finishReason}).`);
  }
  if (isText(message?.reasoning) || isText(message?.reasoning_content)) {
    throw new Error(`Cloudflare model ${model} returned reasoning without review content.`);
  }

  throw new Error(`Cloudflare model ${model} returned an empty response.`);
}

function extractCloudflareUsage(result: unknown) {
  const usage = getRecord(result, 'usage') ?? getRecord(getRecord(result, 'result'), 'usage');
  return {
    inputTokens: getNumber(usage, 'prompt_tokens') ?? 0,
    outputTokens: getNumber(usage, 'completion_tokens') ?? 0,
  };
}

export async function reviewWithCloudflare(
  env: Pick<AppBindings, 'AI'>,
  model: string,
  input: { systemPrompt: string; userPrompt: string },
  tracker?: { incrementSubrequests(count?: number): void },
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
        env.AI.run(model as any, {
          messages: [
            { role: 'system', content: input.systemPrompt },
            { role: 'user', content: input.userPrompt },
          ],
          max_completion_tokens: CLOUDFLARE_MAX_OUTPUT_TOKENS,
          temperature: 0,
        }),
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
        provider: 'cloudflare',
      };
    } catch (error) {
      lastError = error;
      const errorMsg = error instanceof Error ? error.message : String(error);
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
