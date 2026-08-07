import type { ReviewEngine } from '@server/core/review-engine';
import { NativeEngine } from '@server/engines/native-engine';
import { OpenCodeEngine } from '@server/engines/opencode-engine';
import { ComputerEngine } from '@server/engines/computer-engine';

export type EngineName = 'native' | 'opencode' | 'computer';
export type EngineFactory = (env: Env) => ReviewEngine;

/** The real engines, always constructed. Each self-gates via isConfigured(env)
 *  (checked by resolveEngine BEFORE any KV/healthCheck I/O) — OpenCodeEngine
 *  needs OPENCODE_VPC/OPENCODE_TUNNEL_URL, ComputerEngine needs
 *  COMPUTER_WORKSPACE. With no bindings provisioned, isConfigured is false,
 *  so both are skipped and resolveEngine falls straight to native: zero
 *  behavior/production change until the infra is actually bound. */
export const engineRegistry: Record<EngineName, EngineFactory> = {
  native: () => new NativeEngine(),
  opencode: (env) => new OpenCodeEngine(env),
  computer: (env) => new ComputerEngine(env),
};

export function getEngineFactory(name: EngineName): EngineFactory {
  return engineRegistry[name];
}
