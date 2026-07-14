# D1 + Drizzle ORM

## Required Packages

```bash
pnpm add drizzle-orm drizzle-zod
pnpm add -D drizzle-kit
```

---

## drizzle.config.ts

```typescript
import type { Config } from 'drizzle-kit'

export default {
  dialect: 'sqlite',
  schema: './backend/db/schemas/index.ts',  // root index picks up ALL domain schemas
  out: './backend/db/migrations',
  driver: 'd1-http',
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
    token: process.env.CLOUDFLARE_D1_TOKEN!,
  },
} satisfies Config
```

> `.env.local` should hold `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID`, `CLOUDFLARE_D1_TOKEN`. Never commit these. Never hardcode them.

---

## Schema Organization — Always Modular

> ⚠️ **NEVER put all tables in one file.** Use the folder-per-domain structure.
> Full pattern with examples → `references/modular-structure.md`

```
backend/db/schemas/
├── index.ts                  # re-exports ALL domains — drizzle.config.ts points here
├── projects/
│   ├── backlog/
│   │   ├── epics.ts          # one table per file
│   │   ├── stories.ts
│   │   ├── tasks.ts
│   │   └── index.ts          # re-exports backlog tables
│   ├── plans/
│   │   ├── requests.ts
│   │   └── index.ts
│   ├── todos.ts
│   └── index.ts              # re-exports backlog/, plans/, todos
└── users/
    ├── profiles.ts
    └── index.ts
```

Each table file exports: the table, `insertXxxSchema`, `selectXxxSchema`, `updateXxxSchema`, `type Xxx`, `type NewXxx`.
Each `index.ts` does nothing but `export * from './child'` — no logic.

---

## Drizzle Client Factory (`backend/db/index.ts`)

```typescript
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

export type DB = ReturnType<typeof createDb>

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema, logger: false })
}
```

Usage everywhere:
```typescript
const db = createDb(c.env.DB)
const db = createDb(runtime.env.DB)  // in Astro
```

---

## Migration Workflow

```bash
# 1. After any schema change — generate SQL migration files
pnpm run db:generate
# → creates src/db/migrations/0001_xxx.sql

# 2. Apply locally (dev)
pnpm run migrate:local

# 3. Apply to production (part of deploy script — rarely run manually)
pnpm run migrate:remote
```

> Never edit generated `.sql` migration files. If you need to change a migration, update the schema and run `db:generate` again — drizzle-kit handles the diff.

---

## Common Query Patterns

```typescript
import { eq, like, and, desc, count } from 'drizzle-orm'
import { items } from '../../backend/db/schemas'

// Select with filter + sort (ALWAYS include in list endpoints)
const result = await db
  .select()
  .from(items)
  .where(and(
    eq(items.status, 'active'),
    search ? like(items.name, `%${search}%`) : undefined,
  ))
  .orderBy(desc(items.createdAt))
  .limit(limit)
  .offset(offset)

// Count for pagination metadata
const [{ total }] = await db
  .select({ total: count() })
  .from(items)
  .where(eq(items.status, 'active'))

// Insert returning
const [created] = await db.insert(items).values(data).returning()

// Update returning
const [updated] = await db
  .update(items)
  .set({ ...data, updatedAt: new Date() })
  .where(eq(items.id, id))
  .returning()

// Delete (soft-delete preferred via status field)
await db
  .update(items)
  .set({ status: 'archived', updatedAt: new Date() })
  .where(eq(items.id, id))
```

---

## Paginated List Response Schema (standard pattern)

Always wrap list responses in a pagination envelope:

```typescript
export const paginatedSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    pagination: z.object({
      total: z.number(),
      limit: z.number(),
      offset: z.number(),
      hasMore: z.boolean(),
    }),
  })

// In route definition:
responses: {
  200: {
    description: 'Paginated items',
    content: {
      'application/json': {
        schema: paginatedSchema(selectItemSchema),
      },
    },
  },
},
```

---

## wrangler.toml D1 Binding

```toml
[[d1_databases]]
binding = "DB"
database_name = "my-app-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

[env.production.d1_databases]
binding = "DB"
database_name = "my-app-db-production"
database_id = "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy"
```
