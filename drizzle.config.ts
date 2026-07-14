import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/server/db/schemas/index.ts',
  out: './db/migrations/d1',
  dialect: 'sqlite',
  driver: 'd1-http',
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
    databaseId: 'f8ff86ca-a45e-428f-b5b2-80c8e427e924',
    token: process.env.CLOUDFLARE_WRANGLER_API_TOKEN || '',
  },
});
