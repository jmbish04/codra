import {
  batchFitsPayloadLimit,
  isBatchCapableCloudflareModel,
  pollCloudflareReviewBatch,
  submitCloudflareReviewBatch,
} from '@server/models/cloudflare-batch';

const MODEL = '@cf/moonshotai/kimi-k2.7-code';

// gatewayId is explicit: a default param would swallow an intentional
// `undefined` and silently test the configured-gateway path instead.
function fakeEnv(run: (...args: any[]) => any, gatewayId?: string) {
  return { AI: { run }, AI_GATEWAY_ID: gatewayId } as any;
}

const item = (text: string) => ({ systemPrompt: 'review this', userPrompt: text });

describe('cloudflare batch', () => {
  it('knows which models support batch', () => {
    expect(isBatchCapableCloudflareModel(MODEL)).toBe(true);
    expect(isBatchCapableCloudflareModel('@cf/zai-org/glm-5.2')).toBe(true);
    // Publishes no batch-input.json, so it must stay on the synchronous path.
    expect(isBatchCapableCloudflareModel('@cf/qwen/qwen2.5-coder-32b-instruct')).toBe(false);
  });

  it('submits with queueRequest and routes through the AI gateway', async () => {
    const calls: any[] = [];
    const env = fakeEnv((...args: any[]) => {
      calls.push(args);
      return { request_id: 'req-123' };
    }, 'codra');

    const requestId = await submitCloudflareReviewBatch(env, MODEL, [item('a'), item('b')]);

    expect(requestId).toBe('req-123');
    const [model, inputs, options] = calls[0];
    expect(model).toBe(MODEL);
    expect(inputs.requests).toHaveLength(2);
    expect(inputs.requests[0].messages[1].content).toContain('a');
    expect(options.queueRequest).toBe(true);
    expect(options.gateway).toEqual({ id: 'codra' });
  });

  it('omits the gateway when no gateway id is configured', async () => {
    const calls: any[] = [];
    const env = fakeEnv((...args: any[]) => {
      calls.push(args);
      return { request_id: 'req-1' };
    });

    await submitCloudflareReviewBatch(env, MODEL, [item('a')]);
    expect(calls[0][2].gateway).toBeUndefined();
    expect(calls[0][2].queueRequest).toBe(true);
  });

  it('throws when submit returns no request_id', async () => {
    const env = fakeEnv(() => ({}), 'codra');
    await expect(submitCloudflareReviewBatch(env, MODEL, [item('a')])).rejects.toThrow(/no request_id/);
  });

  it('reports queued and running batches as pending', async () => {
    for (const status of ['queued', 'running']) {
      const env = fakeEnv(() => ({ status }), 'codra');
      expect(await pollCloudflareReviewBatch(env, MODEL, 'req-1')).toEqual({ status: 'pending' });
    }
  });

  it('maps completed responses back by their id index', async () => {
    const env = fakeEnv(() => ({
      responses: [
        // Deliberately out of order: id, not array position, is authoritative.
        { id: 1, success: true, result: { choices: [{ message: { content: '{"second":true}' } }] } },
        { id: 0, success: true, result: { choices: [{ message: { content: '{"first":true}' } }] } },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    }), 'codra');

    const result = await pollCloudflareReviewBatch(env, MODEL, 'req-1');
    if (result.status !== 'complete') throw new Error('expected complete');

    expect(result.responses).toEqual([
      { index: 1, rawText: '{"second":true}', error: null },
      { index: 0, rawText: '{"first":true}', error: null },
    ]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
  });

  it('surfaces per-response failures instead of dropping them', async () => {
    const env = fakeEnv(() => ({
      responses: [{ id: 0, success: false, error: 'model unavailable' }],
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    }), 'codra');

    const result = await pollCloudflareReviewBatch(env, MODEL, 'req-1');
    if (result.status !== 'complete') throw new Error('expected complete');
    expect(result.responses[0]).toEqual({ index: 0, rawText: null, error: 'model unavailable' });
  });

  it('throws when a finished batch has no responses array', async () => {
    const env = fakeEnv(() => ({ status: 'error' }), 'codra');
    await expect(pollCloudflareReviewBatch(env, MODEL, 'req-1')).rejects.toThrow(/no responses array/);
  });

  it('rejects payloads over the 10 MB batch cap', () => {
    expect(batchFitsPayloadLimit([item('small')]).fits).toBe(true);
    expect(batchFitsPayloadLimit([item('x'.repeat(9_500_000))]).fits).toBe(false);
  });
});
