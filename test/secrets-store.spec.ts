import { describe, it, expect } from 'vitest';
import { ensureSecretBindings } from '@server/core/secrets-store';

const STORE = 'store123';

// Parse a JSONC string the way the app does (strip comments + trailing commas).
function parseJsonc(s: string) {
  return JSON.parse(
    s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/,(\s*[\]}])/g, '$1'),
  );
}

describe('ensureSecretBindings (surgical)', () => {
  it('adds a missing binding and preserves existing ones', () => {
    const wrangler = `{
\t"name": "w",
\t"secrets_store_secrets": [
\t\t{ "binding": "EXISTING", "store_id": "${STORE}", "secret_name": "EXISTING" }
\t]
}`;
    const result = ensureSecretBindings(wrangler, [
      { binding: 'EXISTING', secret_name: 'EXISTING', store_id: STORE },
      { binding: 'NEW_ONE', secret_name: 'NEW_ONE', store_id: STORE },
    ]);
    expect(result).not.toBeNull();
    expect(result!.added).toEqual([{ binding: 'NEW_ONE', secret_name: 'NEW_ONE', store_id: STORE }]);
    const cfg = parseJsonc(result!.content);
    expect(cfg.secrets_store_secrets).toHaveLength(2);
    expect(cfg.name).toBe('w');
  });

  it('returns null when all required bindings already exist', () => {
    const wrangler = `{ "secrets_store_secrets": [ { "binding": "A", "store_id": "${STORE}", "secret_name": "A" } ] }`;
    expect(ensureSecretBindings(wrangler, [{ binding: 'A', secret_name: 'A', store_id: STORE }])).toBeNull();
  });

  it('creates the array when wrangler has no secrets_store_secrets yet', () => {
    const result = ensureSecretBindings(`{\n\t"name": "w"\n}`, [
      { binding: 'A', secret_name: 'A', store_id: STORE },
    ]);
    expect(result).not.toBeNull();
    expect(parseJsonc(result!.content).secrets_store_secrets).toHaveLength(1);
  });

  it('PRESERVES comments in the config (surgical edit, not re-serialize)', () => {
    const jsonc = `{
\t// the worker name
\t"name": "w",
\t"secrets_store_secrets": [
\t\t{ "binding": "A", "store_id": "${STORE}", "secret_name": "A" } // first secret
\t]
}`;
    const result = ensureSecretBindings(jsonc, [{ binding: 'B', secret_name: 'B', store_id: STORE }]);
    expect(result).not.toBeNull();
    // comments still there
    expect(result!.content).toContain('// the worker name');
    expect(result!.content).toContain('// first secret');
    // and the new binding was added
    expect(parseJsonc(result!.content).secrets_store_secrets).toHaveLength(2);
  });

  it('does not touch an unparseable config', () => {
    expect(ensureSecretBindings('not json at all {{{', [{ binding: 'A', secret_name: 'A', store_id: STORE }])).toBeNull();
  });
});
