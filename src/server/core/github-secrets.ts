import _sodium from 'libsodium-wrappers';
import { GitHubError } from '@server/core/github';
import { logger } from '@server/core/logger';

/** Encrypt a secret value against a repo's base64 Actions public key (libsodium sealed box). */
export async function sealSecret(publicKeyB64: string, secret: string): Promise<string> {
  await _sodium.ready;
  const pub = _sodium.from_base64(publicKeyB64, _sodium.base64_variants.ORIGINAL);
  const sealed = _sodium.crypto_box_seal(_sodium.from_string(secret), pub);
  return _sodium.to_base64(sealed, _sodium.base64_variants.ORIGINAL);
}

type SecretsGithub = {
  getRepoActionsPublicKey(owner: string, repo: string): Promise<{ key_id: string; key: string }>;
  putRepoActionsSecret(owner: string, repo: string, name: string, encrypted_value: string, key_id: string): Promise<void>;
};

/** Set repo Actions secrets. Returns ok:false (no throw) when the App lacks permission. */
export async function setRepoActionsSecrets(
  github: SecretsGithub, owner: string, repo: string, secrets: { name: string; value: string }[],
): Promise<{ ok: boolean; set: string[]; reason?: string }> {
  try {
    const key = await github.getRepoActionsPublicKey(owner, repo);
    const set: string[] = [];
    for (const s of secrets) {
      const encrypted = await sealSecret(key.key, s.value);
      await github.putRepoActionsSecret(owner, repo, s.name, encrypted, key.key_id);
      set.push(s.name);
    }
    return { ok: true, set };
  } catch (err) {
    if (err instanceof GitHubError && (err.status === 403 || err.status === 404)) {
      logger.warn(`No permission to set Actions secrets on ${owner}/${repo} (status ${err.status})`);
      return { ok: false, set: [], reason: `GitHub App lacks Actions Secrets:write permission (HTTP ${err.status})` };
    }
    logger.error('setRepoActionsSecrets failed', err instanceof Error ? err : new Error(String(err)));
    return { ok: false, set: [], reason: String(err) };
  }
}
