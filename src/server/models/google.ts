import { logger } from '@server/core/logger';
import type { AppBindings } from '@server/env';
import { withTimeout } from '@server/core/timeout';
import type { ModelResponse } from './types';

/** Max wall-clock time allowed for a single Google AI Studio call. */
const GOOGLE_TIMEOUT_MS = 30_000;
const GOOGLE_MAX_RETRIES = 0;
const GOOGLE_MAX_OUTPUT_TOKENS = 3072;

export async function reviewWithGoogle(
  env: Pick<AppBindings, 'GEMINI_API_KEY'>,
  model: string,
  input: { systemPrompt: string; userPrompt: string },
  tracker?: { incrementSubrequests(count?: number): void },
): Promise<ModelResponse> {
  logger.info(`Calling Google AI model: ${model}`);
  const startTime = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const maxRetries = GOOGLE_MAX_RETRIES;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (tracker) tracker.incrementSubrequests(1);
      if (attempt > 0) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        logger.info(`Retrying Google request (attempt ${attempt}/${maxRetries}) in ${Math.round(delay)}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const response = await withTimeout('Google API', GOOGLE_TIMEOUT_MS, (signal) =>
        fetch(url, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: input.systemPrompt }],
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: input.userPrompt }],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              maxOutputTokens: GOOGLE_MAX_OUTPUT_TOKENS,
            },
          }),
        }),
      );

      if (!response.ok) {
        const errorText = await response.text();
        const isRateLimit = response.status === 429;
        const isRetryable = !isRateLimit && response.status >= 500;

        logger.error(`Google request failed with ${response.status}`, {
          error: errorText,
          attempt,
          willRetry: isRetryable && attempt < maxRetries
        });

        if (isRateLimit) {
          throw new Error(`Google request failed with ${response.status}: ${errorText}`);
        }

        if (isRetryable && attempt < maxRetries) {
          lastError = new Error(`Google request failed with ${response.status}: ${errorText}`);
          continue;
        }
        throw new Error(`Google request failed with ${response.status}: ${errorText}`);
      }

      const durationMs = Date.now() - startTime;
      logger.info(`AI model ${model} responded in ${durationMs}ms`);

      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
        };
      };

      const rawText = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('')?.trim();
      if (!rawText) {
        throw new Error('Google returned an empty response.');
      }

      return {
        rawText,
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        modelUsed: model,
        provider: 'google',
      };
    } catch (error) {
      lastError = error;
      const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.message.includes('timeout'));
      if (isTimeout && attempt < maxRetries) {
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}
