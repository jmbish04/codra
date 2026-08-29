import { logger } from '@server/core/logger';
import { runGuardianInference } from '@server/core/guardian-ai';
import { ProviderRequestError, type ModelResponse, type StructuredSchema } from './types';
import { REVIEW_SCHEMA } from './schemas';

/** Max output tokens for a single Workers-AI review. */
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

export function extractCloudflareText(
  result: unknown,
  model: string,
  opts: { throwOnNoContent?: boolean } = {},
): string {
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
  const reason = reasoning
    ? `reasoning-only response${finishReason ? `, finish_reason=${String(finishReason)}` : ''}`
    : finishReason
      ? `finish_reason=${String(finishReason)}`
      : 'empty response';

  // On the sync review path we'd rather fall back to another provider (e.g.
  // Gemini) than accept an inconclusive review. Throw a retryable error so the
  // model service moves to the next model in the chain.
  if (opts.throwOnNoContent) {
    throw new ProviderRequestError(model, 502, `returned no parseable review content (${reason})`, true);
  }

  return synthesizeInconclusiveReview(model, reason);
}

export function extractCloudflareUsage(result: unknown) {
  const usage = getRecord(result, 'usage') ?? getRecord(getRecord(result, 'result'), 'usage');
  return {
    inputTokens: getNumber(usage, 'prompt_tokens') ?? 0,
    outputTokens: getNumber(usage, 'completion_tokens') ?? 0,
  };
}

/** Chat payload for a single Workers-AI file review. */
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
 * Runs a Workers-AI (`@cf/...`) review through core-guardian.
 *
 * Codra no longer holds a Workers AI (`env.AI`) binding — that neuron spend is
 * the aggressive-billing exposure we removed. Guardian owns the AI binding and
 * proxies the call via its `workers-ai` gateway provider so the neuron spend is
 * attributed to the `codra` project and gated by the shared circuit breaker.
 * Request/response shapes are unchanged; only the transport moved.
 */
export async function reviewWithCloudflare(
  env: Env,
  model: string,
  input: { systemPrompt: string; userPrompt: string },
  tracker?: { incrementSubrequests(count?: number): void },
  providerName = 'workers-ai',
  schema: StructuredSchema = REVIEW_SCHEMA,
): Promise<ModelResponse> {
  logger.info(`Calling Cloudflare Workers-AI model via core-guardian: ${model}`);

  const result = await runGuardianInference(
    env,
    'cloudflare-workers-ai',
    model,
    buildCloudflareReviewRequest(input, schema),
    { tracker },
  );

  // Throw (→ fall back to the next model, e.g. Gemini) rather than accept a
  // reasoning-only / empty Workers-AI response as an inconclusive review.
  const rawText = extractCloudflareText(result.body, model, { throwOnNoContent: true });
  const usage = extractCloudflareUsage(result.body);

  return {
    rawText,
    inputTokens: result.tokensIn || usage.inputTokens,
    outputTokens: result.tokensOut || usage.outputTokens,
    modelUsed: model,
    provider: providerName,
  };
}
