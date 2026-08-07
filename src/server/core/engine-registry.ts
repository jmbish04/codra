import type { EngineReviewResult, ReviewContext, ReviewEngine } from '@server/core/review-engine';
import { NativeEngine } from '@server/engines/native-engine';

/** Placeholder for Tasks 2-4: opencode/computer aren't provisioned yet.
 *  healthCheck=false keeps resolveEngine falling to native until the real
 *  engines land. */
class UnprovisionedEngine implements ReviewEngine {
  constructor(readonly name: 'opencode' | 'computer') {}
  async healthCheck(_signal?: AbortSignal) { return false; }
  async reviewPullRequest(_ctx: ReviewContext): Promise<EngineReviewResult> {
    throw new Error('engine not provisioned');
  }
}

export type EngineName = 'native' | 'opencode' | 'computer';
export type EngineFactory = () => ReviewEngine;

export const engineRegistry: Record<EngineName, EngineFactory> = {
  native: () => new NativeEngine(),
  opencode: () => new UnprovisionedEngine('opencode'),
  computer: () => new UnprovisionedEngine('computer'),
};

export function getEngineFactory(name: EngineName): EngineFactory {
  return engineRegistry[name];
}
