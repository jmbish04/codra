import { describe, it, expect } from 'vitest';
import {
  recordWebhookDelivery,
  finalizeWebhookDelivery,
  getWebhookDeliveryRow,
  listWebhookDeliveries,
  getWebhookDeliveryById,
} from '@server/db/webhook-deliveries';
import { createTestEnv } from './helpers';

describe('webhook delivery recording', () => {
  it('records, finalizes, lists, and filters by outcome', async () => {
    const env = createTestEnv();

    await recordWebhookDelivery(env, { deliveryId: 'd1', eventName: 'pull_request', payload: '{}' });
    await finalizeWebhookDelivery(env, 'd1', { outcome: 'job_created', action: 'review', prNumber: 42, jobId: 'job-1' });

    await recordWebhookDelivery(env, { deliveryId: 'd2', eventName: 'pull_request', payload: '{}' });
    await finalizeWebhookDelivery(env, 'd2', { outcome: 'rejected_signature' });

    const row = await getWebhookDeliveryRow(env, 'd1');
    expect(row?.outcome).toBe('job_created');
    expect(row?.pr_number).toBe(42);
    expect(row?.job_id).toBe('job-1');
    expect(row?.action).toBe('review');

    const all = await listWebhookDeliveries(env, { limit: 50, offset: 0 });
    expect(all.total).toBe(2);

    const onlyJobs = await listWebhookDeliveries(env, { outcome: 'job_created', limit: 50, offset: 0 });
    expect(onlyJobs.items).toHaveLength(1);
    expect(onlyJobs.items[0].outcome).toBe('job_created');
  });

  it('recording is idempotent per delivery id (returns false on duplicate)', async () => {
    const env = createTestEnv();
    const first = await recordWebhookDelivery(env, { deliveryId: 'dup', eventName: 'push', payload: '{}' });
    const second = await recordWebhookDelivery(env, { deliveryId: 'dup', eventName: 'push', payload: '{}' });
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('detail lookup by id parses the stored payload', async () => {
    const env = createTestEnv();
    await recordWebhookDelivery(env, { deliveryId: 'd3', eventName: 'pull_request', payload: JSON.stringify({ hello: 'world' }) });
    await finalizeWebhookDelivery(env, 'd3', { outcome: 'no_action' });

    const list = await listWebhookDeliveries(env, { limit: 1, offset: 0 });
    const id = list.items[0].id;
    const detail = await getWebhookDeliveryById(env, id);
    expect(detail?.outcome).toBe('no_action');
    expect(detail?.payload).toEqual({ hello: 'world' });
  });
});
