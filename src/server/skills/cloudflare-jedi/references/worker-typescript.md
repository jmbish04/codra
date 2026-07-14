# Worker TypeScript Setup

## worker-configuration.d.ts

**Auto-generated. Never manually edit.**

Run after any `wrangler.toml` binding change:
```bash
wrangler types
# or if you need a custom output path:
wrangler types --output-path worker-configuration.d.ts
```

The generated file looks like:
```typescript
// worker-configuration.d.ts (auto-generated)
interface Env {
  DB: D1Database;
  AI: Ai;
  GATEWAY: string;               // AI Gateway account tag
  ASSETS: Fetcher;               // Static assets binding
  MY_KV: KVNamespace;
  MY_SECRET: string;             // Plain wrangler secret
  // Secrets Store secrets have a different type (see below)
}
```

**Rules:**
- `Env` is a global interface — it is available in every `.ts` file without import.
- Never add `import type { Env }` anywhere.
- Never write `interface Env { ... }` anywhere in your own code.
- If a property is missing from `Env`, it means the binding is not in `wrangler.toml` yet. Add it there, then re-run `wrangler types`.

---

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "skipLibCheck": true,
    "types": ["@cloudflare/workers-types/2023-07-01"]
  },
  "include": [
    "worker-configuration.d.ts",
    "src/**/*.ts",
    "src/**/*.tsx",
    "src/**/*.astro"
  ]
}
```

> The `types` entry uses `@cloudflare/workers-types` to get all Cloudflare runtime globals (`D1Database`, `Ai`, `KVNamespace`, `R2Bucket`, etc.). Never install `@types/node` — use CF types.

---

## Accessing `env` in Hono

```typescript
// src/hono/routes/items.ts
import { OpenAPIHono } from '@hono/zod-openapi'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../../db/schema'

const router = new OpenAPIHono<{ Bindings: Env }>()

router.openapi(getItemRoute, async (c) => {
  const db = drizzle(c.env.DB, { schema })  // c.env is typed as Env
  // ...
})
```

## Accessing `env` in Astro pages

```typescript
---
// src/pages/some-page.astro
const { runtime } = Astro.locals
const db = drizzle(runtime.env.DB)          // runtime.env is typed as Env
const kv = runtime.env.MY_KV
---
```

---

## Secrets Store Bindings (preferred over plain secrets for sensitive values)

Cloudflare Secrets Store provides versioned, auditable secrets with a dedicated binding type.

**wrangler.toml:**
```toml
[[secrets_store_secrets]]
binding = "OPENAI_API_KEY"
store_id = "your-store-id-here"
secret_name = "openai-api-key"
```

**Usage (async get):**
```typescript
const key = await c.env.OPENAI_API_KEY.get()   // returns string | null
```

**Plain wrangler secrets (for simpler cases):**
```bash
wrangler secret put MY_SECRET
```
```typescript
const val = c.env.MY_SECRET  // string, accessed directly
```

> Prefer Secrets Store for API keys and credentials that may rotate. Use plain `wrangler secret put` only for static config values.

---

## Binding Types Quick Reference

| Binding | wrangler.toml stanza | TypeScript type |
|---|---|---|
| D1 database | `[[d1_databases]]` | `D1Database` |
| KV namespace | `[[kv_namespaces]]` | `KVNamespace` |
| R2 bucket | `[[r2_buckets]]` | `R2Bucket` |
| Workers AI | `[ai]` | `Ai` |
| Durable Object | `[[durable_objects.bindings]]` | `DurableObjectNamespace` |
| Service binding | `[[services]]` | `Fetcher` |
| Secrets Store | `[[secrets_store_secrets]]` | `{ get(): Promise<string\|null> }` |
| Plain secret | `wrangler secret put` | `string` |
| Queue (producer) | `[[queues.producers]]` | `Queue` |
| Vectorize | `[[vectorize]]` | `VectorizeIndex` |

Always re-run `wrangler types` after adding any row from this table to `wrangler.toml`.
