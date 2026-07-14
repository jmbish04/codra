# Strict Zod v4+ enforcement

Every cloudflare-jedi project uses **Zod v4 or later**. Legacy v3 patterns are banned because they collide with drizzle-zod and `@hono/zod-openapi` v3.1.0 outputs.

## Verify the version

```bash
pnpm ls zod
```

Must show `zod@^4` or higher. If older, upgrade before any schema work:

```bash
pnpm add -E zod@latest
pnpm add -E drizzle-zod@latest
pnpm add -E @hono/zod-openapi@latest
```

Also bump `@scalar/hono-api-reference` and `@hono/swagger-ui` to versions compatible with OpenAPI 3.1.

## Banned legacy patterns (v3 → v4 migration)

| v3 pattern | v4 replacement |
|---|---|
| `z.string().nonempty()` | `z.string().min(1)` |
| `z.string().email()` | `z.email()` (first-class) |
| `z.string().url()` | `z.url()` (first-class) |
| `z.string().uuid()` | `z.uuid()` (first-class) |
| `z.string().cuid()` | `z.cuid()` |
| `z.string().regex(...).refine(...)` (for compound validation) | `.refine()` is fine but prefer first-class validators where available |
| `z.preprocess(x => parseInt(x), z.number())` | `z.coerce.number()` |
| `z.string().datetime()` | `z.iso.datetime()` |
| `z.string().date()` | `z.iso.date()` |
| `z.string().time()` | `z.iso.time()` |
| `z.string().duration()` | `z.iso.duration()` |
| `z.string().ip()` | `z.ipv4()` / `z.ipv6()` (specific) |

## Required patterns in v4

### Object validation with strict mode

```typescript
// v4 — explicit strict mode for API surface
const PromptSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(200),
  body: z.string(),
  created_at: z.iso.datetime(),
}).strict()  // reject unknown keys
```

### Error formatting

```typescript
// v4 — z.treeifyError for nested error display
const parsed = PromptSchema.safeParse(input)
if (!parsed.success) {
  return c.json({ errors: z.treeifyError(parsed.error) }, 400)
}
```

### Drizzle-zod integration

```typescript
// v4-compatible drizzle-zod (must be drizzle-zod ≥0.6)
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { prompts } from './schema'

export const InsertPromptSchema = createInsertSchema(prompts).strict()
export const SelectPromptSchema = createSelectSchema(prompts).strict()
```

### Hono zod-openapi integration

```typescript
// v4-compatible @hono/zod-openapi (must be ≥0.18)
import { z } from 'zod'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

const route = createRoute({
  method: 'post',
  path: '/prompts',
  request: {
    body: { content: { 'application/json': { schema: InsertPromptSchema } } },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: SelectPromptSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
  },
})
```

## Detecting legacy patterns in an existing project

Run these greps to surface v3 leftovers:

```bash
grep -rn "z.string().nonempty()" src/ backend/
grep -rn "z.string().email()" src/ backend/
grep -rn "z.string().url()" src/ backend/
grep -rn "z.string().uuid()" src/ backend/
grep -rn "z.string().datetime()" src/ backend/
grep -rn "z.string().date()" src/ backend/
grep -rn "z.preprocess" src/ backend/
grep -rn "from 'zod'" src/ backend/ | head  # confirm all imports
```

Each match is a migration target. Schedule a refactor task in `docs/TASKS.json` if more than 5 hits.

## Why v4 over v3

- **First-class email/url/uuid validators**: avoid the `.refine()` boilerplate that doesn't serialize cleanly into OpenAPI 3.1.
- **Cleaner discriminated unions**: `z.discriminatedUnion("type", [...])` works better with `@hono/zod-openapi`.
- **Better error tree shape**: `z.treeifyError` produces structured output that maps cleanly to UI field-level error display.
- **OpenAPI 3.1 alignment**: v4 emits JSON Schema 2020-12 which is what 3.1 expects.
- **`z.coerce.*`**: cleaner than `z.preprocess` for query/path param coercion.

## Anti-patterns

- ❌ Importing `zod` v3 AND v4 in the same project (lockfile conflict).
- ❌ Mixing `z.string().email()` (v3 chained) with `z.email()` (v4 first-class) in the same project.
- ❌ Custom `.refine()` for email/url/uuid when v4 ships a first-class validator.
- ❌ Generating OpenAPI 3.0.x specs when on Zod v4 (force `openapi: '3.1.0'` in the `app.doc()` call).
- ❌ Patching drizzle-zod by hand because the v3-flavored output is different from v4-flavored.
