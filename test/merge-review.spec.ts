import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { createAgentRouter } from '@server/routes/api/agent';
import { reviewReconciliation } from '@server/services/merge-review';
import { countReviewAttempts, listReviews } from '@server/db/reconciliation-reviews';
import { createTestEnv } from './helpers';

const KEY = 'test-webhook-secret';
const authed = { 'X-API-Key': KEY, 'content-type': 'application/json' } as const;

// The stubbed Workers AI REST call returns a non-verdict body, so parseReviewVerdict
// defaults to not-satisfied — i.e. codra does NOT approve unless a real Kimi says so.
// That makes the reject + circuit-breaker paths deterministic to test.
describe('merge-review gate', () => {
  let env: Env;
  beforeEach(() => {
    env = createTestEnv();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({ result: { response: 'no verdict here', usage: { prompt_tokens: 1, completion_tokens: 1 } }, success: true }),
        { status: 200 },
      ),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('records each attempt and trips the circuit breaker after the cap', async () => {
    const base = { repositoryId: 1, repository: 'acme/widgets', reconciliationKey: 'reconcile/batch-1', summary: 'staged reconciliation diff' };
    const r1 = await reviewReconciliation(env, base);
    expect(r1).toMatchObject({ approved: false, attempt: 1 });
    await reviewReconciliation(env, base);
    await reviewReconciliation(env, base);
    expect(await countReviewAttempts(env, base.reconciliationKey)).toBe(3);

    // 4th call: circuit breaker, no model call
    const tripped = await reviewReconciliation(env, base);
    expect(tripped).toMatchObject({ approved: false, reason: 'max_attempts' });
    const reviews = await listReviews(env, base.reconciliationKey);
    expect(reviews[0].feedback).toContain('circuit breaker');
  });

  it('exposes the gate over the key-guarded endpoint', async () => {
    const app = new Hono<AppEnv>();
    app.route('/api/agent', createAgentRouter());

    const unauth = await app.request('/api/agent/merge-review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, env);
    expect(unauth.status).toBe(401);

    const bad = await app.request('/api/agent/merge-review', { method: 'POST', headers: authed, body: JSON.stringify({ repositoryId: 1 }) }, env);
    expect(bad.status).toBe(400);

    const ok = await app.request('/api/agent/merge-review', {
      method: 'POST', headers: authed,
      body: JSON.stringify({ repositoryId: 1, repository: 'acme/widgets', reconciliationKey: 'k1', summary: 'diff' }),
    }, env);
    expect(ok.status).toBe(200);
    expect((await ok.json() as any)).toHaveProperty('approved');
  });
});
