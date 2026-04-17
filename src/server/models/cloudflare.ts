import { logger } from '@server/core/logger';
import type { AppBindings } from '@server/env';
import { TimeoutError } from '@server/core/timeout';
import type { ModelResponse } from './types';

/** Max wall-clock time allowed for a single Workers-AI call (600 s). */
const CLOUDFLARE_TIMEOUT_MS = 600_000;

export async function reviewWithCloudflare(
  env: Pick<AppBindings, 'AI'>,
  model: string,
  input: { systemPrompt: string; userPrompt: string },
): Promise<ModelResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`Cloudflare (${model})`, CLOUDFLARE_TIMEOUT_MS)), CLOUDFLARE_TIMEOUT_MS);
  });

  try {
    logger.info(`Calling Cloudflare model: ${model}`);
    const startTime = Date.now();
    const result = await Promise.race([
      env.AI.run(model as any, {
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.userPrompt },
        ],
        max_completion_tokens: 4096,
      }),
      timeoutPromise,
    ]);
    const durationMs = Date.now() - startTime;
    logger.info(`AI model ${model} responded in ${durationMs}ms`);

    const rawText =
      result?.response ??
      result?.result?.response ??
      result?.choices?.[0]?.message?.content ??
      (typeof result === 'string' ? result : JSON.stringify(result));

    return {
      rawText,
      inputTokens: result?.usage?.prompt_tokens ?? result?.result?.usage?.prompt_tokens ?? 0,
      outputTokens: result?.usage?.completion_tokens ?? result?.result?.usage?.completion_tokens ?? 0,
      modelUsed: model,
      provider: 'cloudflare',
    };
  } finally {
    clearTimeout(timer);
  }
}
