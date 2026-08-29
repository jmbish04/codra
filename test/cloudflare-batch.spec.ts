import { afterEach, vi } from 'vitest';
import {
  batchFitsPayloadLimit,
  isBatchCapableCloudflareModel,
  pollCloudflareReviewBatch,
  submitCloudflareReviewBatch,
} from '@server/models/cloudflare-batch';
import type { CfAiAccount } from '@server/models/workers-ai';

const MODEL = '@cf/moonshotai/kimi-k2.7-code';
const ACCOUNT: CfAiAccount = { accountId: 'acct-1', apiKey: 'tok', label: 'primary' };

/** Stubs the Workers AI REST endpoint. `result` is wrapped in the `{ result }`
 *  envelope the API returns; the last request's parsed body is captured. */
function stubRest(result: (body: any) => unknown) {
  const calls: Array<{ url: string; body: any }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const body = JSON.parse(String((init as RequestInit)?.body));
    calls.push({ url: String(url), body });
    return new Response(JSON.stringify({ result: result(body), success: true }), { status: 200 });
  });
  return calls;
}

const item = (text: string) => ({ systemPrompt: 'review this', userPrompt: text });

describe('cloudflare batch', () => {
  afterEach(() => vi.restoreAllMocks());

  it('knows which models support batch', () => {
    expect(isBatchCapableCloudflareModel(MODEL)).toBe(true);
    expect(isBatchCapableCloudflareModel('@cf/zai-org/glm-5.2')).toBe(true);
    // Publishes no batch-input.json, so it must stay on the synchronous path.
    expect(isBatchCapableCloudflareModel('@cf/qwen/qwen2.5-coder-32b-instruct')).toBe(false);
  });

  it('submits to the async batch REST endpoint with queueRequest', async () => {
    const calls = stubRest(() => ({ request_id: 'req-123' }));

    const requestId = await submitCloudflareReviewBatch(ACCOUNT, MODEL, [item('a'), item('b')]);

    expect(requestId).toBe('req-123');
    expect(calls[0].url).toBe(`https://api.cloudflare.com/client/v4/accounts/acct-1/ai/run/${MODEL}?queueRequest=true`);
    expect(calls[0].body.requests).toHaveLength(2);
    expect(calls[0].body.requests[0].messages[1].content).toContain('a');
  });

  it('polls the async batch endpoint by request_id', async () => {
    const calls = stubRest(() => ({ status: 'queued' }));
    await pollCloudflareReviewBatch(ACCOUNT, MODEL, 'req-1');
    expect(calls[0].url).toContain('?queueRequest=true');
    expect(calls[0].body).toEqual({ request_id: 'req-1' });
  });

  it('throws when submit returns no request_id', async () => {
    stubRest(() => ({}));
    await expect(submitCloudflareReviewBatch(ACCOUNT, MODEL, [item('a')])).rejects.toThrow(/no request_id/);
  });

  it('reports queued and running batches as pending', async () => {
    for (const status of ['queued', 'running']) {
      stubRest(() => ({ status }));
      expect(await pollCloudflareReviewBatch(ACCOUNT, MODEL, 'req-1')).toEqual({ status: 'pending' });
      vi.restoreAllMocks();
    }
  });

  it('maps completed responses back by their id index', async () => {
    stubRest(() => ({
      responses: [
        // Deliberately out of order: id, not array position, is authoritative.
        { id: 1, success: true, result: { choices: [{ message: { content: '{"second":true}' } }] } },
        { id: 0, success: true, result: { choices: [{ message: { content: '{"first":true}' } }] } },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    }));

    const result = await pollCloudflareReviewBatch(ACCOUNT, MODEL, 'req-1');
    if (result.status !== 'complete') throw new Error('expected complete');

    expect(result.responses).toEqual([
      { index: 1, rawText: '{"second":true}', error: null },
      { index: 0, rawText: '{"first":true}', error: null },
    ]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
  });

  it('surfaces per-response failures instead of dropping them', async () => {
    stubRest(() => ({
      responses: [{ id: 0, success: false, error: 'model unavailable' }],
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    }));

    const result = await pollCloudflareReviewBatch(ACCOUNT, MODEL, 'req-1');
    if (result.status !== 'complete') throw new Error('expected complete');
    expect(result.responses[0]).toEqual({ index: 0, rawText: null, error: 'model unavailable' });
  });

  it('throws when a finished batch has no responses array', async () => {
    stubRest(() => ({ status: 'error' }));
    await expect(pollCloudflareReviewBatch(ACCOUNT, MODEL, 'req-1')).rejects.toThrow(/no responses array/);
  });

  it('rejects payloads over the 10 MB batch cap', () => {
    expect(batchFitsPayloadLimit([item('small')]).fits).toBe(true);
    expect(batchFitsPayloadLimit([item('x'.repeat(9_500_000))]).fits).toBe(false);
  });
});
