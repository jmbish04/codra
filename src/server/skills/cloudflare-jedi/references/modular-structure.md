# Modular Code Structure

Every backend module is organized into small, focused files grouped by domain and capability.
The rule is simple: **one concern per file, every folder has an `index.ts`**.
Consumers always import from the folder entrypoint, never from individual leaf files.

---

## Schema Modularization

### Pattern

```
backend/db/schemas/
└── ${domain}/
    ├── ${subcategory}/
    │   ├── ${table_name}.ts   # table def + drizzle-zod + types
    │   └── index.ts           # re-exports everything in this subcategory
    ├── ${flat_table}.ts       # tables that don't need a subcategory
    └── index.ts               # re-exports all subcategories + flat tables
```

The root `backend/db/schemas/index.ts` re-exports every domain:
```typescript
// backend/db/schemas/index.ts
export * from './projects'
export * from './users'
export * from './billing'
// ...add each new domain here
```

### Concrete Example: `projects` domain

```
backend/db/schemas/projects/
├── backlog/
│   ├── epics.ts
│   ├── phases.ts
│   ├── sprints.ts
│   ├── stories.ts
│   ├── tasks.ts
│   ├── mappings.ts
│   └── index.ts
├── plans/
│   ├── requests.ts
│   ├── revisions.ts
│   ├── reverse_engineering.ts
│   └── index.ts
├── todos.ts
└── index.ts
```

### Individual Table File (`epics.ts`)

Each file defines exactly one table, its drizzle-zod schemas, and its TypeScript types.

```typescript
// backend/db/schemas/projects/backlog/epics.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { z } from 'zod'
import { sql } from 'drizzle-orm'

export const epics = sqliteTable('epics', {
  id:          text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId:   text('project_id').notNull(),
  title:       text('title').notNull(),
  description: text('description'),
  status:      text('status', {
                 enum: ['planning', 'active', 'completed', 'archived']
               }).notNull().default('planning'),
  priority:    integer('priority').notNull().default(0),
  createdAt:   integer('created_at', { mode: 'timestamp' })
               .notNull().default(sql`(unixepoch())`),
  updatedAt:   integer('updated_at', { mode: 'timestamp' })
               .notNull().default(sql`(unixepoch())`),
})

export const insertEpicSchema = createInsertSchema(epics, {
  title: z.string().min(1).max(500),
}).omit({ id: true, createdAt: true, updatedAt: true })

export const selectEpicSchema = createSelectSchema(epics)

export const updateEpicSchema = createUpdateSchema(epics)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .partial()

export type Epic    = typeof epics.$inferSelect
export type NewEpic = typeof epics.$inferInsert
```

### Subcategory Entrypoint (`backlog/index.ts`)

```typescript
// backend/db/schemas/projects/backlog/index.ts
export * from './epics'
export * from './phases'
export * from './sprints'
export * from './stories'
export * from './tasks'
export * from './mappings'
```

### Domain Entrypoint (`projects/index.ts`)

```typescript
// backend/db/schemas/projects/index.ts
export * from './backlog'   // re-exports all backlog tables
export * from './plans'     // re-exports all plan tables
export * from './todos'
```

### Importing Schemas in Hono Routes

```typescript
// ✅ Correct — import from the domain entrypoint
import { epics, insertEpicSchema, selectEpicSchema, type Epic } from '../../backend/db/schemas/projects'

// ✅ Also fine — import from subcategory entrypoint
import { epics } from '../../backend/db/schemas/projects/backlog'

// ❌ Wrong — never import from a leaf file directly
import { epics } from '../../backend/db/schemas/projects/backlog/epics'
```

### drizzle.config.ts — Point at the schemas index

```typescript
// drizzle.config.ts
export default {
  dialect: 'sqlite',
  schema: './backend/db/schemas/index.ts',  // picks up all domains
  out: './backend/db/migrations',
  // ...
} satisfies Config
```

---

## Agent Modularization

### Pattern

```
backend/ai/agents/
└── ${agentName}/
    ├── types.ts       # all input/output types, zod schemas, enums for this agent
    ├── health.ts      # health check handler (used by /api/agents/${name}/health)
    ├── index.ts       # agent entrypoint — wires types + methods + exposes run()
    └── methods/
        ├── ${methodName}.ts   # one file per distinct capability
        ├── ${methodName}.ts
        └── index.ts           # re-exports all methods
```

### `types.ts` — All Type Definitions

```typescript
// backend/ai/agents/catalogAgent/types.ts
import { z } from 'zod'

export const CatalogInputSchema = z.object({
  query:    z.string().min(1),
  limit:    z.number().int().min(1).max(100).default(10),
  filters:  z.record(z.string()).optional(),
})

export const CatalogOutputSchema = z.object({
  results:    z.array(z.object({
    id:       z.string(),
    title:    z.string(),
    score:    z.number(),
    metadata: z.record(z.unknown()).optional(),
  })),
  total:      z.number(),
  processingMs: z.number(),
})

export type CatalogInput  = z.infer<typeof CatalogInputSchema>
export type CatalogOutput = z.infer<typeof CatalogOutputSchema>

export interface CatalogAgentContext {
  env:        Env
  sessionId?: string
  userId?:    string
}
```

