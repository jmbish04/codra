# Hono + zod-openapi

## Required Packages

```bash
pnpm add hono @hono/zod-openapi @hono/swagger-ui @scalar/hono-api-reference zod
```

---

## App Instance (`src/hono/index.ts`)

```typescript
import { OpenAPIHono } from '@hono/zod-openapi'
import { apiReference } from '@scalar/hono-api-reference'
import { swaggerUI } from '@hono/swagger-ui'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { itemsRouter } from './routes/items'

export const app = new OpenAPIHono<{ Bindings: Env }>()

// Middleware
app.use('*', cors())
app.use('*', logger())

// Feature routes
app.route('/api/items', itemsRouter)

// ── OpenAPI / Docs (always present, never hardcoded schemas) ──────────────
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'My App API',
    version: '1.0.0',
    description: 'Auto-generated from route definitions',
  },
  servers: [{ url: '/', description: 'Current environment' }],
})

app.get(
  '/scalar',
  apiReference({
    theme: 'purple',
    spec: { url: '/openapi.json' },
  })
)

app.get('/swagger', swaggerUI({ url: '/openapi.json' }))

// Global error handler
app.onError((err, c) => {
  console.error(err)
  return c.json({ error: err.message, code: 'INTERNAL_ERROR' }, 500)
})

app.notFound((c) => c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404))
```

---

## Route Definition Pattern

Each route is fully typed end-to-end via zod-openapi. Schemas come from `drizzle-zod` (see `d1-drizzle.md`).

```typescript
// src/hono/routes/items.ts
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { items, insertItemSchema, selectItemSchema } from '../../db/schema'

const router = new OpenAPIHono<{ Bindings: Env }>()

// ── GET /api/items ────────────────────────────────────────────────────────
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Items'],
  summary: 'List all items',
  responses: {
    200: {
      description: 'List of items',
      content: { 'application/json': { schema: z.array(selectItemSchema) } },
    },
  },
})

router.openapi(listRoute, async (c) => {
  const db = drizzle(c.env.DB, { schema: { items } })
  const result = await db.select().from(items)
  return c.json(result)
})

// ── POST /api/items ───────────────────────────────────────────────────────
const createRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Items'],
  summary: 'Create an item',
  request: {
    body: {
      content: { 'application/json': { schema: insertItemSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: 'Created item',
      content: { 'application/json': { schema: selectItemSchema } },
    },
    422: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), issues: z.array(z.any()) }),
        },
      },
    },
  },
})

router.openapi(createRoute, async (c) => {
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB, { schema: { items } })
  const [created] = await db.insert(items).values(body).returning()
  return c.json(created, 201)
})

export { router as itemsRouter }
```

---

## Drizzle DB Middleware (avoid re-creating db instance per handler)

```typescript
// src/hono/middleware/db.ts
import { createMiddleware } from 'hono/factory'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../../db/schema'

type Variables = { db: ReturnType<typeof drizzle> }

export const withDb = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    c.set('db', drizzle(c.env.DB, { schema }))
    await next()
  }
)

// Usage in routes:
// router.use('*', withDb)
// const db = c.get('db')
```

---

## Validation Error Handling (auto-handled by OpenAPIHono)

`OpenAPIHono` automatically returns 422 when `c.req.valid('json')` fails zod validation. Add a custom hook to standardize the response format:

```typescript
const app = new OpenAPIHono<{ Bindings: Env }>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: 'Validation failed',
          issues: result.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        422
      )
    }
  },
})
```

---

## Security: Adding Auth Middleware

```typescript
// src/hono/middleware/auth.ts
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'

export const requireAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const apiKey = c.req.header('X-API-Key')
  const expected = c.env.API_KEY  // plain wrangler secret
  if (!apiKey || apiKey !== expected) {
    throw new HTTPException(401, { message: 'Unauthorized' })
  }
  await next()
})
```

Apply to protected routes: `router.use('*', requireAuth)`

---

## Middleware Ordering Convention

```
cors → logger → auth (if needed) → withDb → route handler
```
