# Environment variable + lifecycle script naming

Names that propagate across local dev, CI, GitHub Actions, wrangler, and `.dev.vars` need to be canonical. Two competing names produce two competing secrets and silent failures.

## Preferred names

| Use for | **Preferred name** | Banned alternative(s) |
|---|---|---|
| GitHub API token | **`GH_TOKEN`** | `GITHUB_TOKEN`, `GH_API_TOKEN`, `GH_PAT` |
| Gemini / Google AI API key | **`GEMINI_API_KEY`** | `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_AI_KEY` |
| OpenAI API key | **`OPENAI_API_KEY`** | `OPENAI_KEY`, `OAI_KEY` |
| Anthropic API key | **`ANTHROPIC_API_KEY`** | `ANTHROPIC_KEY`, `CLAUDE_API_KEY` |
| Cloudflare account ID | **`CLOUDFLARE_ACCOUNT_ID`** | `CF_ACCOUNT_ID`, `CF_ACCOUNT` |
| Cloudflare API token | **`CLOUDFLARE_API_TOKEN`** | `CF_API_TOKEN`, `CLOUDFLARE_TOKEN` |
| Git commit hash injected at build | **`GIT_SHA`** | `GIT_COMMIT`, `VCS_REV`, `BUILD_SHA` |

## Why GH_TOKEN over GITHUB_TOKEN

GitHub Actions automatically injects a `GITHUB_TOKEN` with workflow-scoped permissions. If your app also reads `GITHUB_TOKEN` from env, you'll silently use the Actions-injected version (which has restricted scopes) instead of your PAT (full scopes). Naming yours `GH_TOKEN` prevents that collision.

## Why GEMINI_API_KEY over GOOGLE_GENERATIVE_AI_API_KEY

The Vercel AI SDK historically named this `GOOGLE_GENERATIVE_AI_API_KEY` but Google's own docs and the Gemini API use `GEMINI_API_KEY`. The shorter, vendor-canonical name avoids 30-character variable name fatigue and matches what the user sees in the Gemini console.

## Wiring into wrangler

Local dev — `.dev.vars` (gitignored):

```bash
GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GEMINI_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Production — `wrangler secret put`:

```bash
wrangler secret put GH_TOKEN
wrangler secret put GEMINI_API_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
```

`worker-configuration.d.ts` regenerates after each `wrangler types`, exposing them as typed members of `Env`.

## Lifecycle script naming

`package.json` scripts must use these canonical names:

| Script | Purpose |
|---|---|
| `dev` | `wrangler dev` or `astro dev` for local development |
| `build` | `astro build` (or framework-equivalent) |
| `deploy` | full deploy: `pnpm run build && pnpm run migrate:db && wrangler deploy` |
| `migrate:db` | `drizzle-kit generate && drizzle-kit migrate` (or the equivalent two-step) |
| `db:generate` | `drizzle-kit generate` — emit migration SQL only |
| `db:push` | `drizzle-kit push` — apply schema directly (dev only) |
| `db:studio` | `drizzle-kit studio` — open the local studio |
| `smoke` | curl the six observability endpoints, fail on non-200 |
| `types` | `wrangler types` — regenerate `worker-configuration.d.ts` |
| `lint` | `eslint .` or `biome check .` |
| `test` | unit/integration test runner |

Banned alternatives:

- ❌ `db-migrate` / `migrate-db` (use `migrate:db` per the colon-separated convention).
- ❌ `database:migrate` (too long).
- ❌ `deploy:prod` for the default deploy target — `deploy` IS prod, name it accordingly.
- ❌ Separate `deploy:staging` / `deploy:prod` if you only have one env — keep it simple.

## Example package.json fragment

```json
{
  "scripts": {
    "dev": "wrangler dev --remote=false --port 8787",
    "build": "astro build",
    "deploy": "pnpm run build && pnpm run migrate:db && wrangler deploy",
    "migrate:db": "drizzle-kit generate && drizzle-kit migrate",
    "db:generate": "drizzle-kit generate",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio",
    "types": "wrangler types",
    "smoke": "bash scripts/smoke.sh",
    "lint": "biome check .",
    "test": "vitest"
  }
}
```

## Detecting non-canonical names

```bash
# in env files
grep -rn "GITHUB_TOKEN\|GOOGLE_GENERATIVE_AI_API_KEY\|GOOGLE_API_KEY" .dev.vars wrangler.toml .env 2>/dev/null

# in source
grep -rn "env.GITHUB_TOKEN\|env.GOOGLE_GENERATIVE_AI_API_KEY" src/ backend/ 2>/dev/null

# in package.json
jq -r '.scripts | keys[]' package.json | grep -E "^db-migrate$|^migrate-db$|^database:" || echo "all good"
```

Each match is a rename target.
