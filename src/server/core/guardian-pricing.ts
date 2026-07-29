import { getWorkerApiKey } from '@server/utils/secrets';
import { logger } from './logger';
import { withTimeout } from './timeout';

// Guardian is best-effort context on the review hot path — never let a slow
// pricing endpoint stall a review; time out and fall back to public rates.
const GUARDIAN_FETCH_TIMEOUT_MS = 5000;

/**
 * Price multipliers for a review, sourced from the core-guardian worker:
 *   GET /api/ai-models        -> per-million-token model pricing
 *   GET /api/guardian/pricing -> Cloudflare overage rates (DO, D1, ...)
 * Authenticated with WORKER_API_KEY (X-API-Key), cached in APP_KV so it costs
 * ~0 subrequests per file. If guardian is unreachable we fall back to public
 * Cloudflare list prices so a review never breaks on a pricing outage.
 */

const GUARDIAN_BASE_URL = 'https://core-guardian.hacolby.workers.dev';
const CACHE_KEY = 'guardian:pricing:v1';
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6h — rates change monthly at most.

// Usage types tracked per file review. AI tokens dominate cost; the infra types
// are metered but rounding-level in dollars.
export const USAGE_TYPES = [
  'ai_input_tokens',
  'ai_output_tokens',
  'do_requests',
  'do_duration_gbs',
  'd1_rows_read',
  'd1_rows_written',
  'subrequests',
] as const;
export type UsageType = (typeof USAGE_TYPES)[number];

export interface Rate {
  unitPrice: number; // USD per `perUnits` units
  perUnits: number;
  currency: string;
}

export interface ModelRate {
  input: Rate;
  output: Rate;
  cachedInput: Rate | null;
}

export interface PricingSnapshot {
  source: 'core-guardian' | 'fallback';
  pricedAt: number; // epoch ms
  models: Record<string, ModelRate>; // keyed by model id and apiModelName
  infra: Record<string, Rate>; // keyed by infra UsageType
}

// Public Cloudflare paid-plan overage list prices (per 1M units) + WorkersAI is
// billed elsewhere, so unknown-model token rates fall to 0 rather than a guess.
const FALLBACK_INFRA: Record<string, Rate> = {
  do_requests: { unitPrice: 0.15, perUnits: 1_000_000, currency: 'USD' },
  do_duration_gbs: { unitPrice: 12.5, perUnits: 1_000_000, currency: 'USD' },
  d1_rows_read: { unitPrice: 0.001, perUnits: 1_000_000, currency: 'USD' },
  d1_rows_written: { unitPrice: 1.0, perUnits: 1_000_000, currency: 'USD' },
  subrequests: { unitPrice: 0, perUnits: 1, currency: 'USD' },
};

const ZERO_RATE: Rate = { unitPrice: 0, perUnits: 1, currency: 'USD' };

function fallbackSnapshot(pricedAt: number): PricingSnapshot {
  return { source: 'fallback', pricedAt, models: {}, infra: { ...FALLBACK_INFRA } };
}

/** cost = amount / perUnits * unitPrice. The one place money is multiplied. */
export function computeCost(amount: number, rate: Rate): number {
  if (!rate || !rate.perUnits) return 0;
  return (amount / rate.perUnits) * rate.unitPrice;
}

