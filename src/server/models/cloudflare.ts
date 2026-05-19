import { logger } from '@server/core/logger';
import type { AppBindings } from '@server/env';
import { TimeoutError } from '@server/core/timeout';
import type { ModelResponse } from './types';

/** Max wall-clock time allowed for a single Workers-AI call. */
const CLOUDFLARE_TIMEOUT_MS = 45_000;
const CLOUDFLARE_MAX_RETRIES = 1;

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function extractMessageContent(content: unknown): string | null {
  if (isText(content)) return content.trim();

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (isText(part)) return part;
        if (part && typeof part === 'object' && isText((part as any).text)) return (part as any).text;
        return '';
      })
      .join('')
      .trim();
    return text || null;
  }

  return null;
}

function extractCloudflareText(result: any, model: string): string {
  if (isText(result)) return result.trim();
  if (isText(result?.response)) return result.response.trim();
  if (isText(result?.result?.response)) return result.result.response.trim();

  const choice = result?.choices?.[0];
  const content = extractMessageContent(choice?.message?.content);
  if (content) return content;

  const finishReason = choice?.finish_reason ?? choice?.stop_reason;
  if (finishReason) {
    throw new Error(`Cloudflare model ${model} returned no review content (finish_reason=${finishReason}).`);
  }
  if (isText(choice?.message?.reasoning) || isText(choice?.message?.reasoning_content)) {
    throw new Error(`Cloudflare model ${model} returned reasoning without review content.`);
  }

  throw new Error(`Cloudflare model ${model} returned an empty response.`);
}

export async function reviewWithCloudflare(
  env: Pick<AppBindings, 'AI'>,
  model: string,
  input: { systemPrompt: string; userPrompt: string },
  tracker?: { incrementSubrequests(count?: number): void },
): Promise<ModelResponse> {
  const maxRetries = CLOUDFLARE_MAX_RETRIES;
  let lastError: any;

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
          max_completion_tokens: 4096,
          temperature: 0,
        }),
        timeoutPromise,
      ]);
      const durationMs = Date.now() - startTime;
      logger.info(`AI model ${model} responded in ${durationMs}ms`);

      const rawText = extractCloudflareText(result, model);

      return {
        rawText,
        inputTokens: result?.usage?.prompt_tokens ?? result?.result?.usage?.prompt_tokens ?? 0,
        outputTokens: result?.usage?.completion_tokens ?? result?.result?.usage?.completion_tokens ?? 0,
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
