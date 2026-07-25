import { logger } from '@server/core/logger';
import { ModelService } from '@server/services/model';
import type { GitHubService } from '@server/services/github';
import { TokenTracker } from '@server/core/token-tracker';
import type { RepoConfig } from '@shared/schema';
import { TEST_TARGETS_SCHEMA } from '@server/models/schemas';
import { addTestTargets, type TestTargetKind } from '@server/db/test-targets';

const SYSTEM_PROMPT = `You are codra's test-planner. You just reviewed a pull request diff. Identify what codra should test *after* the review.

Add a target ONLY if the PR adds or changes it AND it is READ-ONLY:
- api: an HTTP endpoint that lists resources or gets one by id. method must be GET or HEAD. NEVER include create/update/delete or anything that takes a body to mutate state.
- mcp: an MCP tool that only reads/lists (no mutations).
- frontend: a page/route a user can open in a browser.

For each target, infer example params/args from the code you reviewed (path params, query params, tool arguments) and return them as a JSON string in "params" (use realistic-but-safe values; empty string if none).
Set readOnly=false for anything that mutates — those will be filtered out. Return an empty array if nothing is worth testing. Return ONLY the structured object.`;

/**
 * After a review, ask the model which read-only endpoints / MCP tools / frontend
 * pages this PR touched, and record them as pending test targets. Best-effort:
 * never throws into the review flow.
 */
export async function detectTestTargets(
  env: Env,
  github: GitHubService,
  job: { id: string; owner: string; repo: string; prNumber: number },
  config: RepoConfig,
): Promise<number> {
  try {
    const diff = await github.getPullRequestDiff(job.owner, job.repo, job.prNumber);
    if (!diff || diff.trim().length === 0) return 0;

    const model = new ModelService(env, new TokenTracker(), { jobId: job.id });
    const res = await model.callModel(
      config.model?.main || 'claude-3-5-sonnet-latest',
      {
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: `Pull request diff (truncated):\n\n${diff.slice(0, 24000)}`,
      },
      TEST_TARGETS_SCHEMA,
    );

    let parsed: { targets?: any[] };
    try {
      parsed = JSON.parse(res.rawText);
    } catch {
      logger.warn('Test-target detection returned unparseable JSON', { job: job.id });
      return 0;
    }

    const raw = Array.isArray(parsed.targets) ? parsed.targets : [];
    const targets = raw
      .filter((t) => t && t.readOnly === true && typeof t.target === 'string' && ['api', 'mcp', 'frontend'].includes(t.kind))
      // api targets must be GET/HEAD.
      .filter((t) => t.kind !== 'api' || ['GET', 'HEAD'].includes(String(t.method || '').toUpperCase()))
      .map((t) => {
        let params: unknown = null;
        if (t.params && typeof t.params === 'string') {
          try { params = JSON.parse(t.params); } catch { params = t.params; }
        }
        return {
          jobId: job.id,
          owner: job.owner,
          repo: job.repo,
          prNumber: job.prNumber,
          kind: t.kind as TestTargetKind,
          method: t.kind === 'api' ? String(t.method || 'GET').toUpperCase() : null,
          target: t.target,
          reason: typeof t.reason === 'string' ? t.reason : null,
          params,
        };
      });

    await addTestTargets(env, targets);
    if (targets.length > 0) {
      logger.info(`Detected ${targets.length} read-only test target(s) for ${job.owner}/${job.repo}#${job.prNumber}`);
    }
    return targets.length;
  } catch (err) {
    logger.error('Test-target detection failed', err instanceof Error ? err : new Error(String(err)));
    return 0;
  }
}
