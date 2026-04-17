import { logger } from '@server/core/logger';
import type { AppBindings } from '@server/env';
import { withTimeout } from '@server/core/timeout';
import type { ModelResponse } from './types';

/** Max wall-clock time allowed for a single Google AI Studio call (60 s). */
const GOOGLE_TIMEOUT_MS = 60_000;

export async function reviewWithGoogle(
  env: Pick<AppBindings, 'GEMINI_API_KEY'>,
  model: string,
  input: { systemPrompt: string; userPrompt: string },
): Promise<ModelResponse> {
  logger.info(`Calling Google AI model: ${model}`);
  const startTime = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

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
          maxOutputTokens: 4096,
        },
      }),
    }),
  );

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`Google request failed with ${response.status}`, { error: errorText });
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
}
