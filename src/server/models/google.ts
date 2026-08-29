import { logger } from '@server/core/logger';
import { runGuardianInference } from '@server/core/guardian-ai';
import { type ModelResponse, type StructuredSchema } from './types';
import { REVIEW_SCHEMA } from './schemas';

const GEMINI_MAX_OUTPUT_TOKENS = 4096;

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

/**
 * Runs a Gemini (Google AI Studio) review through core-guardian's AI router.
 *
 * Builds the native `:generateContent` body and hands it to guardian, which
 * routes to the `google-ai-studio` gateway provider, injects the model + key,
 * and meters the spend. Retries/backoff are now guardian's concern (breaker +
 * router), so this module is transport-thin: build body, parse candidates.
 */
export async function reviewWithGoogle(
  env: Env,
  model: string,
  input: { systemPrompt: string; userPrompt: string },
  tracker?: { incrementSubrequests(count?: number): void },
  schema: StructuredSchema = REVIEW_SCHEMA,
): Promise<ModelResponse> {
  logger.info(`Calling Google model via core-guardian: ${model}`);

  const result = await runGuardianInference(env, 'gemini', model, {
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
      responseSchema: schema.schema,
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
    },
  }, { tracker });

  const data = result.body as GeminiResponse;
  const rawText = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('')?.trim();
  if (!rawText) {
    throw new Error('Gemini returned an empty response.');
  }

  return {
    rawText,
    inputTokens: result.tokensIn || data.usageMetadata?.promptTokenCount || 0,
    outputTokens: result.tokensOut || data.usageMetadata?.candidatesTokenCount || 0,
    modelUsed: model,
    provider: 'google-ai-studio',
  };
}