// Normalize a model id for loose matching (strip `@cf/` and provider prefixes).
function normKey(id: string): string {
  return id.toLowerCase().replace(/^@?cf\//, '').replace(/^[^/]+\//, '').trim();
}

export function lookupModelRate(snapshot: PricingSnapshot, modelUsed: string | null | undefined): ModelRate | null {
  if (!modelUsed) return null;
  const direct = snapshot.models[modelUsed] ?? snapshot.models[normKey(modelUsed)];
  if (direct) return direct;
  const target = normKey(modelUsed);
  for (const [key, rate] of Object.entries(snapshot.models)) {
    if (normKey(key) === target) return rate;
  }
  return null;
}

export interface UsageAmounts {
  aiInputTokens: number;
  aiOutputTokens: number;
  doRequests: number;
  doDurationGbs: number;
  d1RowsRead: number;
  d1RowsWritten: number;
  subrequests: number;
}

export interface CostRow {
  usageType: UsageType;
  usageAmount: number;
  unitPrice: number;
  perUnits: number;
  currency: string;
  totalCost: number;
  rateSource: string;
  pricedAt: number;
}

/**
 * Turn metered usage amounts into a per-usage-type cost breakdown using the
 * snapshot's rates. Pure — this is what the unit test exercises.
 */
export function buildCostBreakdown(
  snapshot: PricingSnapshot,
  modelUsed: string | null | undefined,
  usage: UsageAmounts,
): CostRow[] {
  const modelRate = lookupModelRate(snapshot, modelUsed);
  const infra = snapshot.infra;
  const pairs: Array<[UsageType, number, Rate]> = [
    ['ai_input_tokens', usage.aiInputTokens, modelRate?.input ?? ZERO_RATE],
    ['ai_output_tokens', usage.aiOutputTokens, modelRate?.output ?? ZERO_RATE],
    ['do_requests', usage.doRequests, infra.do_requests ?? FALLBACK_INFRA.do_requests],
    ['do_duration_gbs', usage.doDurationGbs, infra.do_duration_gbs ?? FALLBACK_INFRA.do_duration_gbs],
    ['d1_rows_read', usage.d1RowsRead, infra.d1_rows_read ?? FALLBACK_INFRA.d1_rows_read],
    ['d1_rows_written', usage.d1RowsWritten, infra.d1_rows_written ?? FALLBACK_INFRA.d1_rows_written],
    ['subrequests', usage.subrequests, infra.subrequests ?? FALLBACK_INFRA.subrequests],
  ];
  return pairs.map(([usageType, usageAmount, rate]) => ({
    usageType,
    usageAmount,
    unitPrice: rate.unitPrice,
    perUnits: rate.perUnits,
    currency: rate.currency,
    totalCost: computeCost(usageAmount, rate),
    rateSource: snapshot.source,
    pricedAt: snapshot.pricedAt,
  }));
}

export function sumBreakdown(rows: CostRow[]): number {
  return rows.reduce((total, row) => total + row.totalCost, 0);
}

// --- guardian fetch + normalization ---------------------------------------

interface AiModelsResponse {
  scrapedAt: number | null;
  models: Array<{
    provider: string;
    model: string;
    apiModelName: string;
    inputPricePerMillion: number | null;
    outputPricePerMillion: number | null;
    cachedInputPricePerMillion: number | null;
    currency: string;
  }>;
}

interface GuardianPricingResponse {
  rates: Array<{
    product: string;
    metric: string;
    unitPrice: number;
    perUnits: number;
    currency: string;
    included: number | null;
  }>;
  lastScrapedAt: number | null;
}

function matchInfraKey(product: string, metric: string): UsageType | null {
  const p = product.toLowerCase();
  const m = metric.toLowerCase();
  if (p.includes('durable object')) {
    if (m.includes('request')) return 'do_requests';
    if (m.includes('duration') || m.includes('gb')) return 'do_duration_gbs';
  }
  if (p.includes('d1')) {
    if (m.includes('read')) return 'd1_rows_read';
    if (m.includes('written') || m.includes('write')) return 'd1_rows_written';
  }
  if (m.includes('subrequest')) return 'subrequests';
  return null;
}

async function guardianGet<T>(env: Env, path: string): Promise<T> {
  const key = await getWorkerApiKey(env);
  const res = await withTimeout(`guardian ${path}`, GUARDIAN_FETCH_TIMEOUT_MS, (signal) =>
    fetch(`${GUARDIAN_BASE_URL}${path}`, {
      headers: { 'X-API-Key': key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal,
    }),
  );
  if (!res.ok) throw new Error(`guardian ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

async function fetchGuardianSnapshot(env: Env, pricedAt: number): Promise<PricingSnapshot> {
  const [aiModels, pricing] = await Promise.all([
    guardianGet<AiModelsResponse>(env, '/api/ai-models'),
    guardianGet<GuardianPricingResponse>(env, '/api/guardian/pricing'),
  ]);

  const models: Record<string, ModelRate> = {};
  for (const m of aiModels.models ?? []) {
    const currency = m.currency || 'USD';
    const rate: ModelRate = {
      input: { unitPrice: m.inputPricePerMillion ?? 0, perUnits: 1_000_000, currency },
      output: { unitPrice: m.outputPricePerMillion ?? 0, perUnits: 1_000_000, currency },
      cachedInput: m.cachedInputPricePerMillion != null
        ? { unitPrice: m.cachedInputPricePerMillion, perUnits: 1_000_000, currency }
        : null,
    };
    if (m.model) models[m.model] = rate;
    if (m.apiModelName) models[m.apiModelName] = rate;
  }

  const infra: Record<string, Rate> = { ...FALLBACK_INFRA };
  for (const r of pricing.rates ?? []) {
    const key = matchInfraKey(r.product, r.metric);
    if (key) infra[key] = { unitPrice: r.unitPrice, perUnits: r.perUnits || 1, currency: r.currency || 'USD' };
  }

  return { source: 'core-guardian', pricedAt, models, infra };
}

/**
 * Get the pricing snapshot for this review. Reads APP_KV first; on a miss,
 * fetches guardian (2 subrequests) and caches for 6h. Any failure degrades to
 * public fallback rates so reviews are never blocked on pricing.
 */
export async function getPricingSnapshot(env: Env, nowMs: number): Promise<PricingSnapshot> {
  try {
    const cached = await env.APP_KV.get(CACHE_KEY);
    if (cached) return JSON.parse(cached) as PricingSnapshot;
  } catch (err) {
    logger.warn('Failed to read cached guardian pricing', err);
  }

  try {
    const snapshot = await fetchGuardianSnapshot(env, nowMs);
    try {
      await env.APP_KV.put(CACHE_KEY, JSON.stringify(snapshot), { expirationTtl: CACHE_TTL_SECONDS });
    } catch (err) {
      logger.warn('Failed to cache guardian pricing', err);
    }
    return snapshot;
  } catch (err) {
    logger.warn('Guardian pricing unavailable; using fallback rates', err);
    return fallbackSnapshot(nowMs);
  }
}