### `health.ts` — Health Check Logic

```typescript
// backend/ai/agents/catalogAgent/health.ts
import type { CatalogAgentContext } from './types'

export interface AgentHealthStatus {
  status:  'healthy' | 'degraded' | 'unhealthy'
  checks:  Record<string, boolean>
  message?: string
  latencyMs?: number
}

export async function checkHealth(ctx: CatalogAgentContext): Promise<AgentHealthStatus> {
  const checks: Record<string, boolean> = {}
  const start = Date.now()

  try {
    // Check AI binding is reachable
    checks['ai_binding'] = !!ctx.env.AI

    // Check DB is reachable
    const result = await ctx.env.DB.prepare('SELECT 1').first()
    checks['database'] = !!result

    const allHealthy = Object.values(checks).every(Boolean)
    return {
      status: allHealthy ? 'healthy' : 'degraded',
      checks,
      latencyMs: Date.now() - start,
    }
  } catch (err) {
    return {
      status: 'unhealthy',
      checks,
      message: err instanceof Error ? err.message : 'Unknown error',
      latencyMs: Date.now() - start,
    }
  }
}
```

### `methods/` — One File Per Capability

```typescript
// backend/ai/agents/catalogAgent/methods/search.ts
import { generateObject } from 'ai'
import { createModel } from '../../providers'
import type { CatalogInput, CatalogOutput, CatalogAgentContext } from '../types'

export async function search(
  input: CatalogInput,
  ctx: CatalogAgentContext
): Promise<CatalogOutput> {
  const model = createModel(ctx.env, { provider: 'workers-ai' })
  const start = Date.now()

  // ... implementation
  return {
    results: [],
    total: 0,
    processingMs: Date.now() - start,
  }
}
```

```typescript
// backend/ai/agents/catalogAgent/methods/index.ts
export { search }   from './search'
export { rank }     from './rank'
export { summarize } from './summarize'
```

### `index.ts` — Agent Entrypoint

```typescript
// backend/ai/agents/catalogAgent/index.ts
import { CatalogInputSchema, type CatalogInput, type CatalogOutput, type CatalogAgentContext } from './types'
import { checkHealth } from './health'
import { search, rank, summarize } from './methods'

export { CatalogInputSchema, checkHealth }
export type { CatalogInput, CatalogOutput, CatalogAgentContext }

export const catalogAgent = {
  run: async (input: CatalogInput, ctx: CatalogAgentContext): Promise<CatalogOutput> => {
    const parsed = CatalogInputSchema.parse(input)
    const results = await search(parsed, ctx)
    return rank(results, ctx)
  },
  health: checkHealth,
  methods: { search, rank, summarize },
}
```

### Wiring Agent Health into Hono

```typescript
// src/hono/routes/agents.ts
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { catalogAgent } from '../../../backend/ai/agents/catalogAgent'

const router = new OpenAPIHono<{ Bindings: Env }>()

router.openapi(
  createRoute({
    method: 'get',
    path: '/catalog/health',
    tags: ['Agents'],
    responses: { 200: { description: 'Health status', content: { 'application/json': { schema: z.any() } } } },
  }),
  async (c) => {
    const status = await catalogAgent.health({ env: c.env })
    return c.json(status, status.status === 'unhealthy' ? 503 : 200)
  }
)
```

---

## AI Provider Modularization

### Pattern

```
backend/ai/providers/
├── workers-ai.ts    # Workers AI via AI Gateway
├── openai.ts        # OpenAI via AI Gateway
├── anthropic.ts     # Anthropic via AI Gateway
├── google.ts        # Google Gemini via AI Gateway
└── index.ts         # single createModel() entrypoint
```

Each provider file handles the quirks of that provider — different base URLs, auth patterns, header requirements, streaming differences, etc. Isolating them means fixing a provider bug never touches the others.

### Provider File (`workers-ai.ts`)

```typescript
// backend/ai/providers/workers-ai.ts
import { createWorkersAI } from '@cloudflare/ai-sdk-provider'

export function createWorkersAIModel(
  env: Env,
  modelId = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
) {
  // Always verify model IDs at: https://developers.cloudflare.com/workers-ai/models/
  const provider = createWorkersAI({
    binding: env.AI,
    gateway: {
      id:        env.AI_GATEWAY_GATEWAY_ID,
      skipCache: false,
      cacheTtl:  3600,
    },
  })
  return provider(modelId)
}

// Workers AI recommended models (verify for latest):
// Text:    @cf/meta/llama-3.3-70b-instruct-fp8-fast (fast, capable)
//          @cf/meta/llama-3.1-8b-instruct           (fastest, lowest cost)
// Vision:  @cf/llava-hf/llava-1.5-7b-hf
// Embed:   @cf/baai/bge-large-en-v1.5
```

