import { logger } from '@server/core/logger';

export type SecretsStoreSecret = {
  name: string;
  comment: string | null;
};

/**
 * List the secrets in a Cloudflare Secrets Store, with their descriptions.
 * Uses the account-level CF_API_TOKEN. Returns [] on any failure (the caller
 * degrades gracefully rather than blocking a review).
 */
export async function listSecretsStoreSecrets(env: Env, storeId: string): Promise<SecretsStoreSecret[]> {
  try {
    const [apiToken, accountId] = await Promise.all([
      env.CF_API_TOKEN.get(),
      env.CF_ACCOUNT_ID.get(),
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
        result?: Array<{ name: string; comment?: string | null }>;
        result_info?: { total_pages?: number };
      };
      if (!res.ok || !data.success) {
        logger.error('Secrets Store list failed', new Error(JSON.stringify((data as any).errors ?? res.status)));
        return out;
      }
      for (const s of data.result ?? []) {
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

/**
 * Ensure `wrangler.jsonc` declares a secrets_store_secrets binding for each
 * required secret. Returns the updated content (JSON, comments dropped) plus
 * the list of bindings actually added, or null if nothing changed.
 *
 * ponytail: re-serializes as plain JSON, so JSONC comments are lost. Acceptable
 * for an automated PR a human reviews; upgrade to a comment-preserving edit if
 * that becomes a problem.
 */
export function ensureSecretBindings(
  wranglerContent: string,
  required: SecretBindingSpec[],
): { content: string; added: SecretBindingSpec[] } | null {
  let config: any;
  try {
    const stripped = wranglerContent
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,(\s*[\]}])/g, '$1');
    config = JSON.parse(stripped);
  } catch {
    return null; // don't touch an unparseable config
  }

  const existing: any[] = Array.isArray(config.secrets_store_secrets) ? config.secrets_store_secrets : [];
  const have = new Set(existing.map((b) => `${b.store_id}:${b.secret_name}`));

  const added: SecretBindingSpec[] = [];
  for (const spec of required) {
    if (!have.has(`${spec.store_id}:${spec.secret_name}`)) {
      existing.push({ binding: spec.binding, store_id: spec.store_id, secret_name: spec.secret_name });
      added.push(spec);
    }
  }

  if (added.length === 0) return null;
  config.secrets_store_secrets = existing;
  return { content: JSON.stringify(config, null, 2), added };
}
