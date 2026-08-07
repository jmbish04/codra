import type { RepoConfig } from '@shared/schema';
import type { ReviewEngine } from '@server/core/review-engine';
import { NativeEngine } from '@server/engines/native-engine';
import { logger } from '@server/core/logger';
import { CircuitBreaker } from '@server/core/circuit-breaker';
import { withTimeout } from '@server/core/timeout';
import { engineRegistry, type EngineFactory, type EngineName } from '@server/core/engine-registry';

const HEALTHCHECK_TIMEOUT_MS = 2500;

/** Spec 1: only NativeEngine exists. opencode/computer requests degrade to
 *  native with a log line; Spec 2 swaps in the real engines + breaker demotion. */
export async function selectEngine(_env: Env, config: RepoConfig): Promise<ReviewEngine> {
  const requested = config.review.engine;
  if (requested === 'opencode' || requested === 'computer') {
    logger.info(`Engine '${requested}' not available in this build; using native.`);
  }
  return new NativeEngine();
}

function candidateOrder(requested: RepoConfig['review']['engine']): EngineName[] {
  if (requested === 'auto') return ['opencode', 'computer', 'native'];
  if (requested === 'native') return ['native'];
  return [requested, 'native'];
}

/** Breaker-aware engine selection. `nowMs` is injected (no Date.now here —
 *  the caller reads the clock at the non-deterministic boundary).
 *  `engines` defaults to the real registry; tests can override it. */
export async function resolveEngine(
  env: Env,
  config: RepoConfig,
  nowMs: number,
  engines: Record<EngineName, EngineFactory> = engineRegistry,
): Promise<ReviewEngine> {
  const candidates = candidateOrder(config.review.engine);

  for (const name of candidates) {
    if (name === 'native') return engines.native();

    const breaker = new CircuitBreaker(env.APP_KV, name);
    if (await breaker.isOpen(nowMs)) {
      logger.info(`Engine '${name}' breaker open; skipping.`);
      continue;
    }

    const engine = engines[name]();
    try {
      const healthy = await withTimeout(`${name} healthCheck`, HEALTHCHECK_TIMEOUT_MS, () => engine.healthCheck());
      if (healthy) return engine;
      await breaker.recordFailure(nowMs);
      logger.info(`Engine '${name}' unhealthy; demoting.`);
    } catch {
      await breaker.recordFailure(nowMs);
      logger.info(`Engine '${name}' healthCheck threw/timed out; demoting.`);
    }
  }

  // Should be unreachable — native is always the last candidate and always healthy.
  return engines.native();
}
