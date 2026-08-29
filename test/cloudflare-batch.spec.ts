import {
  batchFitsPayloadLimit,
  isBatchCapableCloudflareModel,
} from '@server/models/cloudflare-batch';

// The Workers AI async Batch submit/poll functions were removed with the
// core-guardian migration (they required a local `env.AI` binding, which Codra
// dropped). Only the pure batch-capability + payload-size helpers remain.

const MODEL = '@cf/moonshotai/kimi-k2.7-code';
const item = (text: string) => ({ systemPrompt: 'review this', userPrompt: text });

describe('cloudflare batch helpers', () => {
  it('knows which models support batch', () => {
    expect(isBatchCapableCloudflareModel(MODEL)).toBe(true);
    expect(isBatchCapableCloudflareModel('@cf/zai-org/glm-5.2')).toBe(true);
    // Publishes no batch-input.json, so it must stay on the synchronous path.
    expect(isBatchCapableCloudflareModel('@cf/qwen/qwen2.5-coder-32b-instruct')).toBe(false);
  });

  it('rejects payloads over the 10 MB batch cap', () => {
    expect(batchFitsPayloadLimit([item('small')]).fits).toBe(true);
    expect(batchFitsPayloadLimit([item('x'.repeat(9_500_000))]).fits).toBe(false);
  });
});
