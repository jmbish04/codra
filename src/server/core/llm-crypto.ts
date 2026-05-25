import type { AppBindings } from '@server/env';

const KEY_VERSION = 'v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(value: string) {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

async function importEncryptionKey(secret: string) {
  if (!secret || secret.trim().length < 16) {
    throw new Error('LLM_CONFIG_ENCRYPTION_KEY must be at least 16 characters long.');
  }

  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptLlmApiKey(env: Pick<AppBindings, 'LLM_CONFIG_ENCRYPTION_KEY'>, apiKey: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importEncryptionKey(env.LLM_CONFIG_ENCRYPTION_KEY);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(apiKey),
  );

  return `${KEY_VERSION}:${toBase64(iv)}:${toBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptLlmApiKey(env: Pick<AppBindings, 'LLM_CONFIG_ENCRYPTION_KEY'>, encrypted: string) {
  const [version, ivBase64, ciphertextBase64] = encrypted.split(':');
  if (version !== KEY_VERSION || !ivBase64 || !ciphertextBase64) {
    throw new Error('Unsupported encrypted LLM API key format.');
  }

  const key = await importEncryptionKey(env.LLM_CONFIG_ENCRYPTION_KEY);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivBase64) },
    key,
    fromBase64(ciphertextBase64),
  );

  return decoder.decode(plaintext);
}
