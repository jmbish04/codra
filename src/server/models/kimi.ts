import { logger } from '@server/core/logger';
import type { AppBindings } from '@server/env';
import type { ModelResponse } from './gemma';
import { TimeoutError } from '@server/core/timeout';

/** Max wall-clock time allowed for a single Kimi/Workers-AI call (120 s). */
const KIMI_TIMEOUT_MS = 120_000;

export async function reviewWithKimi(
  env: Pick<AppBindings, 'AI'>,
  input: { systemPrompt: string; userPrompt: string },
) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError('Kimi (Workers AI)', KIMI_TIMEOUT_MS)), KIMI_TIMEOUT_MS);
  });

  try {
    logger.info('Calling AI model: @cf/moonshotai/kimi-k2.5');
    const startTime = Date.now();
    const result = await Promise.race([
      env.AI.run('@cf/moonshotai/kimi-k2.5', {
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.userPrompt },
        ],
        max_completion_tokens: 4096,
      }),
      timeoutPromise,
    ]);
    const durationMs = Date.now() - startTime;
    logger.info(`AI model @cf/moonshotai/kimi-k2.5 responded in ${durationMs}ms`);

    const rawText =
      result?.response ??
      result?.result?.response ??
      result?.choices?.[0]?.message?.content ??
      (typeof result === 'string' ? result : JSON.stringify(result));

    return {
      rawText,
      inputTokens: result?.usage?.prompt_tokens ?? result?.result?.usage?.prompt_tokens ?? 0,
      outputTokens: result?.usage?.completion_tokens ?? result?.result?.usage?.completion_tokens ?? 0,
      modelUsed: '@cf/moonshotai/kimi-k2.5',
    } satisfies ModelResponse;
  } finally {
    clearTimeout(timer);
  }
}
