import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { getReviewSuggestions } from '@server/db/jobs';
import { getTestReport } from '@server/db/test-targets';
import { jsonError } from '@server/core/http';

/**
 * Public, read-only review-suggestions feed. A review agent can pull the
 * machine-readable suggestions for a completed review by the (unguessable) job
 * id linked in the PR comment. No dashboard session required.
 */
export function createReviewsRouter() {
  const app = new Hono<AppEnv>();

  app.get('/:id', async (c) => {
    const jobId = c.req.param('id').replace(/\.json$/i, '');
    const result = await getReviewSuggestions(c.env, jobId);
    if (!result) return jsonError('Review not found.', 404);
    const response = c.json(result);
    response.headers.set('Cache-Control', 'public, max-age=60');
    return response;
  });

  /** GET /reviews/:id/tests.json — public API/frontend test report for a job. */
  app.get('/:id/tests.json', async (c) => {
    const report = await getTestReport(c.env, c.req.param('id'));
    if (!report) return jsonError('Test report not found.', 404);
    const response = c.json(report);
    response.headers.set('Cache-Control', 'public, max-age=30');
    return response;
  });

  return app;
}
