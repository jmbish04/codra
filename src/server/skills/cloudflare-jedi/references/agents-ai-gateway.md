# Agents SDK + AI Gateway + assistant-ui

Two integration patterns for chat UIs on this stack, in order of preference:

1. **Cloudflare Agents + assistant-ui (canonical)** — stateful chat with a Durable-Object-backed `AIChatAgent`, WebSocket streaming, server-side SQLite history, native tool calling. Use this for any chat surface that needs persistence, multi-turn tool use, or per-user history.
2. **Stateless Hono `/chat` + assistant-ui (fallback)** — POST a `messages[]` array to a Hono route that runs `streamText` and returns a data-stream response. Use this only for ephemeral one-shot completions (a single-pane "summarize this" widget, a code-generation prompt without history, an embedded ask box).

assistant-ui does **not** ship a `@assistant-ui/react-cloudflare-agents` package. The bridge is structural: `@cloudflare/ai-chat`'s `useAgentChat` returns a superset of the AI SDK's `useChat`, so `useAISDKRuntime` from `@assistant-ui/react-ai-sdk` consumes it directly. No adapter layer.

---

## Required Packages

```bash
# Server (Worker)
pnpm add agents@0.12.4 @cloudflare/ai-chat@0.7.0
pnpm add ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google
pnpm add @cloudflare/ai-sdk-provider           # Workers AI provider for the AI SDK

# Client (Astro React island)
pnpm add agents@0.12.4 @cloudflare/ai-chat@0.7.0
pnpm add @assistant-ui/react @assistant-ui/react-ai-sdk
```

> **Pin `agents` and `@cloudflare/ai-chat` to exact versions.** Both are pre-1.0 and ship breaking changes between minor releases. The `useAgentChat` return shape has been additive since 0.3.0, so the integration below should keep working across patch releases — but read the Cloudflare changelog before bumping minor. Pin in `package.json` (no `^`, no `~`).

---

## wrangler.toml Bindings

```toml
[ai]
binding = "AI"

# Durable Object for the chat agent
[[durable_objects.bindings]]
name = "Chat"
class_name = "Chat"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Chat"]      # required — DO uses SQLite for message history

# AI Gateway — routes all model calls through Cloudflare's AI Gateway
# Provides caching, rate limiting, logging, fallback, cost tracking
[vars]
AI_GATEWAY_ACCOUNT_ID = "your-account-id"
AI_GATEWAY_GATEWAY_ID = "my-app-gateway"
```

After editing → `pnpm run types` to regenerate `worker-configuration.d.ts`.

---

## Universal Model Provider Factory

> ⚠️ **Provider code is modularized** — do NOT write a monolithic `ai-gateway.ts`.
> See `references/modular-structure.md` for the full file-by-file breakdown.

Structure:
```
backend/ai/providers/
├── workers-ai.ts   # Workers AI impl
├── openai.ts       # OpenAI impl
├── anthropic.ts    # Anthropic impl
├── google.ts       # Google Gemini impl
└── index.ts        # single createModel() entrypoint ← always import from here
```

The single public API is:
```typescript
import { createModel } from '../../../backend/ai/providers'

const model = createModel(env, { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' })
// Defaults to Workers AI if provider is omitted
```

**Before using any model ID — always fetch current docs for that provider:**
- Workers AI: `https://developers.cloudflare.com/workers-ai/models/`
- OpenAI: `https://platform.openai.com/docs/models`
- Anthropic: `https://docs.anthropic.com/en/docs/about-claude/models/overview`
- Google: `https://ai.google.dev/gemini-api/docs/models`

Full provider implementations → `references/modular-structure.md`

---

## Pattern 1 — Cloudflare Agents + assistant-ui (Canonical)

### Architecture

