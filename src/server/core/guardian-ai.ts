/**
 * @fileoverview Codra's single ingress for AI inference: core-guardian.
 *
 * Per the machine-wide mandate (see repo `AGENTS.md`), **every** AI call Codra
 * makes routes through the core-guardian worker
 * (https://core-guardian.hacolby.workers.dev). Guardian meters spend, enforces
 * per-project budgets, and gates calls behind a circuit breaker — a direct
 * provider call (or a raw `env.AI.run`) is invisible to the budget and cannot
 * be killed, which is exactly the aggressive-billing exposure this module
 * removes.
 *
 * This adapter wraps the org's canonical vendored client
 * ([guardian-client.ts](../../lib/guardian/guardian-client.ts)) with:
 *   - Codra identity: `project: "codra"`, sourced once and cached per `env`.
 *   - Codra's existing Secrets Store bindings as the two token audiences:
 *       * `AI_GATEWAY_TOKEN`  (= `CLOUDFLARE_AI_GATEWAY_TOKEN`) → `/api/ai-router/run`
 *       * `WORKER_API_KEY`    → usage-register / budget reads
 *     No new secrets are required — both bindings already exist in
 *     [wrangler.jsonc](../../../wrangler.jsonc).
 *   - Provider-slug mapping from Codra's `apiFormat` to the AI-Gateway provider
 *     slugs guardian routes on.
 *   - Circuit-breaker / transient-failure translation into
 *     {@link RetryableModelError} so the model chain falls back instead of
 *     hard-failing a review.
 *
 * The provider modules under `src/server/models/*` keep owning request-body
 * construction and response parsing; this module owns *transport only*.
 */

import { GuardianClient, GuardianError, type Importance, type RunResult } from '../../lib/guardian/guardian-client';
import { getSecretStoreBinding } from '@server/utils/secrets';
import { logger } from './logger';
import { RetryableModelError } from '@server/services/model-errors';

/** The project identity every metered call is attributed to. */
export const GUARDIAN_PROJECT = 'codra';
/**
 * Neutral host for guardian requests. Codra reaches core-guardian over the
 * `GUARDIAN` Workers **service binding** (see wrangler.jsonc), not the public
 * internet — the binding routes by path and ignores the host, so this is just a
 * placeholder that keeps the request a valid URL.
 */
export const GUARDIAN_BASE_URL = 'https://guardian';

/** Codra's internal provider formats, as stored on a resolved model config. */
export type CodraApiFormat = 'openai' | 'anthropic' | 'gemini' | 'cloudflare-workers-ai';

/**
 * Maps a Codra `apiFormat` to the provider slug guardian routes on in
 * AI-Gateway (`gateway`) mode. These are the Cloudflare AI Gateway provider
 * slugs — guardian injects the model into the upstream request, so callers pass
 * the native body WITHOUT a `model` field.
 */
const PROVIDER_SLUG: Record<CodraApiFormat, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'google-ai-studio',
  'cloudflare-workers-ai': 'workers-ai',
};

export function guardianProviderSlug(apiFormat: CodraApiFormat): string {
  return PROVIDER_SLUG[apiFormat];
}

/**
 * A guardian inference result normalized for Codra's model layer. `body` is the
 * upstream provider's native response (parsed by the calling provider module);
 * token counts and cost come from guardian's own metering.
 */
export interface GuardianInferenceResult {
  body: unknown;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  provider: string;
  model: string;
  requestUuid: string;
}

/**
 * Lazily-built, per-`env` guardian client cache. `.get()` on a Secrets Store
 * binding is cheap and runtime-cached, but a WeakMap keyed on `env` still saves
 * repeated token resolution across a fan-out of file reviews in one invocation.
 */
const clientCache = new WeakMap<object, Promise<GuardianClient>>();

