import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '@server/env';
import { requireSession } from '@server/middleware/auth';
import { requireCsrfHeader } from '@server/middleware/csrf';
import { observability } from '@server/middleware/observability';
import { createAuthRouter } from '@server/routes/auth';
import { createWebhookRouter } from '@server/routes/webhook';
import { createAuthApiRouter } from '@server/routes/api/auth';
import { createJobsRouter } from '@server/routes/api/jobs';
import { createReposRouter } from '@server/routes/api/repos';
import { createStatsRouter } from '@server/routes/api/stats';
import { createDlqRouter } from '@server/routes/api/dlq';
import { createModelsRouter } from '@server/routes/api/models';
import { createPromptsRouter } from '@server/routes/api/prompts';
import { createBestPracticesRouter } from '@server/routes/api/best-practices';
import { createChangelogRouter } from '@server/routes/api/changelog';
import { createMcpOAuthRouter } from '@server/routes/api/mcp-oauth';
import { GitHubLikeMCP } from '@server/agents/orchestrator';
import { getSecretStoreBinding } from '@server/utils/secrets';

async function serveIndex(c: Context<AppEnv>) {
  return c.env.ASSETS.fetch(new URL('/index.html', c.req.url));
}

async function verifyMcpAuth(c: Context<AppEnv>, next: any) {
  const authHeader = c.req.header('Authorization');
  
  // 1. Check Bearer Token (from OAuth flow)
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const tokenData = await c.env.APP_KV.get(`mcp_token:${token}`);
    if (tokenData) {
      return next();
    }
  }

  // 2. Check WORKER_API_KEY (from headers or query params)
  const apiKeyHeader = c.req.header('X-API-Key') || c.req.query('token');
  const expectedKey = await getSecretStoreBinding(c.env, 'WORKER_API_KEY');
  
  if (expectedKey) {
    const cleanAuthHeader = authHeader?.replace('Bearer ', '');
    if (apiKeyHeader === expectedKey || cleanAuthHeader === expectedKey) {
      return next();
    }
  }

  // RFC 9728: Return WWW-Authenticate header so Claude can discover the OAuth flow
  const origin = new URL(c.req.url).origin;
  return c.text('Unauthorized', 401, {
    'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
  });
}

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('*', observability);
  app.use('/auth/logout', requireSession);
  app.use('/auth/logout', requireCsrfHeader);

  app.route('/auth', createAuthRouter());
  app.route('/webhook', createWebhookRouter());

  // RFC 9728: Protected Resource Metadata — Claude probes this first
  app.get('/.well-known/oauth-protected-resource', (c) => {
    const origin = new URL(c.req.url).origin;
    return c.json({
      resource: `${origin}/mcp`,
      authorization_servers: [`${origin}`],
      bearer_methods_supported: ['header'],
      scopes_supported: [],
    });
  });

  // OAuth 2.1 Authorization Server Metadata
  app.get('/.well-known/oauth-authorization-server', (c) => {
    const origin = new URL(c.req.url).origin;
    return c.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      token_endpoint_auth_methods_supported: ['none'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256', 'plain'],
    });
  });

  // Mount OAuth endpoints
  app.route('/oauth', createMcpOAuthRouter());

  app.use('/api/*', requireSession);
  app.use('/api/*', requireCsrfHeader);

  app.route('/api/auth', createAuthApiRouter());
  app.route('/api/jobs', createJobsRouter());
  app.route('/api/changelog', createChangelogRouter());
  app.route('/api/repos', createReposRouter());
  app.route('/api/stats', createStatsRouter());
  app.route('/api/dlq', createDlqRouter());
  app.route('/api/models', createModelsRouter());
  app.route('/api/prompts', createPromptsRouter());
  app.route('/api/best-practices', createBestPracticesRouter());

  app.all('/mcp/*', verifyMcpAuth, async (c) => {
    return GitHubLikeMCP.serve('/mcp', { binding: 'GitHubLikeMCP' }).fetch(
      c.req.raw,
      c.env,
      c.executionCtx as any
    );
  });
  app.all('/mcp', verifyMcpAuth, async (c) => {
    return GitHubLikeMCP.serve('/mcp', { binding: 'GitHubLikeMCP' }).fetch(
      c.req.raw,
      c.env,
      c.executionCtx as any
    );
  });

  app.get('/login', serveIndex);
  app.get('/', serveIndex); // Unauthenticated landing page
  app.get('/dashboard', requireSession, serveIndex);
  app.get('/jobs', requireSession, serveIndex);
  app.get('/jobs/*', requireSession, serveIndex);
  app.get('/repos', requireSession, serveIndex);
  app.get('/stats', requireSession, serveIndex);
  app.get('/health', requireSession, serveIndex);
  app.get('/best-practices', requireSession, serveIndex);
  app.get('/settings', requireSession, serveIndex);
  app.get('/settings/*', requireSession, serveIndex);

  return app;
}
