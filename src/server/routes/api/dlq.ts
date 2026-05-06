import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '@server/env';
import { jsonError } from '@server/core/http';
import { logger } from '@server/core/logger';

/**
 * Cloudflare Queues HTTP Pull API – DLQ bindings.
 *
 * The DLQ is a standard Cloudflare Queue named "codra-review-dlq".
 * Because it is a pull queue (no Worker consumer), we interact with it via
 * the Cloudflare REST API using the account-level API token.
 *
 * Endpoints surfaced here:
 *   GET  /api/dlq          – List pending DLQ messages (pull without acking)
 *   POST /api/dlq/:id/replay – Ack a DLQ message and re-enqueue its body on
 *                              the main REVIEW_QUEUE for a fresh attempt.
 *   POST /api/dlq/purge    – Ack all current DLQ messages (discard).
 *
 * Note: Cloudflare's pull-queue API requires a CF_API_TOKEN with
 *       Queues:Edit permissions. Add CF_API_TOKEN and CF_ACCOUNT_ID as
 *       Worker secrets (see .dev.vars.example).
 */

const CF_QUEUES_BASE = 'https://api.cloudflare.com/client/v4';

/** Shape returned by the CF Queues pull endpoint. */
type CfQueueMessage = {
  lease_id: string;
  body: unknown;
  metadata: {
    attempts: number;
    timestamp: string;
  };
};

