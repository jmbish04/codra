# Deployment Pipeline

## package.json Scripts

```json
{
  "scripts": {
    "dev":            "wrangler dev --local",
    "build":          "astro build",
    "preview":        "wrangler dev",
    "types":          "wrangler types",
    "db:generate":    "drizzle-kit generate",
    "db:push":        "drizzle-kit push",
    "migrate:local":  "wrangler d1 migrations apply DB --local",
    "migrate:remote": "wrangler d1 migrations apply DB --remote",
    "deploy": "pnpm run build && pnpm run db:generate && pnpm run migrate:remote && npx wrangler@latest deploy",
    "cf-typegen":     "wrangler types"
  }
}
```

> `pnpm run deploy` is the **only** way to deploy to production. It always:
> 1. Builds Astro (`astro build`)
> 2. Generates any new migration files (`drizzle-kit generate`)
> 3. Applies migrations to the remote D1 database
> 4. Deploys the Worker via the latest wrangler

Never run `wrangler deploy` directly. Never skip `migrate:remote`.

---

## wrangler.toml Full Template

```toml
name = "my-app"
main = "dist/_worker.js"          # Astro SSR output
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat"]
assets = { directory = "dist/client" }

# ── Bindings ──────────────────────────────────────────────────────────────

[ai]
binding = "AI"

[[d1_databases]]
binding = "DB"
database_name = "my-app-db"
database_id   = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

[[kv_namespaces]]
binding  = "CACHE"
id       = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

[[r2_buckets]]
binding     = "STORAGE"
bucket_name = "my-app-storage"

# ── Secrets Store (preferred for API keys) ────────────────────────────────
# Run: wrangler secrets-store secret create my-store openai-api-key
[[secrets_store_secrets]]
binding     = "OPENAI_API_KEY"
store_id    = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
secret_name = "openai-api-key"

[[secrets_store_secrets]]
binding     = "ANTHROPIC_API_KEY"
store_id    = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
secret_name = "anthropic-api-key"

[[secrets_store_secrets]]
binding     = "GOOGLE_AI_API_KEY"
store_id    = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
secret_name = "google-ai-api-key"

# ── Variables (non-secret config) ─────────────────────────────────────────
[vars]
AI_GATEWAY_ACCOUNT_ID = "your-cloudflare-account-id"
AI_GATEWAY_GATEWAY_ID = "my-app-gateway"

# ── Production environment overrides ─────────────────────────────────────
[env.production]
name = "my-app-production"

[env.production.vars]
AI_GATEWAY_GATEWAY_ID = "my-app-gateway-production"

[[env.production.d1_databases]]
binding       = "DB"
database_name = "my-app-db-production"
database_id   = "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy"
```

---

## Post-Binding-Change Workflow

```bash
# 1. Add new binding to wrangler.toml
# 2. Regenerate TypeScript types
pnpm run types          # → updates worker-configuration.d.ts

# 3. Verify Env interface has the new binding
cat worker-configuration.d.ts

# 4. Use the binding in code — no imports needed
```

---

## Dev Environment Setup

```bash
# .dev.vars (local development overrides — never commit)
CLOUDFLARE_ACCOUNT_ID=xxx
CLOUDFLARE_DATABASE_ID=xxx
CLOUDFLARE_D1_TOKEN=xxx
```

```bash
# First-time local setup
pnpm install
pnpm run types           # generate worker-configuration.d.ts
pnpm run migrate:local   # apply migrations to local D1
pnpm run dev             # starts local dev server with live bindings
```

---

## CI/CD Pattern (GitHub Actions)

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: latest }
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm run deploy
        env:
          CLOUDFLARE_API_TOKEN:    ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID:   ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          CLOUDFLARE_DATABASE_ID:  ${{ secrets.CLOUDFLARE_DATABASE_ID }}
          CLOUDFLARE_D1_TOKEN:     ${{ secrets.CLOUDFLARE_D1_TOKEN }}
```
