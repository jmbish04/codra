import { logger } from '@server/core/logger';
import { withTimeout } from '@server/core/timeout';
import { ProviderRequestError, providerErrorMessage, type ModelResponse } from './types';
import { REVIEW_RESPONSE_SCHEMA } from './schemas';

/** Max wall-clock time allowed for a single Google AI Studio call. */
const GEMINI_TIMEOUT_MS = 180_000;
const GEMINI_MAX_RETRIES = 1;
const GEMINI_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

function isRetryableGeminiStatus(status: number) {
  return status === 408 || status === 500 || status === 502 || status === 503 || status === 504 || status === 524;
}

function isPrivateIP(hostname: string) {
  const privateRanges = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^localhost$/,
    /^::1$/,
  ];
  return privateRanges.some((regex) => regex.test(hostname));
}

function isValidPublicUrl(urlString: string) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const hostname = url.hostname;
    if (hostname === 'metadata.google.internal' || hostname === '100.100.100.200') return false;
    if (isPrivateIP(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function reviewWithGoogle(
  config: { apiKey: string; baseUrl?: string | null; providerName?: string },
  model: string,
  input: { systemPrompt: string; userPrompt: string },
  tracker?: { incrementSubrequests(count?: number): void },
): Promise<ModelResponse> {
  logger.info(`Calling Google model: ${model}`);
  
  if (config.baseUrl && !isValidPublicUrl(config.baseUrl)) {
    throw new ProviderRequestError(config.providerName ?? 'Google', 400, 'Invalid provider base URL.');
  }

  const startTime = Date.now();
  const baseUrl = (config.baseUrl || DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, '');
  const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
  const maxRetries = GEMINI_MAX_RETRIES;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (tracker) tracker.incrementSubrequests(1);
      if (attempt > 0) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        logger.info(`Retrying Gemini request (attempt ${attempt}/${maxRetries}) in ${Math.round(delay)}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const response = await withTimeout('Gemini API', GEMINI_TIMEOUT_MS, (signal) =>
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
              responseSchema: REVIEW_RESPONSE_SCHEMA,
              maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
            },
          }),
        }),
      );

      if (!response.ok) {
        const errorText = await response.text();
        const message = providerErrorMessage(errorText);
        const isRetryable = isRetryableGeminiStatus(response.status);

        const logData = {
          error: message,
          attempt,
          willRetry: isRetryable && attempt < maxRetries,
        };
        if (isRetryable && attempt < maxRetries) {
          logger.warn(`Gemini request failed with ${response.status}; retrying`, logData);
          lastError = new ProviderRequestError(config.providerName ?? 'Google', response.status, message);
          continue;
        }

        logger.error(`Gemini request failed with ${response.status}`, logData);
        throw new ProviderRequestError(config.providerName ?? 'Google', response.status, message);
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
        throw new Error('Gemini returned an empty response.');
      }

      return {
        rawText,
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        modelUsed: model,
        provider: config.providerName ?? 'Google',
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