/** Tiny wrapper around the CF Queues pull-consumer HTTP API. */
async function cfQueuesRequest(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  apiToken: string,
  body?: unknown,
): Promise<unknown> {
  const url = `${CF_QUEUES_BASE}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = (await response.json()) as { success: boolean; result?: unknown; errors?: unknown[] };

  if (!response.ok || !data.success) {
    throw new Error(`Cloudflare Queues API error (${response.status}): ${JSON.stringify(data.errors)}`);
  }

  return data.result;
}

export function createDlqRouter() {
  const app = new Hono<AppEnv>();

  /**
   * GET /api/dlq
   * Pull up to `limit` messages from the DLQ without acking them.
   * The response includes lease IDs needed for later replay/purge operations.
   */
  app.get('/', async (c) => {
    const { limit = '20' } = c.req.query();
    const batchSize = Math.min(Number(limit) || 20, 100);

    const apiToken = c.env.CF_API_TOKEN;
    const accountId = c.env.CF_ACCOUNT_ID;

    if (!apiToken || !accountId) {
      return jsonError('CF_API_TOKEN and CF_ACCOUNT_ID secrets are required for DLQ inspection.', 503);
    }

    try {
      const result = await cfQueuesRequest(
        'POST',
        `/accounts/${accountId}/queues/${c.env.CF_DLQ_ID}/messages/pull`,
        apiToken,
        { batch_size: batchSize, visibility_timeout_ms: 30_000 },
      ) as { messages?: CfQueueMessage[] };

      return c.json({
        messages: result.messages ?? [],
        count: (result.messages ?? []).length,
      });
    } catch (err) {
      logger.error('DLQ pull failed', err instanceof Error ? err : new Error(String(err)));
      return jsonError('Failed to pull DLQ messages.', 502);
    }
  });

  /**
   * POST /api/dlq/replay
   * Body: { lease_ids: string[] }
   *
   * Acknowledges the specified DLQ messages (removes them from the DLQ) and
   * re-enqueues their bodies on the main REVIEW_QUEUE so they get a fresh
   * processing attempt with the latest Worker code.
   *
   * If a message body is not a valid ReviewJobMessage it is discarded with a
   * warning rather than poisoning the main queue again.
   */
  app.post('/replay', async (c) => {
    const body = await z
      .object({ lease_ids: z.array(z.string()).min(1).max(100) })
      .safeParseAsync(await c.req.json());

    if (!body.success) {
      return jsonError('lease_ids must be a non-empty array of strings.', 400);
    }

    const apiToken = c.env.CF_API_TOKEN;
    const accountId = c.env.CF_ACCOUNT_ID;

    if (!apiToken || !accountId) {
      return jsonError('CF_API_TOKEN and CF_ACCOUNT_ID secrets are required for DLQ replay.', 503);
    }

    // Step 1 – pull the specific messages so we have their bodies.
    // CF does not expose a "get by lease_id" API; instead we pull a large
    // batch, filter by the requested lease IDs, then ack+replay.
    let pulled: CfQueueMessage[] = [];
    try {
      const result = await cfQueuesRequest(
        'POST',
        `/accounts/${accountId}/queues/${c.env.CF_DLQ_ID}/messages/pull`,
        apiToken,
        { batch_size: 100, visibility_timeout_ms: 60_000 },
      ) as { messages?: CfQueueMessage[] };
      pulled = result.messages ?? [];
    } catch (err) {
      logger.error('DLQ pull for replay failed', err instanceof Error ? err : new Error(String(err)));
      return jsonError('Failed to pull DLQ messages for replay.', 502);
    }

    const requested = new Set(body.data.lease_ids);
    const targets = pulled.filter((m) => requested.has(m.lease_id));
    const missing = body.data.lease_ids.filter((id) => !targets.find((m) => m.lease_id === id));

    if (targets.length === 0) {
      return jsonError('None of the requested lease IDs were found in the DLQ.', 404);
    }

    // Step 2 – ack (delete) the targeted messages from the DLQ.
    try {
      await cfQueuesRequest(
        'POST',
        `/accounts/${accountId}/queues/${c.env.CF_DLQ_ID}/messages/ack`,
        apiToken,
        { acks: targets.map((m) => ({ lease_id: m.lease_id })) },
      );
    } catch (err) {
      logger.error('DLQ ack for replay failed', err instanceof Error ? err : new Error(String(err)));
      return jsonError('Failed to ack DLQ messages before replay.', 502);
    }

    // Step 3 – re-enqueue bodies on the main queue.
    const replayed: string[] = [];
    const discarded: string[] = [];

    for (const msg of targets) {
      try {
        await c.env.REVIEW_QUEUE.send(msg.body as any);
        replayed.push(msg.lease_id);
        logger.info('DLQ message replayed', { leaseId: msg.lease_id });
      } catch (err) {
        discarded.push(msg.lease_id);
        logger.error('DLQ replay enqueue failed', { leaseId: msg.lease_id, error: String(err) });
      }
    }

    return c.json({
      replayed,
      discarded,
      missing,
      replayedCount: replayed.length,
    }, 202);
  });

  /**
   * POST /api/dlq/purge
   * Body: { lease_ids: string[] }
   *
   * Permanently discards the specified DLQ messages without replaying them.
   * Useful for clearing known-bad messages that can never succeed.
   */
  app.post('/purge', async (c) => {
    const body = await z
      .object({ lease_ids: z.array(z.string()).min(1).max(100) })
      .safeParseAsync(await c.req.json());

    if (!body.success) {
      return jsonError('lease_ids must be a non-empty array of strings.', 400);
    }

    const apiToken = c.env.CF_API_TOKEN;
    const accountId = c.env.CF_ACCOUNT_ID;

    if (!apiToken || !accountId) {
      return jsonError('CF_API_TOKEN and CF_ACCOUNT_ID secrets are required for DLQ purge.', 503);
    }

    try {
      await cfQueuesRequest(
        'POST',
        `/accounts/${accountId}/queues/${c.env.CF_DLQ_ID}/messages/ack`,
        apiToken,
        { acks: body.data.lease_ids.map((id) => ({ lease_id: id })) },
      );
    } catch (err) {
      logger.error('DLQ purge failed', err instanceof Error ? err : new Error(String(err)));
      return jsonError('Failed to purge DLQ messages.', 502);
    }

    return c.json({ purged: body.data.lease_ids.length });
  });

  return app;
}
