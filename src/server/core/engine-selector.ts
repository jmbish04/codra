import type { RepoConfig } from '@shared/schema';
import type { ReviewEngine } from '@server/core/review-engine';
import { NativeEngine } from '@server/engines/native-engine';
import { logger } from '@server/core/logger';

/** Spec 1: only NativeEngine exists. opencode/computer requests degrade to
 *  native with a log line; Spec 2 swaps in the real engines + breaker demotion. */
export async function selectEngine(_env: Env, config: RepoConfig): Promise<ReviewEngine> {
  const requested = config.review.engine;
  if (requested === 'opencode' || requested === 'computer') {
    logger.info(`Engine '${requested}' not available in this build; using native.`);
  }
  return new NativeEngine();
}
