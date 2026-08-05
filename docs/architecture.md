# Architecture

[Return to Index](./README.md)

Codra is a self-hosted AI code review tool built natively for Cloudflare Workers.

## Stack Overview
- **Worker**: Cloudflare Workers, Hono, Wrangler
- **Dashboard**: React, Vite, Tailwind CSS, Radix UI, Recharts
- **Data**: Cloudflare D1 (SQLite), Cloudflare KV
- **Queues**: Cloudflare Queues with DLQ workflows
- **Models**: Integration with OpenAI, OpenRouter, Anthropic, Google, and Cloudflare providers.

Codra processes GitHub webhooks securely, queues jobs, and executes LLM-driven reviews against pull request diffs, posting results inline to GitHub.