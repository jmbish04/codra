import { createApp } from '@server/app';
import { getJobForProcessing, insertJob } from '@server/db/jobs';
import { insertFileReview } from '@server/db/file-reviews';
import { getRepoConfigRecord } from '@server/db/repo-configs';
import { loadRepoConfig, updateGlobalConfig } from '@server/core/config';
import { GitHubClient } from '@server/core/github';
import { syncUpdatesEmail } from '@server/core/updates-email';
import { defaultRepoConfig, reviewJobMessageSchema } from '@shared/schema';
import type {
  AuthSessionResponse,
  JobDetailResponse,
  JobsResponse,
  RepoConfigsResponse,
  StatsResponse,
  UpdatesEmailResponse,
} from '@shared/api';
import { createTestEnv } from './helpers';
import { vi } from 'vitest';

function mockGitHubProfile(login = 'devarshishimpi') {
  return {
    id: 42,
    login,
    name: 'Devarshi Shimpi',
    avatar_url: 'https://avatars.githubusercontent.com/u/42',
    email: null,
  };
}

describe('Dashboard API Suite', () => {
  const app = createApp();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function getAuthCookie(env = createTestEnv(), login = 'devarshishimpi') {
    const originalFetch = globalThis.fetch;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);

      if (url === 'https://github.com/login/oauth/access_token') {
        return Response.json({ access_token: 'oauth-access-token' });
      }

      if (url === 'https://api.github.com/user') {
        return Response.json(mockGitHubProfile(login));
      }

      return originalFetch(input, init);
    });

    const authStart = await app.request('/auth/github', {}, env);
    const authLocation = authStart.headers.get('location');
    expect(authStart.status).toBe(302);
    expect(authLocation).toBeTruthy();

    const state = authLocation ? new URL(authLocation).searchParams.get('state') : null;
    expect(state).toBeTruthy();

    const callback = await app.request(`/auth/github/callback?code=test-code&state=${state}`, {}, env);
    const cookieHeader = callback.headers.get('set-cookie') || '';
    const match = cookieHeader.match(/codra_session=([^;]+)/);

    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/dashboard');

    return match ? match[1] : '';
  }

  it('denies access to /api/jobs without a session', async () => {
    const env = createTestEnv();
    const response = await app.request('/api/jobs', {}, env);
    expect(response.status).toBe(401);
  });

  it('starts GitHub OAuth with the configured callback and scope', async () => {
    const env = createTestEnv();
    const response = await app.request('/auth/github', {}, env);

    expect(response.status).toBe(302);

    const location = response.headers.get('location');
    expect(location).toBeTruthy();

    const url = new URL(location!);
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe(env.GITHUB_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(env.AUTH_CALLBACK_URL);
    expect(url.searchParams.get('scope')).toBe('read:user');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('rejects GitHub users outside the allowlist', async () => {
    const env = createTestEnv({ DASHBOARD_ALLOWED_USERS: 'someoneelse' });
    const originalFetch = globalThis.fetch;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://github.com/login/oauth/access_token') {
        return Response.json({ access_token: 'oauth-access-token' });
      }
      if (url === 'https://api.github.com/user') {
        return Response.json(mockGitHubProfile('devarshishimpi'));
      }
      return originalFetch(input, init);
    });

    const authStart = await app.request('/auth/github', {}, env);
    const state = new URL(authStart.headers.get('location')!).searchParams.get('state');
    const response = await app.request(`/auth/github/callback?code=test-code&state=${state}`, {}, env);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/login?error=not_allowed');
  });

  it('allows access to /api/jobs with a valid GitHub session', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);
    const response = await app.request('/api/jobs', {
      headers: { Cookie: `codra_session=${token}` },
    }, env);

    expect(response.status).toBe(200);
    const data = await response.json() as JobsResponse;
    expect(Array.isArray(data.jobs)).toBe(true);
  });

  it('rejects authenticated state-changing API requests without the CSRF header', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);

    const response = await app.request('/api/jobs/non-existent-id/retry', {
      method: 'POST',
      headers: { Cookie: `codra_session=${token}` },
    }, env);

    expect(response.status).toBe(403);
  });

  it('allows authenticated state-changing API requests with the CSRF header', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);

    const response = await app.request('/api/jobs/non-existent-id/retry', {
      method: 'POST',
      headers: {
        Cookie: `codra_session=${token}`,
        'x-requested-with': 'XMLHttpRequest',
      },
    }, env);

    expect(response.status).toBe(404);
  });

  it('rejects logout without the CSRF header', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);

    const response = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: `codra_session=${token}` },
    }, env);

    expect(response.status).toBe(403);
  });

  it('allows logout with a valid session and CSRF header', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);

    const response = await app.request('/auth/logout', {
      method: 'POST',
      headers: {
        Cookie: `codra_session=${token}`,
        'x-requested-with': 'XMLHttpRequest',
      },
    }, env);

    expect(response.status).toBe(200);
  });

  it('returns the authenticated GitHub session user', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);

    const response = await app.request('/api/auth/session', {
      headers: { Cookie: `codra_session=${token}` },
    }, env);

    expect(response.status).toBe(200);
    const data = await response.json() as AuthSessionResponse;
    expect(data.user.login).toBe('devarshishimpi');
  });

  it('syncs an updates email only once per GitHub user', async () => {
    const env = createTestEnv();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

    await expect(syncUpdatesEmail(env, 42, 'user@example.com')).resolves.toBe(true);
    await expect(syncUpdatesEmail(env, 42, 'user@example.com')).resolves.toBe(false);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('https://codra.run/api/emails', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com' }),
    }));
  });

  it('returns pending updates email status before required setup email is saved', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);

    const response = await app.request('/api/auth/updates-email', {
      headers: { Cookie: `codra_session=${token}` },
    }, env);

    expect(response.status).toBe(200);
    const data = await response.json() as UpdatesEmailResponse;
    expect(data).toMatchObject({
      status: 'pending',
      email: null,
      updatedAt: null,
    });
  });

  it('subscribes the user-entered updates email and persists it', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

    const response = await app.request('/api/auth/updates-email', {
      method: 'POST',
      headers: {
        Cookie: `codra_session=${token}`,
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: JSON.stringify({ email: 'typed@example.com' }),
    }, env);

    expect(response.status).toBe(200);
    const data = await response.json() as UpdatesEmailResponse;
    expect(data.status).toBe('subscribed');
    expect(data.email).toBe('typed@example.com');
    expect(data.updatedAt).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledWith('https://codra.run/api/emails', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'typed@example.com' }),
    }));
  });

  it('returns 404 for non-existent job detail (invalid UUID)', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);

    const response = await app.request('/api/jobs/non-existent-id', {
      headers: { Cookie: `codra_session=${token}` },
    }, env);

    expect(response.status).toBe(404);
  });

  it('fetches job details accurately', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);

    const job = await insertJob(env, {
      installationId: '123',
      owner: 'api-test-owner',
      repo: 'api-test-repo',
      prNumber: 42,
      prTitle: 'API Test PR',
      prAuthor: 'tester',
      commitSha: 'sha123',
      baseSha: 'basesha',
      trigger: 'auto',
      headRef: 'main',
      baseRef: 'main',
      configSnapshot: defaultRepoConfig,
    });

    const response = await app.request(`/api/jobs/${job.id}`, {
      headers: { Cookie: `codra_session=${token}` },
    }, env);

    expect(response.status).toBe(200);
    const data = await response.json() as JobDetailResponse;
    expect(data.job.id).toBe(job.id);
    expect(data.job.owner).toBe('api-test-owner');
    expect(data.job.prNumber).toBe(42);
    expect(data.job.files).toBeDefined();
  });

  it('fetches job details when stored comments have null code suggestions', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);

    const job = await insertJob(env, {
      installationId: '123',
      owner: 'api-test-owner',
      repo: `api-test-repo-${Date.now()}`,
      prNumber: 43,
      prTitle: 'Null suggestion PR',
      prAuthor: 'tester',
      commitSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      trigger: 'auto',
      headRef: 'feature',
      baseRef: 'main',
      configSnapshot: defaultRepoConfig,
    });

    await insertFileReview(env, {
      jobId: job.id,
      filePath: 'src/lib/slug.ts',
      fileStatus: 'done',
      modelUsed: 'gemma-4-31b-it',
      modelProvider: 'google',
      diffLineCount: 5,
      diffInput: 'diff',
      rawAiOutput: '{}',
      parsedComments: [{
        path: 'src/lib/slug.ts',
        position: 1,
        severity: 'P2',
        category: 'quality',
        title: 'Example',
        body: 'Body',
        codeSuggestion: null,
      }],
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 10,
      verdict: 'comment',
      fileSummary: 'summary',
      errorMessage: null,
    });

    const response = await app.request(`/api/jobs/${job.id}`, {
      headers: { Cookie: `codra_session=${token}` },
    }, env);

    expect(response.status).toBe(200);
    const data = await response.json() as JobDetailResponse;
    expect(data.job.files[0].parsedComments[0].codeSuggestion).toBeNull();
  });

  it('returns stats successfully', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);

    const response = await app.request('/api/stats', {
      headers: { Cookie: `codra_session=${token}` },
    }, env);

    expect(response.status).toBe(200);
    const data = await response.json() as StatsResponse;
    expect(data.stats).toHaveProperty('totals');
    expect(data.stats).toHaveProperty('trend');
    expect(data.stats).toHaveProperty('topRepos');
  });

  it('rejects invalid model config writes', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);

    const response = await app.request('/api/models/gemma-4-31b-it', {
      method: 'POST',
      headers: {
        Cookie: `codra_session=${token}`,
        'x-requested-with': 'XMLHttpRequest',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        rpm: -1,
        tpm: Number.NaN,
        rpd: 100,
        provider: 'unknown',
      }),
    }, env);

    expect(response.status).toBe(400);
  });

  it('rejects invalid global model config writes', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);

    const response = await app.request('/api/models/global', {
      method: 'PATCH',
      headers: {
        Cookie: `codra_session=${token}`,
        'x-requested-with': 'XMLHttpRequest',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        main: 'gemma-4-31b-it',
        fallbacks: 'not-an-array',
        size_overrides: {},
      }),
    }, env);

    expect(response.status).toBe(400);
  });

  it('rejects unknown fields in global model config writes', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);

    const response = await app.request('/api/models/global', {
      method: 'PATCH',
      headers: {
        Cookie: `codra_session=${token}`,
        'x-requested-with': 'XMLHttpRequest',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        main: 'gemma-4-31b-it',
        fallbacks: [],
        unexpected: true,
      }),
    }, env);

    expect(response.status).toBe(400);
  });

  it('returns repository list', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);

    const response = await app.request('/api/repos', {
      headers: { Cookie: `codra_session=${token}` },
    }, env);

    expect(response.status).toBe(200);
    const data = await response.json() as RepoConfigsResponse;
    expect(Array.isArray(data.repos)).toBe(true);
  });

  it('redirects Manage Access to the configured GitHub App install page', async () => {
    const env = createTestEnv({ GITHUB_APP_SLUG: 'my-codra-install' });
    const token = await getAuthCookie(env);

    const response = await app.request('/api/repos/install', {
      headers: { Cookie: `codra_session=${token}` },
    }, env);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://github.com/apps/my-codra-install/installations/new');
  });

  it('rejects invalid repository config patches', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);
    const repo = `invalid-config-${Date.now()}`;

    await loadRepoConfig(env, {
      installationId: '123',
      owner: 'api-test-owner',
      repo,
    });

    const response = await app.request(`/api/repos/api-test-owner/${repo}/config`, {
      method: 'PATCH',
      headers: {
        Cookie: `codra_session=${token}`,
        'x-requested-with': 'XMLHttpRequest',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        review: {
          max_files: 0,
        },
      }),
    }, env);

    expect(response.status).toBe(400);
  });

  it('rejects string booleans in repository config patches', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);
    const repo = `invalid-enabled-${Date.now()}`;

    await loadRepoConfig(env, {
      installationId: '123',
      owner: 'api-test-owner',
      repo,
    });

    const response = await app.request(`/api/repos/api-test-owner/${repo}/config`, {
      method: 'PATCH',
      headers: {
        Cookie: `codra_session=${token}`,
        'x-requested-with': 'XMLHttpRequest',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        enabled: 'false',
      }),
    }, env);

    expect(response.status).toBe(400);
  });

  it('preserves path separators when fetching nested GitHub contents', async () => {
    const env = createTestEnv();
    await env.APP_KV.put('install:123', JSON.stringify({
      token: 'cached-installation-token',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));

    let requestedUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      requestedUrl = String(input);
      return Response.json({
        content: Buffer.from('hello').toString('base64'),
        encoding: 'base64',
      });
    });

    const client = new GitHubClient(env, '123');
    const content = await client.getRepoFileOrNull('owner', 'repo', 'src/path with spaces/app.ts');

    expect(content).toBe('hello');
    expect(requestedUrl).toBe('https://api.github.com/repos/owner/repo/contents/src/path%20with%20spaces/app.ts');
  });

  it('keeps repo model settings inherited when loading global strategy', async () => {
    const env = createTestEnv();
    const repo = `global-inherit-${Date.now()}`;

    await updateGlobalConfig(env, {
      main: '@cf/zai-org/glm-4.7-flash',
      fallbacks: [],
      size_overrides: [],
    });

    const loaded = await loadRepoConfig(env, {
      installationId: '123',
      owner: 'api-test-owner',
      repo,
    });

    expect(loaded.parsedJson.model.main).toBe('@cf/zai-org/glm-4.7-flash');
    expect(loaded.parsedJson.model.fallbacks).toEqual([]);

    const record = await getRepoConfigRecord(env, 'api-test-owner', repo);
    expect(record?.mainModel).toBeNull();
    expect(record?.fallbackModels).toBeNull();
    expect(record?.sizeOverrides).toBeNull();

    await updateGlobalConfig(env, {
      main: 'gemma-4-26b-a4b-it',
      fallbacks: ['@cf/zai-org/glm-4.7-flash'],
      size_overrides: [],
    });

    const reloaded = await loadRepoConfig(env, {
      installationId: '123',
      owner: 'api-test-owner',
      repo,
    });

    expect(reloaded.parsedJson.model.main).toBe('gemma-4-26b-a4b-it');
  });

  it('uses the current global model strategy when retrying an older job', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);
    const repo = `retry-current-config-${Date.now()}`;

    const source = await insertJob(env, {
      installationId: '123',
      owner: 'api-test-owner',
      repo,
      prNumber: 12,
      prTitle: 'Retry Current Config',
      prAuthor: 'author',
      commitSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      trigger: 'auto',
      headRef: 'feature',
      baseRef: 'main',
      configSnapshot: {
        ...defaultRepoConfig,
        model: {
          main: 'gemma-4-31b-it',
          fallbacks: ['gemma-4-26b-a4b-it', '@cf/zai-org/glm-4.7-flash'],
          size_overrides: [],
        },
      },
    });

    await updateGlobalConfig(env, {
      main: 'gemma-4-31b-it',
      fallbacks: ['gemma-4-26b-a4b-it'],
      size_overrides: [
        {
          max_lines: 300,
          model: 'gemma-4-31b-it',
          fallbacks: ['gemma-4-26b-a4b-it'],
        },
      ],
    });

    const response = await app.request(`/api/jobs/${source.id}/retry`, {
      method: 'POST',
      headers: {
        Cookie: `codra_session=${token}`,
        'x-requested-with': 'XMLHttpRequest',
      },
    }, env);

    expect(response.status).toBe(202);
    const body = await response.json() as { job: { id: string } };
    const retry = await getJobForProcessing(env, body.job.id);
    const snapshot = typeof retry?.config_snapshot === 'string'
      ? JSON.parse(retry.config_snapshot)
      : retry?.config_snapshot;

    expect(snapshot.model).toEqual({
      main: 'gemma-4-31b-it',
      fallbacks: ['gemma-4-26b-a4b-it'],
      size_overrides: [
        {
          max_lines: 300,
          model: 'gemma-4-31b-it',
          fallbacks: ['gemma-4-26b-a4b-it'],
        },
      ],
    });
  });

  it('accepts legacy jobId-only queue messages during schema transition', () => {
    const parsed = reviewJobMessageSchema.safeParse({
      jobId: crypto.randomUUID(),
      deliveryId: 'legacy-delivery',
      installationId: '123',
      owner: 'api-test-owner',
      repo: 'api-test-repo',
      prNumber: 42,
      commitSha: 'abc123',
      trigger: 'auto',
    });

    expect(parsed.success).toBe(true);
  });

  it('accepts unsupported webhook events so old queue messages can be drained', () => {
    const parsed = reviewJobMessageSchema.safeParse({
      deliveryId: 'bad-event-delivery',
      eventName: 'check_suite',
    });

    expect(parsed.success).toBe(true);
  });
});
