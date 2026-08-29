import { logger } from '@server/core/logger';
import { runGuardianInference } from '@server/core/guardian-ai';
import { type ModelResponse, type StructuredSchema } from './types';
import { REVIEW_SCHEMA } from './schemas';

const OPENAI_MAX_OUTPUT_TOKENS = 4096;

export interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>;
    };
  }>;
  output_text?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
}

function extractOpenAiText(data: OpenAIResponse) {
  const messageContent = data?.choices?.[0]?.message?.content;
  if (typeof messageContent === 'string') return messageContent.trim();
  if (Array.isArray(messageContent)) {
    return messageContent.map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim();
  }
  const outputText = data?.output_text;
  if (typeof outputText === 'string') return outputText.trim();
  return '';
}

/**
 * Runs an OpenAI-format review through core-guardian's AI router.
 *
 * Codra no longer talks to OpenAI (or the raw AI Gateway) directly: this builds
 * the native chat-completions body and hands it to guardian, which injects the
 * model, applies the account API key, meters the spend against the `codra`
 * project budget, and returns the provider's native response as `body`. The
 * request-body shape and response parsing are unchanged from the direct-call
 * era — only the transport moved.
 */
export async function reviewWithOpenAI(
  env: Env,
  model: string,
  input: { systemPrompt: string; userPrompt: string },
  tracker?: { incrementSubrequests(count?: number): void },
  schema: StructuredSchema = REVIEW_SCHEMA,
): Promise<ModelResponse> {
  logger.info(`Calling OpenAI-format model via core-guardian: ${model}`);

  const result = await runGuardianInference(env, 'openai', model, {
    // `model` is injected by guardian — pass only the body.
    messages: [
      {
        role: 'system',
        content: `${input.systemPrompt}\n\nReturn only the JSON object. Do not include chain-of-thought, analysis, markdown, code fences, or explanatory prose.`,
      },
      { role: 'user', content: `${input.userPrompt}\n\nRespond with the required JSON object only.` },
    ],
    temperature: 0,
    max_tokens: OPENAI_MAX_OUTPUT_TOKENS,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: schema.name,
        strict: true,
        schema: schema.schema,
      },
    },
  }, { tracker });

  const data = result.body as OpenAIResponse;
  const rawText = extractOpenAiText(data);
  if (!rawText) {
    throw new Error('OpenAI provider returned an empty response.');
  }

  return {
    rawText,
    // Prefer guardian's authoritative metering; fall back to the body usage.
    inputTokens: result.tokensIn || data?.usage?.prompt_tokens || data?.usage?.input_tokens || 0,
    outputTokens: result.tokensOut || data?.usage?.completion_tokens || data?.usage?.output_tokens || 0,
    modelUsed: model,
    provider: 'openai',
  };
}