- **Server**: a `Chat` Durable Object subclasses `AIChatAgent` from `@cloudflare/ai-chat`. It owns the message history (SQLite), handles the WebSocket lifecycle, and forwards each turn into `streamText`. One DO instance per unique `name` you connect with from the client — typically per-user or per-session.
- **Transport**: WebSocket between browser and DO. Streaming tokens, tool calls, and tool results flow over the same channel. `/get-messages` is an HTTP fallback for history rehydration.
- **Client**: `useAgent` (from `agents/react`) opens the WebSocket; `useAgentChat` (from `@cloudflare/ai-chat/react`) wraps it and exposes the AI-SDK-compatible surface; `useAISDKRuntime` (from `@assistant-ui/react-ai-sdk`) feeds that into `AssistantRuntimeProvider`. Full assistant-ui feature set: streaming, tool calling, edit, reload, regenerate, history import/export, attachments, suggestions.

### Server — Define the Agent

`AIChatAgent` already implements persistence, streaming protocol, and WebSocket plumbing. Override `onChatMessage` to plug in the model and tools.

```typescript
// backend/ai/agents/chat/index.ts
import { AIChatAgent } from '@cloudflare/ai-chat'
import { streamText, convertToModelMessages } from 'ai'
import { createModel } from '../../providers'
import { tools } from './methods'                    // optional — see "Tool Calling" below

export class Chat extends AIChatAgent<Env> {
  async onChatMessage(onFinish: Parameters<typeof streamText>[0]['onFinish']) {
    const model = createModel(this.env, { provider: 'anthropic' })
    return streamText({
      model,
      messages: await convertToModelMessages(this.messages),
      system: 'You are a helpful assistant.',
      tools,
      onFinish,
    })
  }
}
```

- `this.messages` is the persisted history for this DO instance. Each unique `name` from the client gets its own instance and its own message log.
- `this.env` is the standard Worker `Env` — every binding works (D1, KV, AI Gateway, secrets).
- `onFinish` must be forwarded to `streamText` so the DO can commit the final assistant message to SQLite.

Folder layout follows the standard agent module pattern (`references/modular-structure.md`):

```
backend/ai/agents/chat/
├── types.ts                # zod schemas for tool inputs/outputs
├── health.ts               # health-probe wiring for /health
├── index.ts                # Chat class (above)
└── methods/                # one file per tool
    ├── searchDocs.ts
    ├── runQuery.ts
    └── index.ts            # exports `tools` map
```

### Server — Route and Re-export

```typescript
// src/worker.ts (or wherever the Worker entry lives)
import { routeAgentRequest } from 'agents'
import { Chat } from '../backend/ai/agents/chat'
export { Chat }                                      // Cloudflare needs the DO class re-exported from the entry module

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS for cross-origin WebSocket and /get-messages fetches
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request) })
    }

    // Try the Agents router first (WebSocket upgrades, /get-messages, agent dispatch)
    const agentResponse = await routeAgentRequest(request, env)
    if (agentResponse) return withCors(agentResponse, request)

    // Fall through to Astro/Hono via middleware
    return /* astro/hono middleware */
  },
} satisfies ExportedHandler<Env>

function corsHeaders(request: Request) {
  return {
    'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*',  // tighten to an explicit allowlist in production
    'Access-Control-Allow-Headers': 'Content-Type, Upgrade, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
}
function withCors(res: Response, request: Request) {
  const out = new Response(res.body, res)
  for (const [k, v] of Object.entries(corsHeaders(request))) out.headers.set(k, v)
  return out
}
```

WebSocket upgrades bypass CORS in the browser, but the `/get-messages` HTTP fetch needs these headers. **For production, replace the wildcard with an explicit allowlist.**

When the Worker is the same origin as the Astro frontend (the default in this stack — single Worker with `[assets]`), CORS is a no-op but `routeAgentRequest` still needs to run before the Astro middleware.

### Server — Astro+Cloudflare DO Re-export Gotcha

When using `@astrojs/cloudflare`, Astro generates the actual Worker entry. The `Chat` class must still be reachable from that generated entry. See `shadcn/references/durable-objects.md` for the Pattern A (wrapper Worker) and Pattern B (re-export injection) approaches. **Pattern B (re-export injection) is the default.**

### Client — Wire the Runtime

