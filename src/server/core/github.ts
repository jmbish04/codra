import type { ParsedReviewComment } from '@shared/schema';
import type { AppBindings } from '@server/env';
import { withTimeout } from '@server/core/timeout';
import { logger } from '@server/core/logger';

export class GitHubError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

async function withRetry<T>(
  operation: string,
  fn: () => Promise<T>,
  maxRetries = 2,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      const isRetryable =
        (error instanceof GitHubError && (error.status === 429 || error.status >= 500)) ||
        error.name === 'TimeoutError' ||
        error.message.includes('timeout');

      if (!isRetryable || attempt > maxRetries) {
        throw error;
      }

      const delay = Math.pow(2, attempt) * 1000;
      logger.warn(`Retrying GitHub operation ${operation} (attempt ${attempt}/${maxRetries}) in ${delay}ms`, {
        status: error instanceof GitHubError ? error.status : undefined,
        error: error.message,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export type GitHubInstallation = {
  id: number;
};

export type GitHubRepository = {
  name: string;
  owner: {
    login: string;
  };
};

/** Default timeout for every GitHub API call (30 s). */
const GITHUB_TIMEOUT_MS = 30_000;

type InstallationTokenCacheRecord = {
  token: string;
  expiresAt: string;
};

type PullRequestRecord = {
  number: number;
  title: string | null;
  body: string | null;
  draft: boolean;
  head: { sha: string; ref: string };
  base: { sha: string; ref: string };
  user: { login: string };
};

export type GitHubReviewComment = {
  path: string;
  position?: number;
  body: string;
};

function installationCacheKey(installationId: string) {
  return `install:${installationId}`;
}

function pemToArrayBuffer(pem: string) {
  const base64 = pem
    .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/g, '')
    .replace(/-----END (RSA )?PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

function base64UrlEncode(input: string) {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function createGitHubJwt(appId: string, privateKeyPem: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId,
    }),
  );

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`));
  const signatureString = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  return `${header}.${payload}.${signatureString}`;
}

async function readCachedInstallationToken(env: Pick<AppBindings, 'APP_KV'>, installationId: string) {
  const cached = await env.APP_KV.get(installationCacheKey(installationId), 'json');
  return cached as InstallationTokenCacheRecord | null;
}

async function writeCachedInstallationToken(
  env: Pick<AppBindings, 'APP_KV'>,
  installationId: string,
  record: InstallationTokenCacheRecord,
) {
  const expiresAt = new Date(record.expiresAt).getTime();
  const ttl = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000) - 300);
  await env.APP_KV.put(installationCacheKey(installationId), JSON.stringify(record), { expirationTtl: ttl });
}

export class GitHubClient {
  constructor(
    private readonly env: Pick<
      AppBindings,
      'APP_KV' | 'APP_PRIVATE_KEY' | 'GITHUB_APP_ID' | 'BOT_USERNAME'
    >,
    private readonly installationId: string,
  ) {}

  async getInstallationToken(): Promise<string> {
    const cached = await readCachedInstallationToken(this.env, this.installationId);
    if (cached?.token) {
      return cached.token;
    }

    return withRetry('getInstallationToken', async () => {
      const jwt = await createGitHubJwt(this.env.GITHUB_APP_ID, this.env.APP_PRIVATE_KEY);

      const response = await withTimeout('GitHub installation token', GITHUB_TIMEOUT_MS, (signal) =>
        fetch(`https://api.github.com/app/installations/${this.installationId}/access_tokens`, {
          method: 'POST',
          signal,
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${jwt}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': this.env.BOT_USERNAME ?? 'codra-bot',
          },
        }),
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new GitHubError(
          response.status,
          errText,
          '/app/installations/.../access_tokens',
          `GitHub installation token request failed with ${response.status}: ${errText}`,
        );
      }

      const data = (await response.json()) as { token: string; expires_at: string };
      await writeCachedInstallationToken(this.env, this.installationId, {
        token: data.token,
        expiresAt: data.expires_at,
      });

      return data.token;
    });
  }

  static async listInstallations(
    env: Pick<AppBindings, 'APP_PRIVATE_KEY' | 'GITHUB_APP_ID' | 'BOT_USERNAME'>,
  ): Promise<GitHubInstallation[]> {
    return withRetry('listInstallations', async () => {
      const jwt = await createGitHubJwt(env.GITHUB_APP_ID, env.APP_PRIVATE_KEY);
      const response = await withTimeout('GitHub list installations', GITHUB_TIMEOUT_MS, (signal) =>
        fetch('https://api.github.com/app/installations', {
          signal,
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${jwt}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': env.BOT_USERNAME ?? 'codra-bot',
          },
        }),
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new GitHubError(
          response.status,
          errText,
          '/app/installations',
          `GitHub list installations failed with ${response.status}: ${errText}`,
        );
      }

      return (await response.json()) as GitHubInstallation[];
    });
  }

  async listRepositories(): Promise<GitHubRepository[]> {
    return withRetry('listRepositories', async () => {
      const response = await this.requestAndCheck('/installation/repositories');
      const data = (await response.json()) as { repositories: GitHubRepository[] };
      return data.repositories;
    });
  }

  private async request(
    path: string,
    init: RequestInit = {},
    accept = 'application/vnd.github+json',
  ): Promise<Response> {
    const token = await this.getInstallationToken();

    return withTimeout(`GitHub ${init.method ?? 'GET'} ${path}`, GITHUB_TIMEOUT_MS, (signal) =>
      fetch(`https://api.github.com${path}`, {
        ...init,
        signal,
        headers: {
          Accept: accept,
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': this.env.BOT_USERNAME ?? 'codra-bot',
          ...(init.headers ?? {}),
        },
      }),
    );
  }

  private async requestAndCheck(
    path: string,
    init: RequestInit = {},
    accept = 'application/vnd.github+json',
  ): Promise<Response> {
    const response = await this.request(path, init, accept);
    if (!response.ok) {
      const errText = await response.text();
      throw new GitHubError(
        response.status,
        errText,
        path,
        `GitHub API ${init.method ?? 'GET'} ${path} failed with ${response.status}: ${errText}`,
      );
    }
    return response;
  }

  async getPullRequest(owner: string, repo: string, pullNumber: number) {
    return withRetry(`getPullRequest ${owner}/${repo}#${pullNumber}`, async () => {
      const response = await this.requestAndCheck(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
      return (await response.json()) as PullRequestRecord;
    });
  }

  async getPullRequestDiff(owner: string, repo: string, pullNumber: number) {
    return withRetry(`getPullRequestDiff ${owner}/${repo}#${pullNumber}`, async () => {
      const response = await this.requestAndCheck(
        `/repos/${owner}/${repo}/pulls/${pullNumber}`,
        {},
        'application/vnd.github.v3.diff',
      );
      return response.text();
    });
  }

  async getRepoFileOrNull(owner: string, repo: string, path: string) {
    return withRetry(`getRepoFileOrNull ${owner}/${repo}/${path}`, async () => {
      const response = await this.request(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        const errText = await response.text();
        throw new GitHubError(
          response.status,
          errText,
          path,
          `GitHub repo file fetch failed with ${response.status}: ${errText}`,
        );
      }

      const data = (await response.json()) as { content?: string; encoding?: string };
      if (!data.content) {
        return null;
      }

      return data.encoding === 'base64' ? atob(data.content.replace(/\n/g, '')) : data.content;
    });
  }

  async createCheckRun(
    owner: string,
    repo: string,
    input: { headSha: string; title: string; summary: string; detailsUrl?: string },
  ) {
    return withRetry(`createCheckRun ${owner}/${repo}`, async () => {
      const response = await this.requestAndCheck(`/repos/${owner}/${repo}/check-runs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Codra',
          head_sha: input.headSha,
          status: 'in_progress',
          details_url: input.detailsUrl,
          output: {
            title: input.title,
            summary: input.summary,
          },
        }),
      });

      return (await response.json()) as { id: number };
    });
  }

  async updateCheckRun(
    owner: string,
    repo: string,
    checkRunId: number,
    input: {
      title: string;
      summary: string;
      status?: 'in_progress' | 'completed';
      conclusion?: 'success' | 'neutral' | 'failure';
    },
  ) {
    return withRetry(`updateCheckRun ${owner}/${repo} ${checkRunId}`, async () => {
      await this.requestAndCheck(`/repos/${owner}/${repo}/check-runs/${checkRunId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          status: input.status ?? 'in_progress',
          conclusion: input.conclusion,
          completed_at: input.status === 'completed' ? new Date().toISOString() : undefined,
          output: {
            title: input.title,
            summary: input.summary,
          },
        }),
      });
    });
  }

  async createReview(
    owner: string,
    repo: string,
    pullNumber: number,
    input: {
      commitSha: string;
      event: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES';
      body: string;
      comments: GitHubReviewComment[];
    },
  ) {
    return withRetry(`createReview ${owner}/${repo}#${pullNumber}`, async () => {
      const body = {
        commit_id: input.commitSha,
        event: input.event,
        body: input.body,
        comments: input.comments
          .filter((comment) => comment.position)
          .map((comment) => ({
            path: comment.path,
            position: comment.position,
            body: comment.body,
          })),
      };

      let response = await this.request(`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (response.status === 422 && body.comments.length > 0) {
        logger.warn(`GitHub review creation failed with 422, retrying without inline comments`, {
          owner,
          repo,
          pullNumber,
        });
        response = await this.request(`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            commit_id: input.commitSha,
            event: input.event,
            body: input.body,
            comments: [],
          }),
        });
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new GitHubError(
          response.status,
          errText,
          `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`,
          `GitHub review creation failed with ${response.status}: ${errText}`,
        );
      }

      return (await response.json()) as { id: number };
    });
  }

  async ensureLabel(owner: string, repo: string, name: string, color: string) {
    return withRetry(`ensureLabel ${owner}/${repo} ${name}`, async () => {
      const listResponse = await this.request(`/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`);
      if (listResponse.ok) {
        return;
      }
      if (listResponse.status !== 404) {
        const errText = await listResponse.text();
        throw new GitHubError(
          listResponse.status,
          errText,
          name,
          `GitHub label lookup failed with ${listResponse.status}: ${errText}`,
        );
      }

      const createResponse = await this.request(`/repos/${owner}/${repo}/labels`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name, color }),
      });

      if (!createResponse.ok && createResponse.status !== 422) {
        const errText = await createResponse.text();
        throw new GitHubError(
          createResponse.status,
          errText,
          name,
          `GitHub label creation failed with ${createResponse.status}: ${errText}`,
        );
      }
    });
  }

  async addIssueLabels(owner: string, repo: string, issueNumber: number, labels: string[]) {
    return withRetry(`addIssueLabels ${owner}/${repo}#${issueNumber}`, async () => {
      await this.requestAndCheck(`/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ labels }),
      });
    });
  }

  async removeIssueLabel(owner: string, repo: string, issueNumber: number, label: string) {
    return withRetry(`removeIssueLabel ${owner}/${repo}#${issueNumber} ${label}`, async () => {
      const response = await this.request(
        `/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
        {
          method: 'DELETE',
        },
      );

      if (!response.ok && response.status !== 404) {
        const errText = await response.text();
        throw new GitHubError(
          response.status,
          errText,
          label,
          `GitHub label removal failed with ${response.status}: ${errText}`,
        );
      }
    });
  }
}
