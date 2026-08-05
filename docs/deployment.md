# Deployment

[Return to Index](./README.md)

Codra is designed to be deployed on Cloudflare Workers.

## Requirements
- A Cloudflare account
- Wrangler CLI installed globally or via project scripts
- Properly configured `wrangler.jsonc`

## Deploying
To deploy the worker and its bindings:

```bash
npx wrangler deploy
```

Ensure your remote database migrations are up to date:
```bash
npm run migrate:remote
```
