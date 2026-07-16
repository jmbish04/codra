import { logger } from '@server/core/logger';
import { buildCloudflareReviewRequest, cloudflareAiOptions, extractCloudflareText, extractCloudflareUsage } from './cloudflare';

/**
 * Workers AI models that support the asynchronous Batch API. Verified against
 * the model catalog (a model is batch-capable when it publishes a
 * batch-input.json schema). Kept explicit rather than probed at runtime.
 * https://developers.cloudflare.com/workers-ai/features/batch-api/
 */
export const BATCH_CAPABLE_CLOUDFLARE_MODELS = new Set([
  '@cf/moonshotai/kimi-k2.7-code',
  '@cf/zai-org/glm-5.2',
  '@cf/moonshotai/kimi-k2.6',
  '@cf/moonshotai/kimi-k2.5',
]);

/** Batch payloads must stay under 10 MB; leave headroom for envelope overhead. */
const BATCH_PAYLOAD_LIMIT_BYTES = 9_000_000;

export function isBatchCapableCloudflareModel(model: string) {
  return BATCH_CAPABLE_CLOUDFLARE_MODELS.has(model);
}

export type BatchReviewItem = { systemPrompt: string; userPrompt: string };

export type BatchPollResult =
  | { status: 'pending' }
  | {
      status: 'complete';
      responses: Array<{ index: number; rawText: string | null; error: string | null }>;
      /** Batch usage is reported once for the whole batch, not per response. */
      usage: { inputTokens: number; outputTokens: number };
    };

/**
 * Returns true when the batch fits under the documented 10 MB payload cap.
 * Callers fall back to the synchronous path when it does not.
 */
export function batchFitsPayloadLimit(items: BatchReviewItem[]) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ requests: items.map((item) => buildCloudflareReviewRequest(item)) }),
  ).byteLength;
  return { fits: bytes <= BATCH_PAYLOAD_LIMIT_BYTES, bytes };
}

/**
 * Submits every file review as one queued batch. Returns the request_id used to
 * poll for results later. Responses come back keyed by their index in `items`.
 */
export async function submitCloudflareReviewBatch(
  env: Pick<Env, 'AI' | 'AI_GATEWAY_ID'>,
  model: string,
  items: BatchReviewItem[],
): Promise<string> {
  const response = await env.AI.run(
    model as any,
    { requests: items.map((item) => buildCloudflareReviewRequest(item)) } as any,
    { ...cloudflareAiOptions(env), queueRequest: true } as any,
  );

  const requestId = (response as { request_id?: string })?.request_id;
  if (!requestId) {
    throw new Error(`Cloudflare batch submit for ${model} returned no request_id`);
  }

  logger.info(`Submitted Workers AI batch for ${model}`, { requestId, requests: items.length });
  return requestId;
}

/**
 * Polls a queued batch. While the batch is `queued`/`running` the API returns a
 * status only; on completion it returns `responses[]`, each identified by an
 * `id` that maps to the index of the prompt in the original request.
 */
export async function pollCloudflareReviewBatch(
  env: Pick<Env, 'AI' | 'AI_GATEWAY_ID'>,
  model: string,
  requestId: string,
): Promise<BatchPollResult> {
  const result = await env.AI.run(model as any, { request_id: requestId } as any, cloudflareAiOptions(env));

  const status = (result as { status?: string })?.status;
  if (status === 'queued' || status === 'running') {
    return { status: 'pending' };
  }

  const rawResponses = (result as { responses?: unknown })?.responses;
  if (!Array.isArray(rawResponses)) {
    throw new Error(`Cloudflare batch ${requestId} returned no responses array (status=${status ?? 'unknown'})`);
  }

  const responses = rawResponses.map((entry: any, position: number) => {
    // `id` maps to the index of the prompt in the original request; fall back to
    // array position if the provider omits it.
    const index = typeof entry?.id === 'number' ? entry.id : position;

    if (entry?.success === false) {
      const error = typeof entry?.error === 'string' ? entry.error : JSON.stringify(entry?.error ?? 'unknown batch error');
      return { index, rawText: null, error };
    }

    try {
      return { index, rawText: extractCloudflareText(entry?.result ?? entry, model), error: null };
    } catch (error) {
      return { index, rawText: null, error: error instanceof Error ? error.message : String(error) };
    }
  });

  return { status: 'complete', responses, usage: extractCloudflareUsage(result) };
}
