import type {
  AuthSessionResponse,
  DlqResponse,
  JobDetailResponse,
  JobsResponse,
  ModelConfigsResponse,
  RepoConfigResponse,
  RepoConfigsResponse,
  RetryJobResponse,
  StatsResponse,
  SyncReposResponse,
  UpdatesEmailResponse,
} from '@shared/api';
import type { LlmApiFormat, LlmProvider, ModelConfig, RepoConfig, JobDetail, ChangelogEntry } from '@shared/schema';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function pathSegment(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Path segment cannot be empty.');
  }
  return encodeURIComponent(trimmed);
}

type QueryValue = string | number | boolean | null | undefined;
export type ModelConfigPayload = Pick<ModelConfig, 'providerId' | 'modelName' | 'rpm' | 'tpm' | 'rpd'>;
export type ProviderPayload = {
  name: string;
  apiFormat: LlmApiFormat;
  baseUrl: string | null;
  apiKey?: string;
  clearApiKey?: boolean;
  enabled: boolean;
};
type RepoConfigPatch = Partial<Pick<RepoConfig, 'review' | 'model'> & { enabled: boolean }>;

async function request<T>(input: string, init?: RequestInit) {
  const method = init?.method?.toUpperCase() ?? 'GET';
  const headers = new Headers(init?.headers);

  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  if (!SAFE_METHODS.has(method)) {
    headers.set('x-requested-with', 'XMLHttpRequest');
  }

  const response = await fetch(input, {
    credentials: 'same-origin',
    ...init,
    headers,
  });

  if (response.status === 401) {
    if (location.pathname !== '/login') {
      location.href = '/login';
    }
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function requestWithMeta<T>(input: string, init?: RequestInit) {
  const method = init?.method?.toUpperCase() ?? 'GET';
  const headers = new Headers(init?.headers);

  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  if (!SAFE_METHODS.has(method)) {
    headers.set('x-requested-with', 'XMLHttpRequest');
  }

  const response = await fetch(input, {
    credentials: 'same-origin',
    ...init,
    headers,
  });

  if (response.status === 401) {
    if (location.pathname !== '/login') {
      location.href = '/login';
    }
    throw new Error('Unauthorized');
  }

  const etag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');

  if (response.status === 304) {
    return { status: response.status, etag, lastModified, notModified: true as const };
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }

  return {
    status: response.status,
    etag,
    lastModified,
    notModified: false as const,
    data: (await response.json()) as T,
  };
}

let updatesEmailPromise: Promise<UpdatesEmailResponse> | null = null;
let updatesEmailFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const api = {
  getSession() {
    return request<AuthSessionResponse>('/api/auth/session');
  },
  logout() {
    return request<{ ok: boolean }>('/auth/logout', {
      method: 'POST',
    });
  },
  getUpdatesEmailStatus() {
    const now = Date.now();
    if (!updatesEmailPromise || (now - updatesEmailFetchTime > CACHE_TTL)) {
      updatesEmailFetchTime = now;
      updatesEmailPromise = request<UpdatesEmailResponse>('/api/auth/updates-email').catch((err) => {
        updatesEmailPromise = null;
        throw err;
      });
    }
    return updatesEmailPromise;
  },
  subscribeUpdates(email: string) {
    updatesEmailPromise = request<UpdatesEmailResponse>('/api/auth/updates-email', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }).catch((err) => {
      updatesEmailPromise = null;
      throw err;
    });
    return updatesEmailPromise;
  },
  getJobs(params: Record<string, QueryValue> = {}) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.set(key, String(value));
      }
    }
    const query = searchParams.toString();
    return request<JobsResponse>(`/api/jobs${query ? `?${query}` : ''}`);
  },
  getChangelogEntry(slug: string) {
    return request<{ entry: ChangelogEntry }>(`/api/changelog/${slug}`);
  },
  getJob(id: string, options: { etag?: string | null } = {}) {
    const headers = new Headers();
    if (options.etag) {
      headers.set('if-none-match', options.etag);
    }
    return requestWithMeta<JobDetailResponse>(`/api/jobs/${id}`, { headers });
  },
  retryJob(id: string) {
    return request<RetryJobResponse>(`/api/jobs/${id}/retry`, {
      method: 'POST',
    });
  },
  forceRestartJob(id: string) {
    return request<{ job: JobDetail }>(`/api/jobs/${id}/force-restart`, {
      method: 'POST',
    });
  },
  getRepos() {
    return request<RepoConfigsResponse>('/api/repos');
  },
  getRepo(owner: string, repo: string) {
    return request<RepoConfigResponse>(`/api/repos/${pathSegment(owner)}/${pathSegment(repo)}/config`);
  },
  getStats(days?: number) {
    const query = days ? `?days=${days}` : '';
    return request<StatsResponse>(`/api/stats${query}`);
  },
  getApiUsage() {
    return request<{
      logs: Array<{
        id: string;
        provider: string;
        model: string;
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        source: string;
        gateway_id: string;
        datetime_hour: string;
        created_at: string;
      }>;
    }>('/api/stats/usage');
  },
  syncRepos() {
    return request<SyncReposResponse>('/api/repos/sync', {
      method: 'POST',
    });
  },
  getDlqMessages(limit = 20) {
    return request<DlqResponse>(`/api/dlq?limit=${limit}`);
  },
  replayDlqMessages(leaseIds: string[]) {
    return request<{ replayedCount: number }>('/api/dlq/replay', {
      method: 'POST',
      body: JSON.stringify({ lease_ids: leaseIds }),
    });
  },
  purgeDlqMessages(leaseIds: string[]) {
    return request<{ purged: number }>('/api/dlq/purge', {
      method: 'POST',
      body: JSON.stringify({ lease_ids: leaseIds }),
    });
  },
  updateRepoConfig(owner: string, repo: string, config: RepoConfigPatch) {
    return request<{ ok: boolean }>(`/api/repos/${pathSegment(owner)}/${pathSegment(repo)}/config`, {
      method: 'PATCH',
      body: JSON.stringify(config),
    });
  },
  getModelConfigs() {
    return request<ModelConfigsResponse>('/api/models');
  },
  refreshModelCatalog() {
    return request<ModelConfigsResponse>('/api/models/sync', {
      method: 'POST',
    });
  },
  updateModelConfig(id: string, config: ModelConfigPayload) {
    return request<{ ok: boolean; config: ModelConfig }>(`/api/models/${pathSegment(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(config),
    });
  },
  deleteModelConfig(id: string) {
    return request<{ ok: boolean }>(`/api/models/${pathSegment(id)}`, {
      method: 'DELETE',
    });
  },
  createProvider(config: ProviderPayload) {
    return request<{ provider: LlmProvider }>('/api/models/providers', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },
  updateProvider(id: string, config: ProviderPayload) {
    return request<{ provider: LlmProvider }>(`/api/models/providers/${pathSegment(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(config),
    });
  },
  deleteProvider(id: string) {
    return request<{ ok: boolean }>(`/api/models/providers/${pathSegment(id)}`, {
      method: 'DELETE',
    });
  },
  testModelConfig(id: string) {
    return request<{ ok: boolean; modelUsed: string; provider: string; inputTokens: number; outputTokens: number }>(`/api/models/${pathSegment(id)}/test`, {
      method: 'POST',
    });
  },
  getGlobalConfig() {
    return request<{ config: RepoConfig['model'] }>('/api/models/global');
  },
  updateGlobalConfig(config: RepoConfig['model']) {
    return request<{ ok: boolean }>('/api/models/global', {
      method: 'PATCH',
      body: JSON.stringify(config),
    });
  },
};
