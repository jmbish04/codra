
import { getSecretStoreBinding } from '@server/utils/secrets';

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

export async function encryptLlmApiKey(env: Pick<Env, 'LLM_CONFIG_ENCRYPTION_KEY'>, apiKey: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importEncryptionKey(env.LLM_CONFIG_ENCRYPTION_KEY);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(apiKey),
  );

  return `${KEY_VERSION}:${toBase64(iv)}:${toBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptLlmApiKey(env: Pick<Env, 'LLM_CONFIG_ENCRYPTION_KEY'>, encrypted: string) {
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

export async function resolveLlmApiKey(
  env: {
    LLM_CONFIG_ENCRYPTION_KEY: string;
    GEMINI_API_KEY?: any;
    OPENAI_API_KEY?: any;
    ANTHROPIC_API_KEY?: any;
  },
  apiFormat: string,
  encryptedKey: string | null | undefined,
): Promise<string | null> {
  let decrypted: string | null = null;
  if (encryptedKey) {
    try {
      decrypted = await decryptLlmApiKey(env, encryptedKey);
    } catch (err) {
      // Ignore decryption failure and fall back
    }
  }

  const isPlaceholder = decrypted && (decrypted.startsWith('placeholder-') || decrypted.trim() === '');
  if (!decrypted || isPlaceholder) {
    try {
      if (apiFormat === 'gemini' && env.GEMINI_API_KEY) {
        const key = await getSecretStoreBinding(env as any, 'GEMINI_API_KEY');
        if (key && key.trim().length > 0) return key.trim();
      }
      if (apiFormat === 'openai' && env.OPENAI_API_KEY) {
        const key = await getSecretStoreBinding(env as any, 'OPENAI_API_KEY');
        if (key && key.trim().length > 0) return key.trim();
      }
      if (apiFormat === 'anthropic' && env.ANTHROPIC_API_KEY) {
        const key = await getSecretStoreBinding(env as any, 'ANTHROPIC_API_KEY');
        if (key && key.trim().length > 0) return key.trim();
      }
    } catch (err) {
      // Fall back to decrypted if secret retrieval fails
    }
  }

  return decrypted;
}
