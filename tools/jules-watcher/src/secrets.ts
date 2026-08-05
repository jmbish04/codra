import { execFileSync } from 'node:child_process';

/**
 * Pull a secret from the local `tokens` CLI (tied to the Cloudflare secret-store
 * binding), so the daemon never keeps plaintext creds in env files or on disk:
 *   tokens show <NAME> --value-only
 */
export function getSecret(name: string): string {
  try {
    const value = execFileSync('tokens', ['show', name, '--value-only'], { encoding: 'utf8' }).trim();
    if (!value) throw new Error('empty value');
    return value;
  } catch (err) {
    throw new Error(`Failed to read secret "${name}" via \`tokens show ${name} --value-only\`: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Convenience: the worker API key used to authenticate to the codra agent endpoints. */
export function getWorkerApiKey(): string {
  return getSecret('WORKER_API_KEY');
}
