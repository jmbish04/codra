<div align="center">
  <h1>Codra</h1>

  <p>
    Self-hosted AI code review for GitHub pull requests.<br/>
    Cloudflare-native, queue-backed, repository-aware, and built for teams that want to own their review engine.
  </p>

  <p>
    <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg"></a>
    <a href="https://workers.cloudflare.com/"><img alt="Cloudflare Workers" src="https://img.shields.io/badge/runtime-Cloudflare%20Workers-f38020?logo=cloudflare"></a>
    <a href="https://react.dev/"><img alt="Built with React" src="https://img.shields.io/badge/dashboard-React-61dafb?logo=react&logoColor=111"></a>
    <a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/language-TypeScript-3178c6?logo=typescript&logoColor=fff"></a>
  </p>

  <p>
    <a href="https://codra.run">Website</a>
    |
    <a href="https://codra.run/docs">Docs</a>
    |
    <a href="https://codra.run/docs/installation">Installation</a>
    |
    <a href="https://github.com/devarshishimpi/codra/issues">Issues</a>
    |
    <a href="CONTRIBUTING.md">Contributing</a>
  </p>
</div>

![Codra dashboard](./public/assets/codra-dashboard.png)

Codra listens to GitHub pull request events, runs AI-powered review jobs, posts inline findings back to the PR, and gives you a dashboard to inspect jobs, repositories, model routing, review history, and failed queue runs.

> **Beta** -- Codra is under active development. Expect rough edges, missing features, and breaking changes between releases. Feedback and bug reports are welcome via [GitHub Issues](https://github.com/devarshishimpi/codra/issues).

## Why Codra

- **Own the whole review loop**: Run the GitHub App, Cloudflare Worker, queue, database, model credentials, and dashboard under your own control.
- **Review with repository context**: Codra checks pull request diffs for correctness, security, performance, maintainability, and repo-specific patterns.
- **Configure each repository**: Tune triggers, skipped paths, draft handling, mention reviews, labels, custom rules, and review budgets from the dashboard.
- **Route models deliberately**: Use global defaults, per-repo model chains, fallbacks, and size-based overrides for larger pull requests.
- **Operate the system**: Inspect job history, PR findings, webhook deliveries, queue failures, DLQ replay, model usage, and dashboard stats.

## Features

- Automatic reviews on `opened`, `synchronize`, `ready_for_review`, and `reopened` pull request events
- Mention-triggered reviews for on-demand analysis
- Inline GitHub review comments plus summary reviews and check run updates
- Queue-backed processing through Cloudflare Queues
- Dead letter queue inspection, replay, and purge workflows
- GitHub OAuth dashboard authentication
- Durable storage on Cloudflare D1 (SQLite)
- Dashboard-managed LLM providers for OpenAI, OpenRouter, Anthropic, Google, and Cloudflare models
- Repository settings for labels, skipped globs, custom rules, and model routing

## How It Works

1. GitHub sends Codra a pull request webhook.
2. Codra verifies the signature and loads repository review settings.
3. A review job is stored in Cloudflare D1 and queued on Cloudflare Queues.
4. The Worker consumes the job, fetches the PR diff, runs model review passes, and formats findings.
5. Codra posts inline comments and a summary review back to GitHub.
6. The dashboard keeps the job history, findings, logs, stats, and replay tools available for operators.

## Stack

- **Worker**: Cloudflare Workers, Hono, Wrangler
- **Dashboard**: React, Vite, Tailwind CSS, Radix UI, Recharts
- **Data**: Cloudflare D1 (SQLite), Cloudflare KV
- **Queues**: Cloudflare Queues with DLQ workflows
- **Models**: OpenAI, OpenRouter, Anthropic, Google, and Cloudflare providers
- **GitHub**: GitHub App webhooks, checks, reviews, and OAuth
- **Quality**: TypeScript, Zod, Vitest, Playwright browser tests

## Installation, Running, and Testing

Codra uses `pnpm` for dependency management.

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Database setup:**
   Generate and apply the local SQLite schema using D1:
   ```bash
   pnpm run db:generate
   pnpm run migrate:local
   ```

3. **Run locally:**
   Start the local development server (client and worker):
   ```bash
   npm run dev
   ```

4. **Run tests:**
   Execute the test suite (Vitest and Playwright) and typechecker:
   ```bash
   npm test
   npm run typecheck
   ```
   *Note: No external database is needed; tests run on an in-memory SQLite D1 instance.*

## Docs Suite

The internal documentation suite lives in the `docs/` directory. It includes documents like `ROADMAP.md`, `REBUILD-PLAN.md`, and other guides used during development. For the source-aware review engines (OpenCode on your Mac via Workers VPC/Tunnel, or the all-Cloudflare Computer engine), see [docs/opencode-setup.md](docs/opencode-setup.md).

## Docs-gap Jules tasks & deploy workflow

- The review pipeline (`src/server/core/review.ts`) has two opt-out toggles in
  `config.review`: `jules.enabled` (docs-gap → Jules session, launched only
  on PR merge) and `deployWorkflow.enabled` (separate `codra/deploy-workflow-*`
  PR adding `.github/workflows/deploy.yml`). Both default to `true` — see
  `src/server/core/jules.ts`, `src/server/core/jules-docs-gap.ts`, and
  `src/server/core/deploy-workflow.ts`.
- Auto-setting the `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN` Actions
  secrets (`src/server/core/github-secrets.ts`) requires the GitHub App's
  **Actions Secrets: write** permission; without it, Codra writes the secret
  names and setup steps into the deploy-workflow PR body instead.

## Documentation

The full setup and operations guides live at [codra.run/docs](https://codra.run/docs). The internal documentation suite for the repository (such as the rebuild plan and roadmap) lives in the `docs/` directory at the repository root.

- [Installation guide](https://codra.run/docs/installation)
- [Configuration guide](https://codra.run/docs/configuration)
- [Deploy with Neon](https://codra.run/docs/neon)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request against `dev`. Codra uses a Contributor License Agreement for contributions.

## License

Codra is licensed under the [GNU Affero General Public License v3.0](LICENSE).
