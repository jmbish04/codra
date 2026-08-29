import { createClientFallbackModel, createWorkersAI } from 'workers-ai-provider';
import { logger } from '@server/core/logger';
import { getSecretStoreBinding } from '@server/utils/secrets';
import { logApiUsage } from '@server/db/api-usage';

/**
 * A Cloudflare account we can run Workers AI on via the REST API. `label`
 * distinguishes the free daily-allocation account ('free') from the paid
 * account ('paid') so per-account usage can be tracked in D1.
 */
export type CfAiAccount = { accountId: string; apiKey: string; label: 'free' | 'paid' };

export type WorkersAiAccountEnv = Pick<
  Env,
  'cf_free_account_id' | 'cf_free_api_token' | 'cf_paid_account_id' | 'cf_paid_api_token'
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
    tryGetSecretStore(env, 'cf_free_account_id'),
    tryGetSecretStore(env, 'cf_free_api_token'),
    tryGetSecretStore(env, 'cf_paid_account_id'),
    tryGetSecretStore(env, 'cf_paid_api_token'),
  ]);

  const accounts: CfAiAccount[] = [];
  if (freebieAccountId && freebieToken) {
    accounts.push({ accountId: freebieAccountId, apiKey: freebieToken, label: 'free' });
  }
  if (accountId && apiToken) {
    accounts.push({ accountId, apiKey: apiToken, label: 'paid' });
  }

  if (accounts.length === 0) {
    throw new Error(
      'No Cloudflare Workers AI account configured (need cf_paid_account_id + cf_paid_api_token, or cf_free_account_id + cf_free_api_token).',
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
 * Wraps a language model so the account it actually served on is recorded — the
 * `doGenerate`/`doStream` that resolves marks its account (free unless a fallback
 * to paid occurred). Everything else passes through untouched.
 */
function markServed(model: unknown, onServed: () => void): unknown {
  return new Proxy(model as object, {
    get(target, prop, receiver) {
      if (prop === 'doGenerate' || prop === 'doStream') {
        const fn = (target as Record<string, any>)[prop].bind(target);
        return async (options: unknown) => {
          const result = await fn(options);
          onServed();
          return result;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Builds a Workers-AI language model that the caller uses like any other AI-SDK
 * model — no account, fallback, or logging concerns. Every call runs on the free
 * account first and automatically falls back to the paid account if the free one
 * fails (e.g. daily allocation exhausted). Token usage is logged to D1 tagged
 * with the account that served, for both `generateText` and `streamText`.
 *
 * `run` receives the model and returns the AI-SDK result (awaited or streaming);
 * `opts` are per-model provider settings (e.g. `sessionAffinity`).
 */
export async function withWorkersAi<T extends { usage?: PromiseLike<UsageLike> | UsageLike }>(
  env: WorkersAiAccountEnv & { DB: D1Database },
  model: string,
  run: (languageModel: any) => T | Promise<T>,
  opts?: Record<string, unknown>,
): Promise<T> {
  const accounts = await resolveWorkersAiAccounts(env);
  let served: CfAiAccount = accounts[0];

  const legs = accounts.map((account) => {
    const base = createWorkersAI({ accountId: account.accountId, apiKey: account.apiKey })(model as any, opts as any);
    return {
      slug: `${account.label}:${model}`,
      transport: 'run' as const,
      model: markServed(base, () => { served = account; }),
    };
  });

  const languageModel = createClientFallbackModel(legs as any);
  const result = await run(languageModel);

  // Usage comes from the AI-SDK's normalized outer result; attribute it to the
  // account that served (streamText's usage settles after the stream completes).
  Promise.resolve(result.usage as PromiseLike<UsageLike> | UsageLike | undefined)
    .then((u) => (u ? logWorkersAiUsage(env, { model, account: served, ...usageTokens(u) }) : undefined))
    .catch(() => {});

  return result;
}
