import { describe, expect, it } from 'vitest';
import { isStaleWebhookTimestamp, verifyGeminiWebhookSignature } from '@server/core/gemini-webhook';
import { geminiWebhookUri, isTerminalInteractionStatus } from '@server/core/review';
import { createTestEnv } from './helpers';

const APP_URL = createTestEnv().APP_URL;

describe('Gemini webhook plumbing', () => {
  it('only treats settled interaction states as terminal', () => {
    expect(isTerminalInteractionStatus('completed')).toBe(true);
    expect(isTerminalInteractionStatus('failed')).toBe(true);
    expect(isTerminalInteractionStatus('cancelled')).toBe(true);
    expect(isTerminalInteractionStatus('in_progress')).toBe(false);
    expect(isTerminalInteractionStatus('requires_action')).toBe(false);
  });

  it('only advertises an https callback url', () => {
    expect(geminiWebhookUri({ APP_URL } as any)).toBe(`${APP_URL}/webhook/gemini`);
    expect(geminiWebhookUri({ APP_URL: 'http://localhost:8787' } as any)).toBeNull();
    expect(geminiWebhookUri({ APP_URL: '' } as any)).toBeNull();
  });

  it('rejects deliveries with a missing or malformed signature', async () => {
    expect(await verifyGeminiWebhookSignature(null)).toBe(false);
    expect(await verifyGeminiWebhookSignature('not-a-jwt')).toBe(false);
    // Well-formed shape, but HS256 is not accepted.
    const header = btoa(JSON.stringify({ alg: 'HS256', kid: 'x' })).replace(/=+$/, '');
    expect(await verifyGeminiWebhookSignature(`${header}.e30.sig`)).toBe(false);
  });

  it('rejects replayed timestamps outside the five minute window', () => {
    expect(isStaleWebhookTimestamp(new Date(Date.now() - 10 * 60 * 1000).toISOString())).toBe(true);
    expect(isStaleWebhookTimestamp(new Date().toISOString())).toBe(false);
    expect(isStaleWebhookTimestamp(null)).toBe(false);
  });
});
