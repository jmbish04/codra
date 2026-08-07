import type { RepoConfig } from '@shared/schema';
import type { ReviewEngine } from '@server/core/review-engine';
import { NativeEngine } from '@server/engines/native-engine';
import { logger } from '@server/core/logger';
import { CircuitBreaker } from '@server/core/circuit-breaker';
import { engineRegistry, type EngineFactory, type EngineName } from '@server/core/engine-registry';

const HEALTHCHECK_TIMEOUT_MS = 2500;

/** Bounds a healthCheck() call to `ms` even if the implementation ignores
 *  the abort signal (e.g. a hung network call). withTimeout (timeout.ts)
 *  only aborts the signal — it doesn't reject on its own unless the callee
 *  honors the signal — so a genuinely hung promise needs an explicit race
 *  against a timer here. The signal is still passed through so well-behaved
 *  (fetch-based) engines can cancel early. */
function healthCheckWithHardTimeout(engine: ReviewEngine, ms: number): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${engine.name} healthCheck timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([engine.healthCheck(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

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
      const healthy = await healthCheckWithHardTimeout(engine, HEALTHCHECK_TIMEOUT_MS);
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
