import { logger } from '@server/core/logger';
import { withTimeout } from '@server/core/timeout';
import { ProviderRequestError, providerErrorMessage, type ModelResponse, type StructuredSchema } from './types';
import { REVIEW_SCHEMA } from './schemas';

/**
 * Google Antigravity managed agent, via the Gemini Interactions API.
 *
 * Unlike generateContent, interactions run an agentic loop inside a Google-hosted
 * sandbox, so there is no responseSchema / temperature knob: the JSON contract is
 * stated in the prompt and repaired downstream like every other provider response.
 * See https://ai.google.dev/gemini-api/docs/antigravity-agent
 */
const ANTIGRAVITY_TIMEOUT_MS = 600_000;
const ANTIGRAVITY_POLL_INTERVAL_MS = 5_000;
const DEFAULT_ANTIGRAVITY_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export const ANTIGRAVITY_MODELS = ['antigravity-preview-05-2026'];

export type Interaction = {
  id?: string;
  status?: string;
  output_text?: string;
  error?: { message?: string };
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
};

export type AntigravityConfig = { apiKey: string; baseUrl?: string | null; providerName?: string };

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function resolveBaseUrl(config: AntigravityConfig) {
  return (config.baseUrl || DEFAULT_ANTIGRAVITY_BASE_URL).replace(/\/+$/, '');
}

function authHeaders(config: AntigravityConfig) {
  return { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey };
}

/**
 * Wraps a review request in the JSON contract. Interactions run an agentic loop
 * rather than a single generateContent call, so there is no responseSchema knob:
 * the schema is stated in the prompt and repaired downstream like every other
 * provider response.
 */
export function buildAntigravityPrompt(
  input: { systemPrompt: string; userPrompt: string },
  schema: StructuredSchema = REVIEW_SCHEMA,
) {
  return [
    input.systemPrompt,
    '',
    input.userPrompt,
    '',
    'Reply with a single JSON object and nothing else. It must validate against this JSON Schema:',
    JSON.stringify(schema.schema),
  ].join('\n');
}

/**
 * Starts a background interaction and returns immediately. When `webhookUri` is
 * set, Gemini POSTs `interaction.completed` / `interaction.failed` to it, so the
 * caller never has to poll.
 * https://ai.google.dev/gemini-api/docs/interactions/webhooks
 */
export async function submitAntigravityInteraction(
  config: AntigravityConfig,
  model: string,
  prompt: string,
  options: { webhookUri?: string | null; userMetadata?: Record<string, string> } = {},
  tracker?: { incrementSubrequests(count?: number): void },
): Promise<Interaction> {
  const provider = config.providerName ?? 'Antigravity';
  if (tracker) tracker.incrementSubrequests(1);

  const response = await withTimeout('Antigravity submit', 60_000, (signal) =>
    fetch(`${resolveBaseUrl(config)}/interactions`, {
      method: 'POST',
      signal,
      headers: authHeaders(config),
      body: JSON.stringify({
        // `model` here is the managed agent id, not a generateContent model.
        agent: model,
        input: prompt,
        environment: 'remote',
        background: true,
        store: true,
        ...(options.webhookUri
          ? { webhook_config: { uris: [options.webhookUri], user_metadata: options.userMetadata ?? {} } }
          : {}),
      }),
    }),
  );

  if (!response.ok) {
    const message = providerErrorMessage(await response.text());
    logger.error(`Antigravity submit failed with ${response.status}`, { error: message });
    throw new ProviderRequestError(provider, response.status, message);
  }

  return (await response.json()) as Interaction;
}

/** Authoritative read of an interaction. Webhooks are only a nudge to call this. */
export async function fetchAntigravityInteraction(
  config: AntigravityConfig,
  interactionId: string,
  tracker?: { incrementSubrequests(count?: number): void },
): Promise<Interaction> {
  const provider = config.providerName ?? 'Antigravity';
  if (tracker) tracker.incrementSubrequests(1);

  const url = `${resolveBaseUrl(config)}/interactions/${encodeURIComponent(interactionId)}`;
  const response = await withTimeout('Antigravity get', 60_000, (signal) =>
    fetch(url, { signal, headers: authHeaders(config) }),
  );

  if (!response.ok) {
    const message = providerErrorMessage(await response.text());
    throw new ProviderRequestError(provider, response.status, message);
  }

  return (await response.json()) as Interaction;
}

export async function reviewWithAntigravity(
  config: { apiKey: string; baseUrl?: string | null; providerName?: string },
  model: string,
  input: { systemPrompt: string; userPrompt: string },
  tracker?: { incrementSubrequests(count?: number): void },
  schema: StructuredSchema = REVIEW_SCHEMA,
): Promise<ModelResponse> {
  const provider = config.providerName ?? 'Antigravity';
  const startTime = Date.now();

  logger.info(`Calling Antigravity managed agent: ${model}`);

  let interaction = await submitAntigravityInteraction(
    config,
    model,
    buildAntigravityPrompt(input, schema),
    {},
    tracker,
  );

  // No webhook target here, so settle the interaction by polling. The
  // webhook-driven path in core/review.ts avoids this wait entirely.
  while (interaction.status === 'in_progress' || interaction.status === 'queued') {
    if (Date.now() - startTime > ANTIGRAVITY_TIMEOUT_MS) {
      throw new ProviderRequestError(provider, 504, 'Antigravity interaction did not finish in time.');
    }
    if (!interaction.id) {
      throw new ProviderRequestError(provider, 502, 'Antigravity returned an in-progress interaction without an id.');
    }

    await new Promise((resolve) => setTimeout(resolve, ANTIGRAVITY_POLL_INTERVAL_MS));
    try {
      interaction = await fetchAntigravityInteraction(config, interaction.id, tracker);
    } catch (error) {
      if (error instanceof ProviderRequestError && isRetryableStatus(error.status)) {
        logger.warn(`Antigravity poll failed with ${error.status}; retrying`, { error: error.message });
        continue;
      }
      throw error;
    }
  }

  if (interaction.status && interaction.status !== 'completed') {
    throw new ProviderRequestError(
      provider,
      502,
      interaction.error?.message ?? `Antigravity interaction ended with status ${interaction.status}.`,
    );
  }

  const rawText = interaction.output_text?.trim();
  if (!rawText) {
    throw new Error('Antigravity returned an empty response.');
  }

  logger.info(`AI model ${model} responded in ${Date.now() - startTime}ms`);

  return {
    rawText,
    inputTokens: interaction.usage?.input_tokens ?? 0,
    outputTokens: interaction.usage?.output_tokens ?? interaction.usage?.total_tokens ?? 0,
    modelUsed: model,
    provider,
  };
}