```tsx
// src/pages/_components/AgentChat.tsx
'use client'
import { useState } from 'react'
import { useAgent } from 'agents/react'
import { useAgentChat } from '@cloudflare/ai-chat/react'
import { AssistantRuntimeProvider } from '@assistant-ui/react'
import { useAISDKRuntime } from '@assistant-ui/react-ai-sdk'
import { Thread } from '@assistant-ui/react'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

interface AgentChatProps {
  /** Per-user/session key. Each unique value gets its own DO instance and message history. */
  agentName: string
  /** Worker origin. Same-origin in production; cross-origin in dev (e.g. http://localhost:8787). */
  agentHost?: string
  /** Auth credential forwarded on WebSocket upgrade. Required in production. */
  authToken?: string
}

export function AgentChat({ agentName, agentHost, authToken }: AgentChatProps) {
  const agent = useAgent({
    agent: 'Chat',                                   // matches the exported DO class name
    name: agentName,                                 // per-user/session key
    host: agentHost,                                 // omit for same-origin
    query: authToken ? { token: authToken } : undefined,
    // headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
  })

  const chat = useAgentChat({ agent })
  const runtime = useAISDKRuntime(chat)

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex flex-col h-full gap-3">
        <ChatToolbar chat={chat} />
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  )
}

function ChatToolbar({ chat }: { chat: ReturnType<typeof useAgentChat> }) {
  // Cloudflare-specific extras live on `chat`, not on the runtime
  const { clearHistory, isServerStreaming, isToolContinuation, status } = chat
  return (
    <div className="flex items-center gap-2 px-1">
      {isServerStreaming && (
        <span className="text-xs text-muted-foreground">
          {isToolContinuation ? 'Continuing after tool…' : 'Streaming…'}
        </span>
      )}
      <button
        onClick={() => clearHistory()}
        className="ml-auto text-xs text-muted-foreground hover:text-foreground"
        disabled={status === 'streaming'}
      >
        Clear history
      </button>
    </div>
  )
}
```

```astro
<!-- src/pages/chat.astro -->
---
import AppLayout from '../layouts/AppLayout.astro'

const userId = Astro.locals.runtime.env.AUTH?.userIdFor(Astro.request) ?? 'anonymous'
const token = Astro.locals.runtime.env.AUTH?.tokenFor(Astro.request)
---
<AppLayout title="Chat">
  <div class="h-[calc(100vh-8rem)]">
    <AgentChat
      agentName={userId}
      authToken={token}
      client:load
    />
  </div>
</AppLayout>
```

`client:load` is mandatory — the chat island is interactive from first paint. `client:idle` works for chat surfaces below the fold.

### Client — Cloudflare-Specific Extras

`useAgentChat` exposes three values `useChat` does not. Destructure them off the `chat` object alongside the runtime — they don't need to flow through `useAISDKRuntime`:

| Field | Use |
|---|---|
| `clearHistory()` | Sends a `cf_agent_chat_clear` frame and wipes the DO's SQLite history. Bind to a "Clear chat" button. `setMessages([])` alone only clears the client view, not the server. |
| `isServerStreaming` | `true` while the server is pushing tokens, independent of client-initiated request state. Use for a universal streaming indicator. |
| `isToolContinuation` | Distinguishes "server auto-continuing after a tool result" from "user just sent a new message". Use for typing-indicator gating and for "Continuing after tool…" copy. |

### Client — `setMessages` Round-Trips Through the DO

`useAgentChat` overrides `setMessages` to broadcast the new list over the WebSocket so the DO's SQLite stays in sync. This means assistant-ui's `onImport`, `onEdit`, `onReload`, and pending-tool cancellation paths **all persist server-side automatically**. The tradeoff is one extra WebSocket round-trip per mutation, which can race if the connection is lagging. Assume eventual consistency, not transactional.

### Client — `useAgentChat` Type Compatibility With `useAISDKRuntime`

`useAgentChat`'s return type is `Omit<ReturnType<typeof useChat>, 'addToolOutput'> & { … }`. The `addToolOutput` option shape differs slightly:

