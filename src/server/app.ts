import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '@server/env';
import { requireSession } from '@server/middleware/auth';
import { computeJobHealth } from '@server/core/health';
import { requireCsrfHeader } from '@server/middleware/csrf';
import { observability } from '@server/middleware/observability';
import { createAuthRouter } from '@server/routes/auth';
import { createWebhookRouter } from '@server/routes/webhook';
import { createReviewsRouter } from '@server/routes/reviews';
import { createAuthApiRouter } from '@server/routes/api/auth';
import { createJobsRouter } from '@server/routes/api/jobs';
import { createReposRouter } from '@server/routes/api/repos';
import { createStatsRouter } from '@server/routes/api/stats';
import { createDlqRouter } from '@server/routes/api/dlq';
import { createModelsRouter } from '@server/routes/api/models';
import { createPromptsRouter } from '@server/routes/api/prompts';
import { createBestPracticesRouter } from '@server/routes/api/best-practices';
import { createChangelogRouter } from '@server/routes/api/changelog';
import { createWebhooksRouter } from '@server/routes/api/webhooks';
import { createStandardizationRouter } from '@server/routes/api/standardization';
import { createDocsReviewRouter } from '@server/routes/api/docs-review';
import { createActionsRouter } from '@server/routes/api/actions';
import { createJulesSessionsRouter } from '@server/routes/api/jules-sessions';
import { createPlanningPackagesRouter } from '@server/routes/api/planning-packages';
import { createPublicPlanningRouter } from '@server/routes/public-planning';
import { createAgentRouter } from '@server/routes/api/agent';
import { createSecretBindingsRouter } from '@server/routes/api/secret-bindings';
import { createTestConfigRouter } from '@server/routes/api/test-config';

/**
 * serveIndex
 */
async function serveIndex(c: Context<AppEnv>) {
  return c.env.ASSETS.fetch(new URL('/index.html', c.req.url));
}

/**
 * createApp
 */
export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('*', observability);
  app.use('/auth/logout', requireSession);
  app.use('/auth/logout', requireCsrfHeader);

  app.route('/auth', createAuthRouter());
  app.route('/webhook', createWebhookRouter());
  // Public read-only review-suggestions feed (before the /api/* session guard).
  app.route('/reviews', createReviewsRouter());
  // Public, capability-gated (unguessable uuid) read-only planning-package export.
  // Mounted before the /api/* session guard so Jules can pull revisions via curl.
  app.route('/api/public/planning-packages', createPublicPlanningRouter());
  // Machine-to-machine watcher-daemon endpoints (WORKER_API_KEY guarded, headless).
  app.route('/api/agent', createAgentRouter());

  // The MCP OAuth surface (/.well-known/oauth-*, /oauth) was removed with the
  // GitHubLikeMCP server (/mcp) — the Cloudflare Agents SDK is gone.

  // Unauthenticated liveness probe for uptime monitors. Returns only
  // operational status (no job contents) and 503 when the pipeline is stuck.
  app.get('/healthz', async (c) => {
    const health = await computeJobHealth(c.env);
    return c.json(
      { healthy: health.healthy, checkedAt: health.checkedAt, reasons: health.reasons, stuckCount: health.stuck.length },
      health.healthy ? 200 : 503,
    );
  });

  app.use('/api/*', requireSession);
  app.use('/api/*', requireCsrfHeader);

  app.route('/api/auth', createAuthApiRouter());
  app.route('/api/jobs', createJobsRouter());
  app.route('/api/changelog', createChangelogRouter());
  app.route('/api/repos', createReposRouter());
  app.route('/api/stats', createStatsRouter());
  app.get('/api/health', async (c) => c.json(await computeJobHealth(c.env)));
  app.route('/api/dlq', createDlqRouter());
  app.route('/api/models', createModelsRouter());
  app.route('/api/prompts', createPromptsRouter());
  app.route('/api/best-practices', createBestPracticesRouter());
  app.route('/api/webhooks', createWebhooksRouter());
  app.route('/api/standardization', createStandardizationRouter());
  app.route('/api/actions', createActionsRouter());
  app.route('/api/jules-sessions', createJulesSessionsRouter());
  app.route('/api/planning-packages', createPlanningPackagesRouter());
  app.route('/api/secret-bindings', createSecretBindingsRouter());
  app.route('/api/test-config', createTestConfigRouter());
  app.route('/api/docs-review-rules', createDocsReviewRouter());

  // The /mcp endpoint (GitHubLikeMCP DO) was removed with the Cloudflare Agents SDK.

  app.get('/login', serveIndex);
  app.get('/', serveIndex); // Unauthenticated landing page
  app.get('/dashboard', requireSession, serveIndex);
  app.get('/jobs', requireSession, serveIndex);
  app.get('/jobs/*', requireSession, serveIndex);
  app.get('/repos', requireSession, serveIndex);
  app.get('/stats', requireSession, serveIndex);
  app.get('/health', requireSession, serveIndex);
  app.get('/best-practices', requireSession, serveIndex);
  app.get('/jules', requireSession, serveIndex);
  app.get('/jules/*', requireSession, serveIndex);
  app.get('/planning', requireSession, serveIndex);
  app.get('/planning/*', requireSession, serveIndex);
  app.get('/settings', requireSession, serveIndex);
  app.get('/settings/*', requireSession, serveIndex);

  return app;
}
