/**
 * @fileoverview Codra's single entry point for ALL AI inference.
 *
 * Codra does not call Workers AI, provider SDKs, or AI Gateway directly. Every
 * AI call is proxied through the `core-guardian` worker over a Cloudflare
 * service binding (RPC/fetch — no public internet). core-guardian is our own AI
 * gateway: it owns provider/model selection, the cheapest-first fallback chain
 * (Ollama Cloud → freebie providers → paid), metering, budgets, and circuit
 * breaking. Codra only says *what* it wants (task + importance + prompt); guardian
 * decides *how* to serve it.
 *
 * Auth: the `AI_GATEWAY_TOKEN` secret-store binding (secret `CLOUDFLARE_AI_GATEWAY_TOKEN`).
 * Routing: `task` + `importance` let guardian prioritize and pick a model
 * (`model: 'auto'`); guardian's task routing may retarget the provider/model.
 */
import { getSecretStoreBinding } from '@server/utils/secrets';
import { logApiUsage } from '@server/db/api-usage';
import { logger } from '@server/core/logger';
import { ProviderRequestError, type ModelResponse, type StructuredSchema } from '@server/models/types';

/** Codra's project id in guardian — usage/budgets are tracked against it. */
const GUARDIAN_PROJECT = 'codra';
/**
 * Preferred provider hint; guardian's resolver + task routing pick the actual
 * model (`model: 'auto'`). Ollama Cloud is the strongest/cheapest for coding, so
 * it leads; guardian falls back across providers on its own.
 */
const DEFAULT_PROVIDER = 'ollama';
const DEFAULT_MODEL = 'auto';
/** Service bindings ignore the host; this is a placeholder origin. */
const GUARDIAN_ORIGIN = 'https://core-guardian';

export type GuardianImportance = 'low' | 'medium' | 'high';
export type GuardianTask = 'CODE_REVIEW' | 'CHANGELOG' | 'SUMMARY' | 'PLAN_REVIEW' | 'MERGE_REVIEW';

export type GuardianEnv = Pick<Env, 'GUARDIAN' | 'AI_GATEWAY_TOKEN' | 'DB'>;

/** Shape returned by `POST /api/ai-router/run`. `body` is the provider's raw reply. */
type RunResult = {
  request_uuid: string;
  status: number;
  provider: string;
  model: string;
  mode: string;
  gateway: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  body: unknown;
};

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Pulls assistant text out of whatever provider shape guardian returns. */
export function extractGuardianText(body: unknown): string | null {
  // OpenAI / Ollama-compatible chat completions.
  if (isRecord(body) && Array.isArray(body.choices)) {
    const message = isRecord(body.choices[0]) ? body.choices[0].message : null;
    const content = isRecord(message) ? message.content : null;
    const text = asText(content);
    if (text) return text;
  }
  // Workers AI native ({ response } or { result: { response } }).
  const direct = asText(isRecord(body) ? body.response : null);
  if (direct) return direct;
  const nested = isRecord(body) && isRecord(body.result) ? asText(body.result.response) : null;
  if (nested) return nested;
  // Gemini native.
  if (isRecord(body) && Array.isArray(body.candidates)) {
    const content = isRecord(body.candidates[0]) ? body.candidates[0].content : null;
    const parts = isRecord(content) && Array.isArray(content.parts) ? content.parts : null;
    const text = parts?.map((p) => (isRecord(p) ? asText(p.text) : null) ?? '').join('').trim();
    if (text) return text;
  }
  return null;
}

/**
 * Runs one inference through core-guardian and returns the raw result. Throws a
 * retryable {@link ProviderRequestError} on any non-2xx so the model service
 * treats guardian outages as transient.
 */
async function guardianRun(
  env: GuardianEnv,
  opts: {
    task: GuardianTask;
    importance: GuardianImportance;
    input: unknown;
    provider?: string;
    model?: string;
    stream?: boolean;
  },
): Promise<RunResult> {
  const token = await getSecretStoreBinding(env, 'AI_GATEWAY_TOKEN');
  const res = await env.GUARDIAN.fetch(`${GUARDIAN_ORIGIN}/api/ai-router/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      project: GUARDIAN_PROJECT,
      task: opts.task,
      importance: opts.importance,
      provider: opts.provider ?? DEFAULT_PROVIDER,
      model: opts.model ?? DEFAULT_MODEL,
      input: opts.input,
      stream: opts.stream ?? false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ProviderRequestError('core-guardian', res.status, body.slice(0, 300), true);
  }
  return (await res.json()) as RunResult;
}

/** Builds a chat `input` payload with an optional strict JSON-schema contract. */
function buildChatInput(messages: ChatMessage[], schema?: StructuredSchema) {
  return {
    messages,
    temperature: 0,
    ...(schema
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: { name: schema.name, strict: true, schema: schema.schema },
          },
        }
      : {}),
  };
}

/** Logs a guardian call to D1 against the provider/model guardian actually used. */
async function logGuardianUsage(env: GuardianEnv, run: RunResult) {
  await logApiUsage(env, {
    provider: run.provider || 'core-guardian',
    model: run.model || 'auto',
    promptTokens: run.tokens_in ?? 0,
    completionTokens: run.tokens_out ?? 0,
    source: 'local',
  }).catch((err) => logger.warn('Failed to log guardian usage', err));
}

/**
 * Structured review inference. Sends the system/user prompts + JSON-schema
 * contract through guardian and returns a {@link ModelResponse}. Throws a
 * retryable error when guardian returns no usable text.
 */
export async function reviewViaGuardian(
  env: GuardianEnv,
  params: {
    input: { systemPrompt: string; userPrompt: string };
    schema: StructuredSchema;
    task?: GuardianTask;
    importance?: GuardianImportance;
  },
): Promise<ModelResponse> {
  const task = params.task ?? 'CODE_REVIEW';
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${params.input.systemPrompt}\n\nReturn only the JSON object. Do not include chain-of-thought, analysis, markdown, code fences, or explanatory prose.`,
    },
    { role: 'user', content: `${params.input.userPrompt}\n\nRespond with the required JSON object only.` },
  ];

  const run = await guardianRun(env, {
    task,
    importance: params.importance ?? 'medium',
    input: buildChatInput(messages, params.schema),
  });

  const rawText = extractGuardianText(run.body);
  if (!rawText) {
    throw new ProviderRequestError('core-guardian', 502, `returned no parseable content for ${task}`, true);
  }

  await logGuardianUsage(env, run);
  return {
    rawText,
    inputTokens: run.tokens_in ?? 0,
    outputTokens: run.tokens_out ?? 0,
    modelUsed: run.model || 'auto',
    provider: run.provider || 'core-guardian',
  };
}

/**
 * Free-text generation through guardian (no JSON-schema contract). For prompts
 * whose reply is parsed loosely by the caller (plan/merge review verdicts,
 * summary comments). Returns the assistant text.
 */
export async function generateViaGuardian(
  env: GuardianEnv,
  params: { system?: string; prompt: string; task: GuardianTask; importance?: GuardianImportance },
): Promise<string> {
  const messages: ChatMessage[] = [
    ...(params.system ? [{ role: 'system' as const, content: params.system }] : []),
    { role: 'user' as const, content: params.prompt },
  ];
  const run = await guardianRun(env, {
    task: params.task,
    importance: params.importance ?? 'medium',
    input: buildChatInput(messages),
  });
  await logGuardianUsage(env, run);
  return extractGuardianText(run.body) ?? '';
}
