/**
 * Retrieves a standard required secret (a plain environment variable string) from the environment.
 * Throws an error if the secret is undefined or not a string.
 *
 * @template K - A key of the Env interface.
 * @param env - The Cloudflare Env object or a Pick subset containing the target key.
 * @param name - The name of the environment secret to retrieve.
 * @returns The plain string value of the secret.
 */
export function getSecret<K extends keyof Env>(env: Pick<Env, K>, name: K): string {
  const secret = env[name];
  
  if (secret === undefined) {
    throw new Error(`Secret ${String(name)} is not defined in environment bindings.`);
  }

  if (typeof secret !== 'string') {
    throw new Error(`Secret ${String(name)} is not a string.`);
  }

  return secret;
}

/**
 * Retrieves a secret store binding value (e.g. Secrets Store / Cloudflare Secret) by calling its `.get()` method.
 * Throws an error if the binding is undefined or does not expose a `.get()` function.
 *
 * @template K - A key of the Env interface.
 * @param env - The Cloudflare Env object or a Pick subset containing the target key.
 * @param name - The name of the secret store binding to retrieve.
 * @returns A promise resolving to the string secret content.
 */
export async function getSecretStoreBinding<K extends keyof Env>(env: Pick<Env, K>, name: K): Promise<string> {
  const binding = env[name];

  if (binding === undefined) {
    throw new Error(`Secret Store binding ${String(name)} is not defined in environment bindings.`);
  }

  if (typeof binding !== 'object' || binding === null || !('get' in binding) || typeof (binding as any).get !== 'function') {
    throw new Error(`Binding ${String(name)} is not a valid secret store binding.`);
  }

  return await (binding as any).get();
}

/**
 * Helper to retrieve the WORKER_API_KEY from the Secrets Store.
 *
 * @param env - The full Cloudflare Env object.
 * @returns A promise resolving to the WORKER_API_KEY string.
 */
export async function getWorkerApiKey(env: Env): Promise<string> {
  const apiKey = await getSecretStoreBinding(env, "WORKER_API_KEY");
  return apiKey;
}