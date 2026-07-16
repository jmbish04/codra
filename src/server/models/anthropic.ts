import { logger } from '@server/core/logger';
import { withTimeout } from '@server/core/timeout';
import { ProviderRequestError, providerErrorMessage, type ModelResponse, type StructuredSchema } from './types';
import { REVIEW_SCHEMA } from './schemas';

const ANTHROPIC_TIMEOUT_MS = 180_000;
const ANTHROPIC_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

export interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string; input?: Record<string, unknown> }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export async function reviewWithAnthropic(
  config: { apiKey: string; baseUrl?: string | null; providerName: string },
  model: string,
  input: { systemPrompt: string; userPrompt: string },
  tracker?: { incrementSubrequests(count?: number): void },
  schema: StructuredSchema = REVIEW_SCHEMA,
): Promise<ModelResponse> {
  logger.info(`Calling Anthropic model: ${model}`);
  const baseUrl = (config.baseUrl || DEFAULT_ANTHROPIC_BASE_URL).replace(/\/+$/, '');

  if (tracker) tracker.incrementSubrequests(1);
  const response = await withTimeout('Anthropic API', ANTHROPIC_TIMEOUT_MS, (signal) =>
    fetch(`${baseUrl}/messages`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        system: input.systemPrompt,
        messages: [
          { role: 'user', content: `${input.userPrompt}\n\nUse the ${schema.name} tool to return your structured result.` },
        ],
        tools: [
          {
            name: schema.name,
            description: schema.description ?? 'Submit the structured result.',
            input_schema: schema.schema,
          },
        ],
        tool_choice: { type: 'tool', name: schema.name },
        max_tokens: ANTHROPIC_MAX_OUTPUT_TOKENS,
        temperature: 0,
      }),
    }),
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new ProviderRequestError(config.providerName, response.status, providerErrorMessage(errorText));
  }

  const data = (await response.json()) as AnthropicResponse;

  // Extract the tool_use result — the structured JSON is in the `input` field
  const toolBlock = data.content?.find((block) => block.type === 'tool_use');
  let rawText: string;

  if (toolBlock?.input) {
    rawText = JSON.stringify(toolBlock.input);
  } else {
    // Fallback: extract text content if tool_use failed (shouldn't happen with tool_choice)
    rawText = Array.isArray(data.content)
      ? data.content.map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim()
      : '';
  }

  if (!rawText) {
    throw new Error('Anthropic provider returned an empty response.');
  }

  return {
    rawText,
    inputTokens: data?.usage?.input_tokens ?? 0,
    outputTokens: data?.usage?.output_tokens ?? 0,
    modelUsed: model,
    provider: config.providerName,
  };
}

