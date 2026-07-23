import type { Context } from 'hono';
import type { AppEnv } from '@server/env';
import { logger } from '@server/core/logger';
import { isStaleWebhookTimestamp, verifyGeminiWebhookSignature } from '@server/core/gemini-webhook';
import {
  countOutstandingAntigravityInteractions,
  getAntigravityInteraction,
  recordGeminiWebhookEvent,
  settleAntigravityInteraction,
} from '@server/db/gemini-webhooks';
import { getJobForProcessing, mapJob } from '@server/db/jobs';
import { isTerminalInteractionStatus } from '@server/core/review';
import { ModelService } from '@server/services/model';
import { jsonError } from '@server/core/http';

type GeminiWebhookBody = {
  type?: string;
  event_type?: string;
  data?: { id?: string };
  interaction?: { id?: string };
};

/**
 * Receives Gemini webhook deliveries (interaction.*, batch.*, video.generated).
 *
 * Every delivery is written to D1 verbatim before anything acts on it. The
 * payload itself is never trusted as a result: a matching interaction is
 * re-read from the API with our own key, and only then does the job advance.
 * https://ai.google.dev/gemini-api/docs/interactions/webhooks
 */
export async function handleGeminiWebhook(c: Context<AppEnv>) {
  const rawBody = await c.req.text();
  const webhookId = c.req.header('webhook-id');
  if (!webhookId) {
    return jsonError('Missing webhook-id header.', 400);
  }
  if (isStaleWebhookTimestamp(c.req.header('webhook-timestamp') ?? null)) {
    return jsonError('Webhook timestamp is outside the accepted window.', 400);
  }

  let body: GeminiWebhookBody;
  try {
    body = JSON.parse(rawBody) as GeminiWebhookBody;
  } catch {
    return jsonError('Invalid webhook JSON payload.', 400);
  }

  const verified = await verifyGeminiWebhookSignature(c.req.header('webhook-signature') ?? null);
  const eventType = body.type ?? body.event_type ?? 'unknown';
  const interactionId = body.data?.id ?? body.interaction?.id ?? null;

  const stored = await recordGeminiWebhookEvent(c.env, {
    webhookId,
    eventType,
    interactionId,
    signatureVerified: verified,
    payload: body,
  });

  if (!verified) {
    logger.warn('Rejected Gemini webhook with an unverified signature', { webhookId, eventType });
    return jsonError('Invalid webhook signature.', 401);
  }
  if (!stored) {
    return c.json({ ok: true, duplicate: true }, 202);
  }
  if (!interactionId || !eventType.startsWith('interaction.')) {
    return c.json({ ok: true, ignored: true, eventType }, 202);
  }

  const tracked = await getAntigravityInteraction(c.env, interactionId);
  if (!tracked) {
    return c.json({ ok: true, ignored: true, reason: 'untracked_interaction' }, 202);
  }

  const jobRow = await getJobForProcessing(c.env, tracked.job_id);
  const job = jobRow ? mapJob(jobRow) : null;
  if (!job?.batchModel) {
    logger.warn(`Gemini webhook for interaction ${interactionId} has no owning job model`);
    return c.json({ ok: true, ignored: true, reason: 'missing_job' }, 202);
  }

  try {
    const result = await new ModelService(c.env).fetchAntigravityResult(job.batchModel, interactionId);
    if (!isTerminalInteractionStatus(result.status)) {
      return c.json({ ok: true, pending: true }, 202);
    }
    await settleAntigravityInteraction(c.env, interactionId, result);
  } catch (error) {
    // Leave the row open; the safety-net re-enqueue reconciles it later.
    logger.error(`Failed to read Antigravity interaction ${interactionId}`, error);
    return c.json({ ok: true, deferred: true }, 202);
  }

  const outstanding = await countOutstandingAntigravityInteractions(c.env, tracked.job_id);
  if (outstanding === 0) {
    await c.env.REVIEW_QUEUE.send({
      jobId: tracked.job_id,
      deliveryId: webhookId,
      phase: 'review',
    });
  }

  return c.json({ ok: true, outstanding }, 202);
}
