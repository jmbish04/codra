import { describe, it, expect } from 'vitest';
import { ensureSecretBindings } from '@server/core/secrets-store';

const STORE = 'store123';

describe('ensureSecretBindings', () => {
  it('adds a missing binding and preserves existing ones', () => {
    const wrangler = JSON.stringify({
      name: 'w',
      secrets_store_secrets: [{ binding: 'EXISTING', store_id: STORE, secret_name: 'EXISTING' }],
    });
    const result = ensureSecretBindings(wrangler, [
      { binding: 'EXISTING', secret_name: 'EXISTING', store_id: STORE },
      { binding: 'NEW_ONE', secret_name: 'NEW_ONE', store_id: STORE },
    ]);
    expect(result).not.toBeNull();
    expect(result!.added).toEqual([{ binding: 'NEW_ONE', secret_name: 'NEW_ONE', store_id: STORE }]);
    const cfg = JSON.parse(result!.content);
    expect(cfg.secrets_store_secrets).toHaveLength(2);
    expect(cfg.name).toBe('w');
  });

  it('returns null when all required bindings already exist', () => {
    const wrangler = JSON.stringify({
      secrets_store_secrets: [{ binding: 'A', store_id: STORE, secret_name: 'A' }],
    });
    expect(ensureSecretBindings(wrangler, [{ binding: 'A', secret_name: 'A', store_id: STORE }])).toBeNull();
  });

  it('creates the array when wrangler has no secrets_store_secrets yet', () => {
    const result = ensureSecretBindings(JSON.stringify({ name: 'w' }), [
      { binding: 'A', secret_name: 'A', store_id: STORE },
    ]);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!.content).secrets_store_secrets).toHaveLength(1);
  });

  it('tolerates JSONC comments and trailing commas', () => {
    const jsonc = `{
      // the worker name
      "name": "w",
      "secrets_store_secrets": [
        { "binding": "A", "store_id": "${STORE}", "secret_name": "A" },
      ],
    }`;
    const result = ensureSecretBindings(jsonc, [{ binding: 'B', secret_name: 'B', store_id: STORE }]);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!.content).secrets_store_secrets).toHaveLength(2);
  });

  it('does not touch an unparseable config', () => {
    expect(ensureSecretBindings('not json at all {{{', [{ binding: 'A', secret_name: 'A', store_id: STORE }])).toBeNull();
  });
});
