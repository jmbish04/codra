# API Endpoints

[Return to Index](../README.md)

Codra provides a RESTful API powered by Hono on Cloudflare Workers.

The API endpoints handle tasks such as webhook ingestion, dashboard data retrieval, job management, and AI interactions. Authentication is required for dashboard endpoints, typically managed via GitHub OAuth tokens.

The webhook endpoint (`/api/github/webhook`) validates signatures using `WORKER_API_KEY`.