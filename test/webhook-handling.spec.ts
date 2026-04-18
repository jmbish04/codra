import { createApp } from '@server/app';
import { createMockPRWebhook, createTestEnv } from './helpers';
import { vi } from 'vitest';

// Mock GitHubClient to avoid real JWT signing and network calls
vi.mock('@server/core/github', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    GitHubClient: class {
      getInstallationToken = vi.fn().mockResolvedValue('fake-token');
      getRepoFileOrNull = vi.fn().mockResolvedValue(null);
    }
  };
});

async function signPayload(secret: string, payload: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `sha256=${Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`;
}

describe('Webhook Handling Suite', () => {
  const env = createTestEnv();
  const app = createApp();

  it('rejects webhooks with invalid signatures', async () => {
    const payload = JSON.stringify(createMockPRWebhook());
    const response = await app.request(
      'http://codra.test/webhook',
      {
        method: 'POST',
        headers: {
          'x-github-event': 'pull_request',
          'x-github-delivery': 'delivery-inv',
          'x-hub-signature-256': 'sha256=invalid',
        },
        body: payload,
      },
      env,
    );

    expect(response.status).toBe(401);
  });

  it('accepts valid pull_request.opened and queues a job', async () => {
    const repoName = `repo-${Date.now()}`;
    const rawPayload = createMockPRWebhook({
        action: 'opened',
        repository: { name: repoName, owner: { login: 'test-owner' } }
    });
    const body = JSON.stringify(rawPayload);
    const signature = await signPayload(env.GITHUB_APP_WEBHOOK_SECRET, body);

    const response = await app.request(
      'http://codra.test/webhook',
      {
        method: 'POST',
        headers: {
          'x-github-event': 'pull_request',
          'x-github-delivery': `delivery-${Date.now()}`,
          'x-hub-signature-256': signature,
          'content-type': 'application/json',
        },
        body,
      },
      env,
    );

    const json = await response.json() as any;
    expect(response.status).toBe(202);
    expect(json.ok).toBe(true);
    expect(json.jobId).toBeDefined();

    const queue = env.REVIEW_QUEUE as any;
    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0].jobId).toBe(json.jobId);
  });

  it('ignores webhooks for draft PRs', async () => {
      const draftPayload = createMockPRWebhook({ 
          action: 'opened',
          pull_request: { draft: true, number: 99, head: { sha: 'abc' }, base: { sha: 'def' }, user: { login: 'a' } }
      });
      const body = JSON.stringify(draftPayload);
      const signature = await signPayload(env.GITHUB_APP_WEBHOOK_SECRET, body);

      const response = await app.request(
        'http://codra.test/webhook',
        {
          method: 'POST',
          headers: {
            'x-github-event': 'pull_request',
            'x-github-delivery': `draft-${Date.now()}`,
            'x-hub-signature-256': signature,
          },
          body,
        },
        env,
      );

      const json = await response.json() as any;
      expect(response.status).toBe(202);
      expect(json.ignored).toBe(true);
  });
});
