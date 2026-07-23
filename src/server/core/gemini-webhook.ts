import { logger } from '@server/core/logger';

/**
 * Gemini signs webhook deliveries with an RS256 JWT in the `webhook-signature`
 * header, verifiable against Google's public JWKS.
 * https://ai.google.dev/gemini-api/docs/interactions/webhooks
 *
 * Verification is defence in depth only: the handler never trusts payload
 * contents, it re-reads the interaction from the API with our own key.
 */
const JWKS_URL = 'https://generativelanguage.googleapis.com/.well-known/jwks.json';
const JWKS_CACHE_SECONDS = 3600;
/** Deliveries older than this are rejected as replays. */
export const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000;

type Jwk = JsonWebKey & { kid?: string; alg?: string };

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeJwtSegment(segment: string): Record<string, unknown> | null {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(segment)));
  } catch {
    return null;
  }
}

async function fetchSigningKey(kid: string | undefined) {
  const response = await fetch(JWKS_URL, { cf: { cacheTtl: JWKS_CACHE_SECONDS, cacheEverything: true } } as RequestInit);
  if (!response.ok) throw new Error(`JWKS fetch failed with ${response.status}`);

  const { keys } = (await response.json()) as { keys?: Jwk[] };
  const jwk = (keys ?? []).find((key) => !kid || key.kid === kid);
  if (!jwk) throw new Error(`No JWKS entry for kid ${kid ?? '(unspecified)'}`);

  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

/**
 * Verifies the `webhook-signature` JWT. Returns false rather than throwing so
 * the caller can still persist the delivery for auditing.
 */
export async function verifyGeminiWebhookSignature(signature: string | null): Promise<boolean> {
  if (!signature) return false;

  const token = signature.trim().replace(/^Bearer\s+/i, '');
  const [headerSegment, payloadSegment, signatureSegment] = token.split('.');
  if (!headerSegment || !payloadSegment || !signatureSegment) return false;

  const header = decodeJwtSegment(headerSegment);
  if (!header || header.alg !== 'RS256') return false;

  try {
    const key = await fetchSigningKey(typeof header.kid === 'string' ? header.kid : undefined);
    const verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      decodeBase64Url(signatureSegment),
      new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
    );
    if (!verified) return false;

    const payload = decodeJwtSegment(payloadSegment);
    if (payload && typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
      logger.warn('Gemini webhook signature is expired');
      return false;
    }
    return true;
  } catch (error) {
    logger.warn('Gemini webhook signature verification failed', error);
    return false;
  }
}

/** True when `webhook-timestamp` is missing, unparseable, or too old. */
export function isStaleWebhookTimestamp(timestamp: string | null) {
  if (!timestamp) return false;
  const sentAt = Date.parse(timestamp);
  if (Number.isNaN(sentAt)) return false;
  return Math.abs(Date.now() - sentAt) > MAX_WEBHOOK_AGE_MS;
}
