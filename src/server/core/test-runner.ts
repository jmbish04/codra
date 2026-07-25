import { logger } from '@server/core/logger';
import type { GitHubService } from '@server/services/github';
import { listPendingTestTargetsForJob, updateTestTargetResult } from '@server/db/test-targets';
import { getRepoTestConfig, getRepoTestApiKey } from '@server/core/test-config';

const TEST_TIMEOUT_MS = 20_000;

/** Fill :param / {param} path placeholders from params; leftover params → query string. */
function buildUrl(baseUrl: string, path: string, params: Record<string, unknown> | null): string {
  let p = path;
  const used = new Set<string>();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      const re = new RegExp(`[:{]${k}\\}?`, 'g');
      if (re.test(p)) { p = p.replace(re, encodeURIComponent(String(v))); used.add(k); }
    }
  }
  const base = baseUrl.replace(/\/$/, '');
  const rel = p.startsWith('/') ? p : `/${p}`;
  const url = new URL(base + rel);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (!used.has(k) && v != null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function authHeaders(key: string): Record<string, string> {
  // Send the key both common ways to maximize compatibility with the target.
  return { Authorization: `Bearer ${key}`, 'X-API-Key': key, 'User-Agent': 'codra-pr-tester' };
}

async function callOnce(url: string, method: string, key: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method, headers: authHeaders(key), signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, ok: res.ok, bodySample: text.slice(0, 2000), contentType: res.headers.get('content-type') };
  } finally {
    clearTimeout(timer);
  }
}

export type PrTestSummary = {
  ran: number;
  passed: number;
  failed: number;
  blockedAuth: number;
  skipped: number;
  baseUrlMissing: boolean;
};

/**
 * Execute the pending read-only API test targets for a job against the repo's
 * configured base URL, using WORKER_API_KEY (falling back to the repo's stored
 * key). Records each result and returns a summary. MCP/frontend targets are
 * left for later phases.
 */
export async function runPrApiTests(
  env: Env,
  job: { id: string; owner: string; repo: string; prNumber: number },
): Promise<PrTestSummary> {
  const summary: PrTestSummary = { ran: 0, passed: 0, failed: 0, blockedAuth: 0, skipped: 0, baseUrlMissing: false };
  const targets = (await listPendingTestTargetsForJob(env, job.id)).filter((t) => t.kind === 'api');
  if (targets.length === 0) return summary;

  const cfg = await getRepoTestConfig(env, job.owner, job.repo);
  if (!cfg.baseUrl) {
    summary.baseUrlMissing = true;
    for (const t of targets) {
      await updateTestTargetResult(env, t.id, { status: 'skipped', error: 'No test base URL configured for this repo.' });
      summary.skipped++;
    }
    return summary;
  }

  const workerKey = await env.WORKER_API_KEY.get().catch(() => null);
  const repoKey = await getRepoTestApiKey(env, job.owner, job.repo).catch(() => null);
  const keys = [workerKey, repoKey].filter((k): k is string => Boolean(k));

  for (const t of targets) {
    const method = (t.method || 'GET').toUpperCase();
    const url = buildUrl(cfg.baseUrl, t.target, (t.params as Record<string, unknown> | null) ?? null);
    summary.ran++;
    try {
      let last: Awaited<ReturnType<typeof callOnce>> | null = null;
      let blocked = true;
      for (const key of keys.length ? keys : ['']) {
        last = await callOnce(url, method, key);
        if (last.status !== 401 && last.status !== 403) { blocked = false; break; }
      }
      if (!last) {
        await updateTestTargetResult(env, t.id, { status: 'error', error: 'No key available to test with.' });
        summary.failed++;
        continue;
      }
      if (blocked) {
        await updateTestTargetResult(env, t.id, { status: 'blocked_auth', statusCode: last.status, result: { url, method } });
        summary.blockedAuth++;
      } else if (last.ok) {
        await updateTestTargetResult(env, t.id, { status: 'passed', statusCode: last.status, result: { url, method, contentType: last.contentType, bodySample: last.bodySample } });
        summary.passed++;
      } else {
        await updateTestTargetResult(env, t.id, { status: 'failed', statusCode: last.status, result: { url, method, bodySample: last.bodySample } });
        summary.failed++;
      }
    } catch (err) {
      await updateTestTargetResult(env, t.id, { status: 'error', error: err instanceof Error ? err.message : String(err), result: { url, method } });
      summary.failed++;
    }
  }

  return summary;
}

/** The follow-up PR comment summarizing API test results. */
export function buildTestResultsComment(
  appUrl: string | undefined,
  job: { id: string },
  summary: PrTestSummary,
  targets: Array<{ kind: string; method: string | null; target: string; status: string; status_code: number | null; error: string | null }>,
): string {
  const reportLink = appUrl
    ? `\n\n<a href="${appUrl}/test-report/${job.id}" target="_blank" rel="noopener noreferrer">📊 View the full test report</a> · [JSON](${appUrl}/reviews/${job.id}/tests.json)`
    : '';

  if (summary.baseUrlMissing) {
    const cfgLink = appUrl ? `${appUrl}/testing?repo=` : '';
    return `## 🧪 Codra API Testing

Codra found read-only endpoints changed by this PR but couldn't test them: **no test base URL is configured for this repo.**

Set a base URL (and, if needed, an API key) here: <a href="${cfgLink}" target="_blank" rel="noopener noreferrer">configure PR testing</a>. Codra will run the tests and report back.${reportLink}`;
  }

  const apiTargets = targets.filter((t) => t.kind === 'api');
  const icon = (s: string) => (s === 'passed' ? '✅' : s === 'blocked_auth' ? '🔒' : s === 'skipped' ? '⏭️' : '❌');
  const rows = apiTargets
    .map((t) => `- ${icon(t.status)} \`${t.method} ${t.target}\` — **${t.status.replace('_', ' ')}**${t.status_code ? ` (${t.status_code})` : ''}${t.error ? ` — ${t.error}` : ''}`)
    .join('\n');

  const authNote = summary.blockedAuth > 0 && appUrl
    ? `\n\n> [!WARNING]\n> ${summary.blockedAuth} endpoint(s) rejected the standard \`WORKER_API_KEY\`. Provide a working API key at <a href="${appUrl}/testing?repo=" target="_blank" rel="noopener noreferrer">PR testing config</a> and codra will re-run them.`
    : '';

  return `## 🧪 Codra API Testing

Tested ${summary.ran} read-only endpoint(s): **${summary.passed} passed**, ${summary.failed} failed, ${summary.blockedAuth} auth-blocked.

${rows}${authNote}${reportLink}`;
}

export async function runAndReportPrTests(
  env: Env,
  github: GitHubService,
  job: { id: string; owner: string; repo: string; prNumber: number },
): Promise<void> {
  try {
    const summary = await runPrApiTests(env, job);
    if (summary.ran === 0 && !summary.baseUrlMissing) return; // nothing testable

    const { listTestTargetsForJob } = await import('@server/db/test-targets');
    const targets = await listTestTargetsForJob(env, job.id);
    const body = buildTestResultsComment(env.APP_URL, job, summary, targets as any);
    await github.createIssueComment(job.owner, job.repo, job.prNumber, body);
  } catch (err) {
    logger.error('runAndReportPrTests failed', err instanceof Error ? err : new Error(String(err)));
  }
}
