import { describe, it, expect, vi } from 'vitest';
import _sodium from 'libsodium-wrappers';
import { sealSecret, setRepoActionsSecrets } from '@server/core/github-secrets';
import { GitHubError } from '@server/core/github';

describe('sealSecret', () => {
  it('produces a value the matching private key can open', async () => {
    await _sodium.ready;
    const kp = _sodium.crypto_box_keypair();
    const pubB64 = _sodium.to_base64(kp.publicKey, _sodium.base64_variants.ORIGINAL);
    const sealedB64 = await sealSecret(pubB64, 'super-secret');
    const opened = _sodium.crypto_box_seal_open(
      _sodium.from_base64(sealedB64, _sodium.base64_variants.ORIGINAL), kp.publicKey, kp.privateKey,
    );
    expect(_sodium.to_string(opened)).toBe('super-secret');
  });
});

describe('setRepoActionsSecrets', () => {
  it('encrypts + PUTs each secret', async () => {
    await _sodium.ready;
    const kp = _sodium.crypto_box_keypair();
    const github: any = {
      getRepoActionsPublicKey: vi.fn(async () => ({ key_id: 'kid', key: _sodium.to_base64(kp.publicKey, _sodium.base64_variants.ORIGINAL) })),
      putRepoActionsSecret: vi.fn(async () => {}),
    };
    const res = await setRepoActionsSecrets(github, 'o', 'r', [
      { name: 'CLOUDFLARE_ACCOUNT_ID', value: 'acc' },
      { name: 'CLOUDFLARE_API_TOKEN', value: 'tok' },
    ]);
    expect(res.ok).toBe(true);
    expect(res.set).toEqual(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']);
    expect(github.putRepoActionsSecret).toHaveBeenCalledTimes(2);
  });

  it('degrades (ok:false) on a 403 permission error', async () => {
    const github: any = {
      getRepoActionsPublicKey: vi.fn(async () => { throw new GitHubError(403, 'no perms', '/x', 'forbidden'); }),
      putRepoActionsSecret: vi.fn(),
    };
    const res = await setRepoActionsSecrets(github, 'o', 'r', [{ name: 'X', value: 'y' }]);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/permission|403/i);
    expect(github.putRepoActionsSecret).not.toHaveBeenCalled();
  });
});