- `useChat`: `{ state, tool, toolCallId, … }`
- `useAgentChat`: `{ state, toolCallId, toolName?, … }`

At runtime the call paths converge through `useAISDKRuntime` (verified against `@cloudflare/ai-chat@0.7.0`). If TypeScript flags the call, cast at the call site:

```tsx
const runtime = useAISDKRuntime(chat as Parameters<typeof useAISDKRuntime>[0])
// If TS still refuses the direct cast:
// const runtime = useAISDKRuntime(chat as unknown as Parameters<typeof useAISDKRuntime>[0])
```

`satisfies` does not help here — it validates assignability without changing the inferred type, so it surfaces the same error.

### Tool Calling

Tools defined with `ai`'s `tool()` helper inside `streamText({ tools })` work end-to-end. The DO streams tool-call frames over the WebSocket; assistant-ui renders them via the runtime; tool results come back through the same channel. For client-side / human-in-the-loop tools, use `chat.addToolOutput({ state, toolCallId, toolName?, … })` — the WebSocket round-trip means the DO sees the result and resumes.

```typescript
// backend/ai/agents/chat/methods/index.ts
import { tool } from 'ai'
import { z } from 'zod'

export const tools = {
  searchDocs: tool({
    description: 'Search the project documentation.',
    parameters: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      // env is available on `this` from the surrounding AIChatAgent — pull it in via closure or instance method
      return { results: [/* ... */] }
    },
  }),
}
```

For env access inside tools, define `tools` as a method of the `Chat` class so it closes over `this.env`:

```typescript
export class Chat extends AIChatAgent<Env> {
  private tools() {
    return {
      runQuery: tool({
        description: 'Run a read-only D1 query.',
        parameters: z.object({ sql: z.string() }),
        execute: async ({ sql }) => {
          const result = await this.env.DB.prepare(sql).all()
          return result.results
        },
      }),
    }
  }
  async onChatMessage(onFinish: Parameters<typeof streamText>[0]['onFinish']) {
    return streamText({
      model: createModel(this.env, { provider: 'anthropic' }),
      messages: await convertToModelMessages(this.messages),
      tools: this.tools(),
      onFinish,
    })
  }
}
```

### Authentication — Required Before Production

`routeAgentRequest` accepts any client that knows the agent class and `name`. **If `name` is derived from a user ID, any client that knows or guesses another user's ID can connect to that DO and read its full message log.** Before deploying:

1. **Gate the fetch handler** with a header or cookie check (e.g. a JWT issued by the auth backend) — only call `routeAgentRequest` after the request is authenticated.

   ```typescript
   export default {
     async fetch(request: Request, env: Env): Promise<Response> {
       const user = await verifyAuth(request, env)              // returns null on failure
       if (!user && needsAuth(request)) return new Response('Unauthorized', { status: 401 })
       // ... routeAgentRequest etc.
     },
   }
   ```

2. **Pass the credential from the frontend** via `useAgent`'s `headers` or `query` options so the WebSocket upgrade carries it (see the client snippet above). Browsers can't set arbitrary headers on `WebSocket`, so `query` is usually the only option for the upgrade itself; use `headers` for the `/get-messages` HTTP fetch.

3. **Tighten CORS `Access-Control-Allow-Origin`** to an explicit allowlist; the wildcard in the examples above is local-dev-only.

4. **Verify `name` belongs to the authenticated user** before letting the request through to `routeAgentRequest`. Don't trust the client-supplied `name` blindly — derive it server-side from the verified user, or compare it to the verified user ID and reject mismatches.

### Multi-Thread Support

`useAISDKRuntime` is single-thread by design. To run multiple chat threads (e.g. left-sidebar conversation list), wrap a custom thread list around `useAISDKRuntime` — see `assistant-ui` docs at `/docs/runtimes/concepts/threads`. Each thread maps to a unique `name` passed to `useAgent`. Switching threads = unmount one `AgentChat` and mount another with a different `agentName` (or memoize the `useAgent` call so the WebSocket cycles cleanly).

