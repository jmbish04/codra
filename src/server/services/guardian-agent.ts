/**
 * @fileoverview Agentic AI (tool-calling loops) through core-guardian, using the
 * OpenAI Agents SDK — NOT the Cloudflare Agents SDK.
 *
 * Why: Cloudflare Agents SDK (AIChatAgent / Agent) runs in Durable Objects. A
 * long-running or looping agent in a DO bills DO wall-time and can produce very
 * large surprise bills. The OpenAI Agents SDK runs the agent loop in plain Worker
 * code (request/queue context) with no Durable Object, so there is no DO wall-time
 * to run away.
 *
 * How: the agent's model is an OpenAI-compatible model whose base URL is
 * core-guardian, reached over the GUARDIAN **service binding** (no public
 * internet). Codra names no provider/model — routing intent (task, use_case,
 * reasoning, complexity, importance) rides as `x-guardian-*` request headers, and
 * guardian routes to the best-available service at the lowest cost.
 *
 * REQUIRES a guardian-side OpenAI-compatible endpoint that does not exist yet:
 *   POST {GUARDIAN}/openai/v1/chat/completions
 * reading the `x-guardian-*` headers. Tracked in the core-guardian issue this PR
 * opens. Until it ships, these calls 404 (Codra is on ice) — the shape is what
 * matters here.
 */
import { Agent, run, OpenAIProvider, type Tool } from '@openai/agents';
import OpenAI from 'openai';
import { getSecretStoreBinding } from '@server/utils/secrets';
import { logger } from '@server/core/logger';
import {
  GUARDIAN_ORIGIN_URL,
  GUARDIAN_PROJECT_ID,
  routingForTask,
  type GuardianRouting,
  type GuardianTask,
} from '@server/services/guardian';

/** core-guardian's OpenAI-compatible surface (to be implemented guardian-side). */
const GUARDIAN_OPENAI_BASE = `${GUARDIAN_ORIGIN_URL}/openai/v1`;
/** Placeholder model id; guardian ignores it and routes from the headers. */
const ROUTED_MODEL = 'auto';

export type GuardianAgentEnv = Pick<Env, 'GUARDIAN' | 'AI_GATEWAY_TOKEN'>;

/**
 * Builds an OpenAI-compatible model provider whose transport is the GUARDIAN
 * service binding, carrying the routing intent as `x-guardian-*` headers.
 */
async function guardianModelProvider(
  env: GuardianAgentEnv,
  task: GuardianTask,
  routing: GuardianRouting,
): Promise<OpenAIProvider> {
  const token = await getSecretStoreBinding(env, 'AI_GATEWAY_TOKEN');
  const client = new OpenAI({
    apiKey: token,
    baseURL: GUARDIAN_OPENAI_BASE,
    // Route worker-to-worker over the service binding instead of the internet.
    fetch: ((input: any, init: any) => env.GUARDIAN.fetch(input, init)) as unknown as typeof fetch,
    defaultHeaders: {
      'x-guardian-project': GUARDIAN_PROJECT_ID,
      'x-guardian-task': task,
      'x-guardian-use-case': routing.useCase,
      'x-guardian-reasoning': routing.reasoning,
      'x-guardian-complexity': routing.complexity,
      'x-guardian-importance': routing.importance,
    },
  });
  // useResponses:false → Chat Completions (the surface guardian will implement).
  return new OpenAIProvider({ openAIClient: client as any, useResponses: false });
}

/**
 * Runs a tool-calling agent loop through core-guardian and returns the final
 * text. Runs in the caller's Worker context — no Durable Object.
 */
export async function runGuardianAgent(
  env: GuardianAgentEnv,
  opts: {
    task: GuardianTask;
    name: string;
    instructions: string;
    input: string;
    tools?: Tool[];
    routing?: Partial<GuardianRouting>;
  },
): Promise<string> {
  const provider = await guardianModelProvider(env, opts.task, routingForTask(opts.task, opts.routing));
  const model = await provider.getModel(ROUTED_MODEL);
  const agent = new Agent({
    name: opts.name,
    instructions: opts.instructions,
    tools: opts.tools ?? [],
    model,
  });

  const result = await run(agent, opts.input);
  const text = typeof result.finalOutput === 'string' ? result.finalOutput : JSON.stringify(result.finalOutput ?? '');
  logger.info(`Guardian agent '${opts.name}' completed`, { task: opts.task });
  return text;
}

/** Extracts the latest user message's text from an AIChatAgent message list. */
export function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  const last = messages[messages.length - 1] as { content?: unknown; parts?: unknown };
  if (typeof last?.content === 'string') return last.content;
  if (Array.isArray(last?.parts)) {
    return last.parts.map((p) => (p && typeof (p as any).text === 'string' ? (p as any).text : '')).join('').trim();
  }
  return '';
}
