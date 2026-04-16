import type {
  DlqResponse,
  JobDetailResponse,
  JobsResponse,
  LoginPayload,
  RepoConfigResponse,
  RepoConfigsResponse,
  RetryJobResponse,
  StatsResponse,
  SyncReposResponse,
} from '@shared/api';

async function request<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, {
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
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

export const api = {
  login(payload: LoginPayload) {
    return request<{ ok: boolean }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  logout() {
    return request<{ ok: boolean }>('/auth/logout', {
      method: 'POST',
    });
  },
  getJobs(params: Record<string, any> = {}) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.set(key, String(value));
      }
    }
    const query = searchParams.toString();
    return request<JobsResponse>(`/api/jobs${query ? `?${query}` : ''}`);
  },
  getJob(id: string) {
    return request<JobDetailResponse>(`/api/jobs/${id}`);
  },
  retryJob(id: string) {
    return request<RetryJobResponse>(`/api/jobs/${id}/retry`, {
      method: 'POST',
    });
  },
  getRepos() {
    return request<RepoConfigsResponse>('/api/repos');
  },
  getRepo(owner: string, repo: string) {
    return request<RepoConfigResponse>(`/api/repos/${owner}/${repo}/config`);
  },
  getStats(days?: number) {
    const query = days ? `?days=${days}` : '';
    return request<StatsResponse>(`/api/stats${query}`);
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
};