> **AssistantCloud is not compatible with this wiring.** `useChatRuntime` constructs its own `useChat` internally and can't be fed `useAgentChat`'s return value. If AssistantCloud's hosted history is required, use Pattern 2 (stateless) and let AssistantCloud handle persistence instead of the DO.

---

## Pattern 2 — Stateless `/chat` Endpoint + assistant-ui (Fallback)

Use when:
- No history persistence needed (single-pane "summarize this" widget).
- The surrounding app already manages chat state and just needs a streaming completion.
- Migrating an existing AI-SDK-only project — drop Cloudflare Agents in later.

### Server — Hono `/chat` Route

```typescript
// src/hono/routes/agent.ts
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { streamText } from 'ai'
import { createModel } from '../../../backend/ai/providers'

const router = new OpenAPIHono<{ Bindings: Env }>()

const chatRoute = createRoute({
  method: 'post',
  path: '/chat',
  tags: ['Agent'],
  summary: 'Stream a stateless chat completion',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            messages: z.array(z.object({
              role: z.enum(['user', 'assistant', 'system']),
              content: z.string(),
            })),
            provider: z.enum(['workers-ai', 'openai', 'anthropic', 'google']).optional(),
            modelId: z.string().optional(),
          }),
        },
      },
      required: true,
    },
  },
  responses: { 200: { description: 'Streamed text response' } },
})

router.openapi(chatRoute, async (c) => {
  const { messages, provider, modelId } = c.req.valid('json')
  const model = createModel(c.env, { provider, modelId })
  const result = streamText({ model, messages, system: 'You are a helpful assistant.' })
  return result.toDataStreamResponse()
})

export { router as agentRouter }
```

### Client — Plain `useChat` + assistant-ui

```tsx
// src/pages/_components/StatelessChat.tsx
'use client'
import { useState } from 'react'
import { AssistantRuntimeProvider } from '@assistant-ui/react'
import { useChat } from 'ai/react'
import { useVercelUseChatRuntime } from '@assistant-ui/react-ai-sdk'
import { Thread } from '@assistant-ui/react'

export function StatelessChat() {
  const [provider, setProvider] = useState('workers-ai')

  const chat = useChat({
    api: '/api/agent/chat',
    body: { provider },
    onError: (err) => {
      window.dispatchEvent(new CustomEvent('app:error', {
        detail: { error: err.message, context: 'StatelessChat' },
      }))
    },
  })

  const runtime = useVercelUseChatRuntime(chat)

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  )
}
```

No DO, no WebSocket, no persistence. Each new pageload starts fresh.

---

## Choosing Between the Patterns

