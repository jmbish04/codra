import { createWorkersAI, type WorkersAI } from 'workers-ai-provider';
import { logger } from '@server/core/logger';
import { getSecretStoreBinding } from '@server/utils/secrets';
import { logApiUsage } from '@server/db/api-usage';

/**
 * A Cloudflare account we can run Workers AI on via the REST API. `label`
 * distinguishes the free daily-allocation account ('freebie') from this
 * account ('primary') so per-account usage can be tracked in D1.
 */
export type CfAiAccount = { accountId: string; apiKey: string; label: 'freebie' | 'primary' };

export type WorkersAiAccountEnv = Pick<
  Env,
  'CF_FREEBIE_ACCOUNT_ID' | 'CF_FREEBIE_API_TOKEN' | 'CF_ACCOUNT_ID' | 'CF_API_TOKEN'
>;

type UsageLike = {
  promptTokens?: number;
  completionTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function tryGetSecretStore<K extends keyof Env>(env: Pick<Env, K>, name: K): Promise<string | null> {
  try {
    const value = await getSecretStoreBinding(env, name);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Ordered Workers-AI accounts to try: the free account first (spend its free
 * daily neuron allocation before this account's paid usage), then this account.
 * Throws when neither resolves — Workers AI now runs only over REST, so at least
 * one account's creds must be present.
 */
export async function resolveWorkersAiAccounts(env: WorkersAiAccountEnv): Promise<CfAiAccount[]> {
  const [freebieAccountId, freebieToken, accountId, apiToken] = await Promise.all([
    tryGetSecretStore(env, 'CF_FREEBIE_ACCOUNT_ID'),
    tryGetSecretStore(env, 'CF_FREEBIE_API_TOKEN'),
    tryGetSecretStore(env, 'CF_ACCOUNT_ID'),
    tryGetSecretStore(env, 'CF_API_TOKEN'),
  ]);

  const accounts: CfAiAccount[] = [];
  if (freebieAccountId && freebieToken) {
    accounts.push({ accountId: freebieAccountId, apiKey: freebieToken, label: 'freebie' });
  }
  if (accountId && apiToken) {
    accounts.push({ accountId, apiKey: apiToken, label: 'primary' });
  }

  if (accounts.length === 0) {
    throw new Error(
      'No Cloudflare Workers AI account configured (need CF_ACCOUNT_ID + CF_API_TOKEN, or CF_FREEBIE_ACCOUNT_ID + CF_FREEBIE_API_TOKEN).',
    );
  }
  return accounts;
}

/** True when an error means the account is out of its free/quota allowance. */
export function isWorkersAiQuotaError(input: { status?: number; message?: string }): boolean {
  if (input.status === 429) return true;
  const m = (input.message || '').toLowerCase();
  return (
    m.includes('4006') ||
    m.includes('3040') ||
    m.includes('daily free allocation') ||
    m.includes('out of neurons') ||
    m.includes('capacity temporarily exceeded')
  );
}

function usageTokens(usage: UsageLike | undefined) {
  return {
    promptTokens: usage?.promptTokens ?? usage?.inputTokens ?? 0,
    completionTokens: usage?.completionTokens ?? usage?.outputTokens ?? 0,
  };
}

/** Records one Workers-AI call to D1 tagged with the account it ran on. */
export async function logWorkersAiUsage(
  env: { DB: D1Database },
  params: { model: string; account: CfAiAccount; promptTokens: number; completionTokens: number },
) {
  await logApiUsage(env, {
    provider: 'Cloudflare',
    model: params.model,
    promptTokens: params.promptTokens,
    completionTokens: params.completionTokens,
    source: 'local',
    accountId: params.account.accountId,
    accountLabel: params.account.label,
  });
}

/**
 * POSTs a Workers-AI payload to one account's REST endpoint. `query` carries
 * extra params (e.g. `queueRequest=true` for the batch API). Returns the model
 * output unwrapped from the REST `{ result, success, errors }` envelope so it
 * matches the shape the old `env.AI.run` binding returned. Throws with a
 * `.status` on HTTP errors so callers can detect quota exhaustion.
 */
export async function runWorkersAiRest(
  account: CfAiAccount,
  model: string,
  payload: unknown,
  query = '',
): Promise<unknown> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${account.accountId}/ai/run/${model}${query ? `?${query}` : ''}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${account.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const error = new Error(`Workers AI REST ${res.status}: ${body.slice(0, 300)}`) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }

  const json = await res.json().catch(() => null);
  return isRecord(json) && 'result' in json ? (json as Record<string, unknown>).result : json;
}

/**
 * Runs a raw Workers-AI payload, preferring the free account and falling back to
 * this account when the free one is out of quota. Returns the result plus the
 * account it ran on (so callers can log per-account usage).
 */
export async function runWorkersAiWithFallback(
  env: WorkersAiAccountEnv,
  model: string,
  payload: unknown,
  query = '',
): Promise<{ result: unknown; account: CfAiAccount }> {
  const accounts = await resolveWorkersAiAccounts(env);
  let lastError: unknown;

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    try {
      const result = await runWorkersAiRest(account, model, payload, query);
      return { result, account };
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number })?.status;
      const message = error instanceof Error ? error.message : String(error);
      if (i < accounts.length - 1 && isWorkersAiQuotaError({ status, message })) {
        logger.info(`Workers AI account '${account.label}' out of quota; falling back to the next account`, { model });
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/**
 * Resolves a REST-backed provider for the highest-priority account (free first).
 * For streaming calls that can't retry mid-stream — pair with
 * {@link logStreamedWorkersAiUsage} to record usage once the stream settles.
 */
export async function resolveWorkersAiProvider(
  env: WorkersAiAccountEnv,
): Promise<{ workersai: WorkersAI; account: CfAiAccount }> {
  const [account] = await resolveWorkersAiAccounts(env);
  return { workersai: createWorkersAI({ accountId: account.accountId, apiKey: account.apiKey }), account };
}

/** Fire-and-forget usage logging for a streamed generation's `.usage` promise. */
export function logStreamedWorkersAiUsage(
  env: { DB: D1Database },
  model: string,
  account: CfAiAccount,
  usage: PromiseLike<UsageLike>,
) {
  Promise.resolve(usage)
    .then((u) => logWorkersAiUsage(env, { model, account, ...usageTokens(u) }))
    .catch(() => {});
}

/**
 * Runs an AI-SDK generate call (`generateText` / `generateObject`) on the free
 * account first, falling back to this account on quota exhaustion, and logs the
 * resulting token usage to D1 tagged with the account. The callback receives a
 * REST-backed `workers-ai-provider` instance.
 */
export async function generateWithWorkersAi<T extends { usage?: UsageLike }>(
  env: WorkersAiAccountEnv & { DB: D1Database },
  model: string,
  run: (workersai: WorkersAI) => Promise<T>,
): Promise<T> {
  const accounts = await resolveWorkersAiAccounts(env);
  let lastError: unknown;

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const workersai = createWorkersAI({ accountId: account.accountId, apiKey: account.apiKey });
    try {
      const result = await run(workersai);
      const { promptTokens, completionTokens } = usageTokens(result.usage);
      await logWorkersAiUsage(env, { model, account, promptTokens, completionTokens });
      return result;
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number; statusCode?: number })?.statusCode
        ?? (error as { status?: number })?.status;
      const message = error instanceof Error ? error.message : String(error);
      if (i < accounts.length - 1 && isWorkersAiQuotaError({ status, message })) {
        logger.info(`Workers AI account '${account.label}' out of quota; falling back to the next account`, { model });
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
