import { logger } from '@server/core/logger';
import { runGuardianInference } from '@server/core/guardian-ai';
import { type ModelResponse, type StructuredSchema } from './types';
import { REVIEW_SCHEMA } from './schemas';

const ANTHROPIC_MAX_OUTPUT_TOKENS = 4096;

export interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string; input?: Record<string, unknown> }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/**
 * Runs an Anthropic-format review through core-guardian's AI router.
 *
 * Builds the native `/v1/messages` tool-use body and hands it to guardian
 * (which injects the model + account key and meters the call). Response parsing
 * — pulling the structured JSON out of the forced tool_use block — is unchanged
 * from the direct-call era; only the transport moved to guardian.
 */
export async function reviewWithAnthropic(
  env: Env,
  model: string,
  input: { systemPrompt: string; userPrompt: string },
  tracker?: { incrementSubrequests(count?: number): void },
  schema: StructuredSchema = REVIEW_SCHEMA,
  cachePrefixes?: { system?: boolean },
): Promise<ModelResponse> {
  logger.info(`Calling Anthropic model via core-guardian: ${model}`);

  const system = cachePrefixes?.system
    ? [{ type: 'text', text: input.systemPrompt, cache_control: { type: 'ephemeral' } }]
    : input.systemPrompt;

  const result = await runGuardianInference(env, 'anthropic', model, {
    system,
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
  }, { tracker });

  const data = result.body as AnthropicResponse;

  // Extract the tool_use result — the structured JSON is in the `input` field.
  const toolBlock = data.content?.find((block) => block.type === 'tool_use');
  let rawText: string;

  if (toolBlock?.input) {
    rawText = JSON.stringify(toolBlock.input);
  } else {
    // Fallback: extract text content if tool_use failed (shouldn't happen with tool_choice).
    rawText = Array.isArray(data.content)
      ? data.content.map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim()
      : '';
  }

  if (!rawText) {
    throw new Error('Anthropic provider returned an empty response.');
  }

  return {
    rawText,
    inputTokens: result.tokensIn || data?.usage?.input_tokens || 0,
    outputTokens: result.tokensOut || data?.usage?.output_tokens || 0,
    cacheReadTokens: data?.usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: data?.usage?.cache_creation_input_tokens ?? 0,
    modelUsed: model,
    provider: 'anthropic',
  };
}