| Need | Pattern |
|---|---|
| Persistent multi-turn chat with per-user history | **1 — Cloudflare Agents** |
| Native tool calling with server-side state between turns | **1 — Cloudflare Agents** |
| Low-latency token streaming via WebSocket | **1 — Cloudflare Agents** |
| `clearHistory`, `isServerStreaming`, `isToolContinuation` | **1 — Cloudflare Agents** |
| Server-persisted edit / reload / regenerate | **1 — Cloudflare Agents** (via the `setMessages` round-trip) |
| One-shot stateless completion (summary, code-gen, etc.) | **2 — Stateless** |
| AssistantCloud-managed history | **2 — Stateless** with `useChatRuntime` |
| Embedding in an OpenAPI-documented public API | **2 — Stateless** (Pattern 1's transport is WebSocket, not REST) |

When in doubt, default to Pattern 1. The DO overhead is negligible for the feature set it unlocks.

---

## Invoking Agents from the Worker — RPC, never `stub.fetch()`

Chat agents are reached over WebSocket via `routeAgentRequest` + `useAgent` (above). But any **non-chat** agent logic you call from a Hono route, a cron handler, a queue consumer, or another agent must go through **native DO RPC** — never a hand-built HTTP request.

```typescript
// ❌ ANTI-PATTERN — RPC wearing an HTTP costume. Compiles, passes tests, loses type safety + streaming.
const id = env.CONSULT_AGENT.idFromName("global-consult");
const stub = env.CONSULT_AGENT.get(id);
const res = await stub.fetch(new Request("https://internal/rpc",
  { method: "POST", body: JSON.stringify({ useCase, models }) }));
const data = await res.json();

// ✅ CORRECT — typed RPC against a @callable() method
import { getAgentByName } from "agents";
const stub = await getAgentByName(env.CONSULT_AGENT, "global-consult");
const data = await stub.consult({ useCase, models });
```

On the agent, expose the method with `@callable()` (so clients can call it too) or as a plain public method (server-side RPC only):

```typescript
import { Agent, callable } from "agents";

export class ConsultAgent extends Agent<Env, State> {
  @callable()
  async consult(input: { useCase: string; models: string[] }) {
    return { recommendation: /* ... */ };
  }
}
```

| Caller | Invocation |
|--------|-----------|
| Hono route / cron / queue → agent | `getAgentByName(env.NS, name)` → `await stub.method(args)` |
| Agent → another agent | `getAgentByName(env.NS, name)` → `await stub.method(args)` |
| Browser / external service → agent | `@callable()` + client SDK `agent.call("method", [args])` |

**Proactive audit (run repo-wide, every time you touch agent code):** search for `stub.fetch(new Request`, synthetic `https?://internal` URLs, `idFromName`/`idFromString`, and method-dispatching `onRequest` handlers — then convert each to RPC. Genuine HTTP **proxy** routes (forwarding the caller's raw request) stay on `fetch`, but upgrade `idFromName().get()` → `getByName()`. `@callable` needs `experimentalDecorators` **OFF** in `tsconfig.json`. Full scan commands, classification table, and fix recipe: `agents-sdk/references/agent-invocation-audit.md`.

---

## Jules SDK / Stitch SDK as Agent Tools

For projects involving Jules (build agent) or Stitch (UI generation), expose them as tools on the `Chat` DO so the agent can call them mid-conversation:

```typescript
// backend/ai/agents/chat/methods/runJulesBuild.ts
import { tool } from 'ai'
import { z } from 'zod'

export const runJulesBuild = (env: Env) => tool({
  description: 'Trigger a Jules coding session against the active branch.',
  parameters: z.object({
    prompt: z.string(),
    repoUrl: z.string().url(),
    branch: z.string().optional(),
  }),
  execute: async ({ prompt, repoUrl, branch }) => {
    // Read the Jules SDK docs before implementing — APIs evolve.
    // https://developers.cloudflare.com/agents/ — Cloudflare Agents reference
    // Google Labs Jules — separate product; check its current API.
    return { sessionId: '...' }
  },
})
```

Then wire it into the `Chat.tools()` method shown above. The tool-call frame, tool result, and the agent's follow-up reasoning all flow over the same WebSocket — assistant-ui renders the tool call card automatically.

> Always fetch the latest Jules/Stitch SDK docs before implementing. Never guess API signatures.

---

## wrangler.toml Secrets for Model Providers

```bash
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GOOGLE_AI_API_KEY
```

These become available as `env.OPENAI_API_KEY` etc. — typed as `string` in `worker-configuration.d.ts` after `pnpm run types`. The DO accesses them via `this.env` (same `Env` interface as the Worker).

For local `wrangler dev`, mirror the keys into `.dev.vars` (not the deployed secret store):

```
# .dev.vars
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_AI_API_KEY=...
```

---

## Cross-References

- `shadcn/references/durable-objects.md` — Astro+Cloudflare DO re-export gotcha (the Pattern B injection that makes this work end-to-end).
- `shadcn/references/cloudflare-astro-setup.md` — `@astrojs/cloudflare` adapter + wrangler.toml for Workers + assets.
- `references/modular-structure.md` — agent folder layout (`types.ts` / `health.ts` / `index.ts` / `methods/`) and provider folder layout.
- `references/ux-standards.md` — global ErrorLogger, no-borders rule, Monolith chat styling.
- Cloudflare Agents docs: `https://developers.cloudflare.com/agents/`
- assistant-ui AI SDK runtime: `https://assistant-ui.com/docs/runtimes/ai-sdk/v6`
