import { buildCloudflareReviewRequest } from './cloudflare';

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

// NOTE: `submitCloudflareReviewBatch` / `pollCloudflareReviewBatch` were removed
// with the core-guardian migration — the Workers AI async Batch API needs a
// local `env.AI` binding, which Codra dropped (all inference now flows through
// core-guardian, which has no batch proxy). The pure helpers above are retained
// for their unit tests and for a future guardian-side batch proxy.