async function getGuardianClient(env: Env): Promise<GuardianClient> {
  const cached = clientCache.get(env as unknown as object);
  if (cached) return cached;

  const build = (async () => {
    const [aiToken, apiKey] = await Promise.all([
      getSecretStoreBinding(env, 'AI_GATEWAY_TOKEN'),
      getSecretStoreBinding(env, 'WORKER_API_KEY'),
    ]);
    return new GuardianClient({
      project: GUARDIAN_PROJECT,
      baseUrl: GUARDIAN_BASE_URL,
      aiToken,
      apiKey,
      // Reach core-guardian over the service binding — no public HTTP hop. The
      // client's fetch is swapped for the binding's; auth stays the Bearer token.
      fetch: env.GUARDIAN.fetch.bind(env.GUARDIAN),
    });
  })();

  // Never cache a REJECTED build: a transient Secret Store `.get()` failure must
  // not poison this isolate into failing every subsequent inference. Evict on
  // rejection so the next call rebuilds.
  build.catch(() => clientCache.delete(env as unknown as object));
  clientCache.set(env as unknown as object, build);
  return build;
}

/**
 * Turns a guardian failure into the model layer's retry vocabulary. Circuit
 * breaker (429) and transient 5xx / network errors become
 * {@link RetryableModelError} so the model chain advances to the next model;
 * everything else rethrows unchanged.
 */
function translateGuardianError(err: unknown, provider: string, model: string): never {
  if (err instanceof GuardianError) {
    if (err.isCircuitBreaker) {
      throw new RetryableModelError(
        `core-guardian circuit breaker open for ${provider}/${model}: ${err.circuitBrokenMessage ?? 'budget or breaker tripped'}`,
        err,
      );
    }
    if (err.status >= 500 || err.status === 408 || err.status === 429) {
      throw new RetryableModelError(`core-guardian ${err.status} for ${provider}/${model}`, err);
    }
  }
  throw err;
}

/**
 * Route one inference through guardian's AI router (`POST /api/ai-router/run`).
 *
 * @param env         Worker env (needs `AI_GATEWAY_TOKEN` + `WORKER_API_KEY`).
 * @param apiFormat   Codra provider format; mapped to a guardian provider slug.
 * @param model       Upstream model id (guardian injects it into the request).
 * @param input       The provider-native request body, WITHOUT `model`.
 * @param opts        Optional importance override + subrequest tracker.
 */
export async function runGuardianInference(
  env: Env,
  apiFormat: CodraApiFormat,
  model: string,
  input: unknown,
  opts: { importance?: Importance; tracker?: { incrementSubrequests(count?: number): void } } = {},
): Promise<GuardianInferenceResult> {
  const provider = guardianProviderSlug(apiFormat);
  opts.tracker?.incrementSubrequests(1);

  let result: RunResult;
  try {
    // Client build (secret resolution) is inside the try so a build failure also
    // routes through translateGuardianError instead of propagating raw.
    const client = await getGuardianClient(env);
    result = await client.ai.run({
      provider,
      model,
      input,
      importance: opts.importance ?? 'medium',
    });
  } catch (err) {
    logger.warn(`core-guardian inference failed for ${provider}/${model}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    translateGuardianError(err, provider, model);
  }

  // A non-2xx upstream status is surfaced by guardian in `status`. 5xx/408/429
  // are transient → retry down the chain; other 4xx (bad request / auth) are
  // permanent → fail non-retryably rather than burning fallback attempts on a
  // request every model will reject identically.
  if (result.status && result.status >= 400) {
    if (result.status >= 500 || result.status === 408 || result.status === 429) {
      throw new RetryableModelError(`core-guardian upstream ${result.status} for ${provider}/${model}`);
    }
    throw new Error(`core-guardian upstream ${result.status} for ${provider}/${model}`);
  }

  return {
    body: result.body,
    tokensIn: result.tokens_in ?? 0,
    tokensOut: result.tokens_out ?? 0,
    costUsd: result.cost_usd ?? 0,
    provider: result.provider ?? provider,
    model: result.model ?? model,
    requestUuid: result.request_uuid,
  };
}

/**
 * Register out-of-band usage (e.g. an AI-SDK streaming call whose tokens Codra
 * counts itself) with guardian so it lands in the same metered ledger. Best
 * effort — never let a metering write break the caller.
 */
export async function registerGuardianUsage(
  env: Env,
  usage: { provider: string; model: string; tokensIn?: number; tokensOut?: number; operationId?: string; taskDescription?: string },
): Promise<void> {
  try {
    const client = await getGuardianClient(env);
    await client.usage.register(usage);
  } catch (err) {
    logger.warn('core-guardian usage.register failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
