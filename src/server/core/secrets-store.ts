import { logger } from '@server/core/logger';

export type SecretsStoreSecret = {
  name: string;
  comment: string | null;
};

/**
 * List the secrets in a Cloudflare Secrets Store, with their descriptions.
 * Uses the account-level cf_paid_api_token. Returns [] on any failure (the caller
 * degrades gracefully rather than blocking a review).
 */
export async function listSecretsStoreSecrets(env: Env, storeId: string): Promise<SecretsStoreSecret[]> {
  try {
    const [apiToken, accountId] = await Promise.all([
      env.cf_paid_api_token.get(),
      env.cf_paid_account_id.get(),
    ]);
    if (!apiToken || !accountId || !storeId) return [];

    const out: SecretsStoreSecret[] = [];
    let page = 1;
    for (;;) {
      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/secrets_store/stores/${storeId}/secrets?per_page=100&page=${page}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      });
      const data = (await res.json()) as {
        success: boolean;
        result?: Array<{ name: string; comment?: string | null; scopes?: string[] }>;
        result_info?: { total_pages?: number };
      };
      if (!res.ok || !data.success) {
        logger.error('Secrets Store list failed', new Error(JSON.stringify((data as any).errors ?? res.status)));
        return out;
      }
      for (const s of data.result ?? []) {
        // Worker secrets only — exclude AI Gateway (and other non-worker) scoped
        // secrets. If a secret carries no scope info, keep it (assume worker).
        const scopes = s.scopes;
        if (Array.isArray(scopes) && scopes.length > 0) {
          const isWorker = scopes.some((sc) => /worker/i.test(sc));
          const isAiGateway = scopes.some((sc) => /ai.?gateway/i.test(sc));
          if (!isWorker || isAiGateway) continue;
        }
        out.push({ name: s.name, comment: s.comment ?? null });
      }
      const totalPages = data.result_info?.total_pages ?? 1;
      if (page >= totalPages) break;
      page += 1;
    }
    return out;
  } catch (err) {
    logger.error('Secrets Store list threw', err instanceof Error ? err : new Error(String(err)));
    return [];
  }
}

export type SecretBindingSpec = { binding: string; secret_name: string; store_id: string };

/** Find the index just after the `[` of a top-level `"key": [` array, or -1. */
function findArrayOpen(text: string, key: string): number {
  const re = new RegExp(`"${key}"\\s*:\\s*\\[`);
  const m = re.exec(text);
  return m ? m.index + m[0].length : -1;
}

/** From an index inside an array (just after `[`), find the matching `]`, ignoring brackets in strings. */
function findArrayClose(text: string, openIdx: number): number {
  let depth = 1;
  let inStr = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * Ensure `wrangler.jsonc` declares a secrets_store_secrets binding for each
 * required secret. Surgically edits the raw text — existing comments and
 * formatting are preserved. Returns the updated content plus the bindings
 * actually added, or null if nothing changed.
 */
export function ensureSecretBindings(
  wranglerContent: string,
  required: SecretBindingSpec[],
): { content: string; added: SecretBindingSpec[] } | null {
  // Detect which bindings already exist (parse a comment-stripped copy).
  let have = new Set<string>();
  try {
    const stripped = wranglerContent
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,(\s*[\]}])/g, '$1');
    const cfg = JSON.parse(stripped);
    if (Array.isArray(cfg.secrets_store_secrets)) {
      have = new Set(cfg.secrets_store_secrets.map((b: any) => `${b.store_id}:${b.secret_name}`));
    }
  } catch {
    return null; // don't touch an unparseable config
  }

  const added = required.filter((s) => !have.has(`${s.store_id}:${s.secret_name}`));
  if (added.length === 0) return null;

  const entry = (s: SecretBindingSpec) =>
    `\t\t{ "binding": "${s.binding}", "store_id": "${s.store_id}", "secret_name": "${s.secret_name}" }`;

  const openIdx = findArrayOpen(wranglerContent, 'secrets_store_secrets');

  if (openIdx !== -1) {
    const closeIdx = findArrayClose(wranglerContent, openIdx);
    if (closeIdx === -1) return null;
    const inner = wranglerContent.slice(openIdx, closeIdx);
    const entriesText = added.map(entry).join(',\n');

    if (inner.trim().length === 0) {
      // Empty array — replace its inner whitespace with the new entries.
      return { content: wranglerContent.slice(0, openIdx) + '\n' + entriesText + '\n\t' + wranglerContent.slice(closeIdx), added };
    }
    // Non-empty — PREPEND our entries right after `[`, so we never touch the
    // existing entries' trailing commas or end-of-line comments.
    return { content: wranglerContent.slice(0, openIdx) + '\n' + entriesText + ',' + wranglerContent.slice(openIdx), added };
  }

  // No array yet — add one right after the top-level opening `{`.
  const braceIdx = wranglerContent.indexOf('{');
  if (braceIdx === -1) return null;
  const block = `\n\t"secrets_store_secrets": [\n${added.map(entry).join(',\n')}\n\t],`;
  const content = wranglerContent.slice(0, braceIdx + 1) + block + wranglerContent.slice(braceIdx + 1);
  return { content, added };
}
