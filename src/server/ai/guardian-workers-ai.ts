/**
 * @fileoverview Guardian-routed Workers AI provider for the Vercel AI SDK.
 *
 * The codemode Durable Object agents (`RepoAgent`, `ReviewAgent`, and the
 * orchestrator `Chat`) drive the Vercel AI SDK (`generateText` / `streamText`)
 * with a Workers AI model. They used to bind `env.AI` directly via
 * `createWorkersAI({ binding: env.AI })` — the exact neuron-billed path Codra is
 * moving off.
 *
 * `workers-ai-provider` has no way to point at core-guardian natively (guardian
 * exposes no AI-SDK surface), but its REST mode accepts a custom `fetch`. We use
 * that hook: the provider builds a `.../ai/run/{model}` request in the native
 * Workers-AI wire format, and our interceptor reroutes it to guardian's AI
 * router (`POST /api/ai-router/run`, provider `workers-ai`) so the neuron spend
 * is attributed to the `codra` project, metered, and circuit-breaker gated. The
 * request never reaches api.cloudflare.com, so the placeholder `accountId` /
 * `apiKey` are unused.
 *
 * Response contract (verified against `workers-ai-provider`'s `createRun`):
 *   - non-stream → the provider reads `(await res.json()).result`, so we wrap
 *     guardian's `body` as `{ result: body }`.
 *   - stream → the provider returns `res.body` when the content-type is an
 *     event-stream, so we pass guardian's streamed SSE body straight through.
 *
 * NOTE: this DO codemode path exercises guardian's Workers-AI streaming proxy,
 * which cannot be verified by typecheck/build alone — smoke-test one chat turn
 * against live guardian after deploy.
 */

import { createWorkersAI } from 'workers-ai-provider';
import { getSecretStoreBinding } from '@server/utils/secrets';
import { GUARDIAN_PROJECT, GUARDIAN_BASE_URL } from '@server/core/guardian-ai';
import { logger } from '@server/core/logger';

const GUARDIAN_RUN_PATH = '/api/ai-router/run';

/** Pulls the `@cf/...` model id out of a `.../ai/run/{model}` REST URL. */
function modelFromRunUrl(url: string): string {
  const marker = '/ai/run/';
  const idx = url.indexOf(marker);
  const rest = idx >= 0 ? url.slice(idx + marker.length) : url;
  // Strip any query string; the model id itself may contain slashes.
  return decodeURIComponent(rest.split('?')[0]);
}

/**
 * Builds a Vercel AI SDK Workers-AI provider whose calls are transparently
 * rerouted through core-guardian. Drop-in replacement for
 * `createWorkersAI({ binding: env.AI })` — call the returned factory with a
 * Workers AI model id exactly as before.
 */
export function createGuardianWorkersAI(env: Pick<Env, 'AI_GATEWAY_TOKEN' | 'GUARDIAN'>) {
  const guardianFetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const model = modelFromRunUrl(url);

    // The provider serializes the native Workers-AI inputs as a JSON string body.
    // Guard the parse: a future AI-SDK that streams the request body would make
    // String(body) === "[object ReadableStream]" and throw opaquely here.
    const workersAiInput = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    const stream = workersAiInput?.stream === true;

    const aiToken = await getSecretStoreBinding(env, 'AI_GATEWAY_TOKEN');
    // Reach core-guardian over the service binding — no public HTTP hop.
    const guardianRes = await env.GUARDIAN.fetch(`${GUARDIAN_BASE_URL}${GUARDIAN_RUN_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${aiToken}` },
      body: JSON.stringify({
        project: GUARDIAN_PROJECT,
        importance: 'medium',
        provider: 'workers-ai',
        model,
        input: workersAiInput,
        stream,
      }),
      signal: (init?.signal ?? undefined) as AbortSignal | undefined,
    });

    if (!guardianRes.ok) {
      const errText = await guardianRes.text().catch(() => '<no body>');
      logger.warn(`Guardian Workers-AI proxy failed for ${model}`, { status: guardianRes.status, errText });
      // Surface the upstream status so the AI SDK raises a clear provider error.
      return new Response(errText, { status: guardianRes.status, headers: { 'content-type': 'application/json' } });
    }

    // Streaming: pass guardian's SSE body straight through — the provider keys
    // off the event-stream content-type.
    if (stream) {
      return new Response(guardianRes.body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }

    // Non-streaming: the AI router returns `{ body, tokens_in, ... }`; the
    // provider expects the Cloudflare REST envelope `{ result }`.
    const routed = (await guardianRes.json()) as { body?: unknown };
    return new Response(JSON.stringify({ result: routed.body, success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  // accountId/apiKey are placeholders — the custom fetch never reaches
  // api.cloudflare.com. REST mode is what unlocks the fetch hook.
  return createWorkersAI({ accountId: GUARDIAN_PROJECT, apiKey: 'guardian-proxied', fetch: guardianFetch });
}