### Provider File (`anthropic.ts`)

```typescript
// backend/ai/providers/anthropic.ts
import { createAnthropic } from '@ai-sdk/anthropic'

export async function createAnthropicModel(
  env: Env,
  modelId = 'claude-sonnet-4-20250514'
) {
  // API key from Secrets Store (async get) or plain secret (sync)
  const apiKey = typeof env.ANTHROPIC_API_KEY === 'string'
    ? env.ANTHROPIC_API_KEY
    : await env.ANTHROPIC_API_KEY.get()

  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  // Always verify current model IDs at:
  // https://docs.anthropic.com/en/docs/about-claude/models/overview
  const provider = createAnthropic({
    apiKey,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_GATEWAY_ID}/anthropic`,
  })
  return provider(modelId)
}
```

### Provider File (`openai.ts`)

```typescript
// backend/ai/providers/openai.ts
import { createOpenAI } from '@ai-sdk/openai'

export async function createOpenAIModel(
  env: Env,
  modelId = 'gpt-4o-mini'
) {
  const apiKey = typeof env.OPENAI_API_KEY === 'string'
    ? env.OPENAI_API_KEY
    : await env.OPENAI_API_KEY.get()

  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')

  // Always verify current model IDs at:
  // https://platform.openai.com/docs/models
  const provider = createOpenAI({
    apiKey,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_GATEWAY_ID}/openai`,
  })
  return provider(modelId)
}
```

### Provider File (`google.ts`)

```typescript
// backend/ai/providers/google.ts
import { createGoogleGenerativeAI } from '@ai-sdk/google'

export async function createGoogleModel(
  env: Env,
  modelId = 'gemini-2.0-flash'
) {
  const apiKey = typeof env.GOOGLE_AI_API_KEY === 'string'
    ? env.GOOGLE_AI_API_KEY
    : await env.GOOGLE_AI_API_KEY.get()

  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not configured')

  // Always verify current model IDs at:
  // https://ai.google.dev/gemini-api/docs/models
  const provider = createGoogleGenerativeAI({
    apiKey,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_GATEWAY_ID}/google-ai-studio`,
  })
  return provider(modelId)
}
```

### Single Entrypoint (`providers/index.ts`)

```typescript
// backend/ai/providers/index.ts
import { createWorkersAIModel } from './workers-ai'
import { createAnthropicModel } from './anthropic'
import { createOpenAIModel }    from './openai'
import { createGoogleModel }    from './google'

export type ModelProvider = 'workers-ai' | 'anthropic' | 'openai' | 'google'

export interface ModelConfig {
  provider?: ModelProvider
  modelId?:  string
}

/**
 * Single factory — all agent and route code calls this.
 * Provider-specific quirks (auth, baseURL, streaming) are isolated in each provider file.
 * Always defaults to Workers AI.
 */
export async function createModel(env: Env, config: ModelConfig = {}) {
  const { provider = 'workers-ai', modelId } = config

  switch (provider) {
    case 'workers-ai': return createWorkersAIModel(env, modelId)
    case 'anthropic':  return createAnthropicModel(env, modelId)
    case 'openai':     return createOpenAIModel(env, modelId)
    case 'google':     return createGoogleModel(env, modelId)
    default:           throw new Error(`Unknown provider: ${provider}`)
  }
}

// Re-export for consumers who need direct access
export { createWorkersAIModel, createAnthropicModel, createOpenAIModel, createGoogleModel }
```

### Importing in Agent Methods

```typescript
// ✅ Correct — always import from providers/index
import { createModel } from '../../providers'

// ❌ Wrong — never import from individual provider files in agent code
import { createAnthropicModel } from '../../providers/anthropic'
```

---

## Adding a New Domain/Agent Checklist

### New schema domain
1. Create `backend/db/schemas/${domain}/` folder
2. Create subcategory folders + table files
3. Add `index.ts` to every folder that re-exports its contents
4. Add `export * from './${domain}'` to `backend/db/schemas/index.ts`
5. Run `pnpm run db:generate`

### New agent
1. Create `backend/ai/agents/${agentName}/` folder
2. Create `types.ts` — define all input/output schemas and types
3. Create `health.ts` — implement `checkHealth()`
4. Create `methods/` subfolder + individual method files + `methods/index.ts`
5. Create `index.ts` — wire everything into a named agent object
6. Wire health route into `src/hono/routes/agents.ts`
7. Update `/AGENTS.md` to document the new agent (so Jules knows it exists)

### New provider
1. Create `backend/ai/providers/${providerName}.ts`
2. Add the factory function following the existing pattern
3. Add the case to `createModel()` in `providers/index.ts`
4. Add the wrangler secret: `wrangler secret put ${PROVIDER}_API_KEY`
5. Run `wrangler types` to regenerate `worker-configuration.d.ts`
