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
  WebhookDeliveriesResponse,
  WebhookDeliveryDetailResponse,
  PrSyncResponse,
  WebhookStatsResponse,
  WebhookReposResponse,
  StandardizationRulesResponse,
  StandardizationRuleResponse,
  StandardizationStrategy,
  AgentActionsResponse,
  TestConfigResponse,
  AvailableSecretsResponse,
  StandardSecretBindingsResponse,
  StandardSecretBinding,
  MissingSecretReportsResponse,
  JulesSessionsResponse,
  JulesSessionLiveDto,
} from '@shared/api';
import type { LlmApiFormat, LlmProvider, ModelConfig, RepoConfig, JobDetail, ChangelogEntry } from '@shared/schema';

export interface WatcherAgentDto {
  agent_id: string;
  hostname: string | null;
  version: string | null;
  active_sessions: number;
  last_seen_at: string;
}
export interface WatcherAgentsResponse {
  agents: WatcherAgentDto[];
  alive: boolean;
}

export interface OrchestrationSummaryResponse {
  summary: {
    total: number; active: number; needsAttention: number; accepted: number;
    counts: Record<string, number>;
    health: { mode: string; watcher: { state: string; lastSeenAt: string | null; activeSessions: number; hostname: string | null } };
  };
}

export interface FleetJobDto {
  job_id: string; repository_id: number; kind: string; status: string; error: string | null; created_at: string;
}
export interface FleetJobsResponse { jobs: FleetJobDto[] }

// ---- planning packages ----
export type PlanningStatus = 'draft' | 'planning' | 'in_progress' | 'pr_submitted' | 'merged' | 'rejected';
export interface PlanningPackage {
  id: string; repository_id: number; repository?: string | null; slug: string; title: string; status: PlanningStatus;
  current_revision_id: string | null; request_prompt_json: string | null; created_by: string | null;
  created_at: string; updated_at: string;
}
export interface RevisionSummary {
  id: string; package_id: string; revision_number: number; source: string; status: string;
  summary: string | null; created_at: string;
}
export interface PackageTask {
  id: string; package_id: string; task_key: string; status: string; assignee: string | null;
  pr_number: number | null; notes: string | null; updated_at: string;
}
export interface RevisionChild { id: string; ordinal: number }
export interface FullRevision extends RevisionSummary {
  problem: string | null; approach: string | null; verification: string | null;
  prd_markdown: string | null; design_brief_markdown: string | null; prompt_markdown: string | null;
  context_r2_key: string | null; context_bytes: number | null;
  changeItems: Array<RevisionChild & { kind: string; text: string }>;
  tasks: Array<RevisionChild & { task_key: string; title: string; description: string | null; phase: number | null; workstream: string | null; target_path: string | null; change_type: string | null; depends_on: string | null }>;
  fileChanges: Array<RevisionChild & { path: string; change_type: string; note: string | null }>;
  codeCards: Array<RevisionChild & { file_path: string | null; language: string | null; intent: string | null; content: string }>;
  apiChanges: Array<RevisionChild & { method: string; path: string; description: string | null }>;
  migrations: Array<RevisionChild & { tag: string | null; sql: string }>;
  diagrams: Array<RevisionChild & { caption: string | null; mermaid: string }>;
}
export interface PlanningPackagesResponse { packages: PlanningPackage[] }
export interface PlanningPackageDetailResponse { package: PlanningPackage; revisions: RevisionSummary[]; tasks: PackageTask[] }

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
  getWebhooks(params: Record<string, QueryValue> = {}) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.set(key, String(value));
      }
    }
    const query = searchParams.toString();
    return request<WebhookDeliveriesResponse>(`/api/webhooks${query ? `?${query}` : ''}`);
  },
  getWebhook(id: string) {
    return request<WebhookDeliveryDetailResponse>(`/api/webhooks/${pathSegment(id)}`);
  },
  getWebhookStats(params: Record<string, QueryValue> = {}) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    const q = sp.toString();
    return request<WebhookStatsResponse>(`/api/webhooks/stats${q ? `?${q}` : ''}`);
  },
  getWebhookRepos() {
    return request<WebhookReposResponse>('/api/webhooks/repos');
  },
  getTestConfig(repo: string) {
    return request<TestConfigResponse>(`/api/test-config?repo=${encodeURIComponent(repo)}`);
  },
  setTestConfig(repo: string, patch: { baseUrl?: string | null; apiKey?: string; frontendPassword?: string }) {
    return request<TestConfigResponse>(`/api/test-config?repo=${encodeURIComponent(repo)}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  },
  getAvailableSecrets(storeId?: string) {
    const q = storeId ? `?store_id=${encodeURIComponent(storeId)}` : '';
    return request<AvailableSecretsResponse>(`/api/secret-bindings/available${q}`);
  },
  getStandardSecretBindings() {
    return request<StandardSecretBindingsResponse>('/api/secret-bindings');
  },
  upsertStandardSecretBinding(input: { binding_name: string; secret_name: string; store_id: string; description?: string | null; enabled?: boolean }) {
    return request<{ binding: StandardSecretBinding }>('/api/secret-bindings', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  deleteStandardSecretBinding(id: string) {
    return request<{ ok: boolean }>(`/api/secret-bindings/${pathSegment(id)}`, { method: 'DELETE' });
  },
  getMissingSecretReports() {
    return request<MissingSecretReportsResponse>('/api/secret-bindings/missing');
  },
  getAgentActions(params: Record<string, QueryValue> = {}) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.set(key, String(value));
      }
    }
    const query = searchParams.toString();
    return request<AgentActionsResponse>(`/api/actions${query ? `?${query}` : ''}`);
  },
  getJulesSessions(params: Record<string, QueryValue> = {}) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.set(key, String(value));
      }
    }
    const query = searchParams.toString();
    return request<JulesSessionsResponse>(`/api/jules-sessions${query ? `?${query}` : ''}`);
  },
  getJulesSessionLive(id: string) {
    return request<JulesSessionLiveDto>(`/api/jules-sessions/${encodeURIComponent(id)}/live`);
  },
  getWatcherAgents() {
    return request<WatcherAgentsResponse>('/api/planning-packages/orchestration/agents');
  },
  getOrchestrationSummary() {
    return request<OrchestrationSummaryResponse>('/api/planning-packages/orchestration/summary');
  },
  listPlanningPackages(params: { repo?: number; status?: PlanningStatus } = {}) {
    const sp = new URLSearchParams();
    if (params.repo != null) sp.set('repo', String(params.repo));
    if (params.status) sp.set('status', params.status);
    const q = sp.toString();
    return request<PlanningPackagesResponse>(`/api/planning-packages${q ? `?${q}` : ''}`);
  },
  createPlanningPackage(body: { repositoryId?: number; owner?: string; repo?: string; title: string; requestPromptJson?: string }) {
    return request<{ package: PlanningPackage }>('/api/planning-packages', { method: 'POST', body: JSON.stringify(body) });
  },
  getPlanningPackage(id: string) {
    return request<PlanningPackageDetailResponse>(`/api/planning-packages/${pathSegment(id)}`);
  },
  patchPlanningPackage(id: string, body: { title?: string; status?: PlanningStatus; requestPromptJson?: string | null }) {
    return request<{ ok: boolean }>(`/api/planning-packages/${pathSegment(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  },
  getPlanningRevision(id: string, num: number) {
    return request<{ revision: FullRevision }>(`/api/planning-packages/${pathSegment(id)}/revisions/${num}`);
  },
  updatePlanningTask(id: string, taskKey: string, body: { status?: string; assignee?: string | null; prNumber?: number | null; notes?: string | null }) {
    return request<{ ok: boolean }>(`/api/planning-packages/${pathSegment(id)}/tasks/${pathSegment(taskKey)}`, { method: 'POST', body: JSON.stringify(body) });
  },
  orchestratePlanningPackage(id: string) {
    return request<{ taskId?: string; sessionId?: string }>(`/api/planning-packages/${pathSegment(id)}/orchestrate`, { method: 'POST' });
  },
  getFleetJobs(params: { repositoryId?: number; status?: string } = {}) {
    const sp = new URLSearchParams();
    if (params.repositoryId != null) sp.set('repositoryId', String(params.repositoryId));
    if (params.status) sp.set('status', params.status);
    const q = sp.toString();
    return request<FleetJobsResponse>(`/api/planning-packages/orchestration/fleet/jobs${q ? `?${q}` : ''}`);
  },
  getStandardizationRules() {
    return request<StandardizationRulesResponse>('/api/standardization');
  },
  createStandardizationRule(input: {
    target_path: string;
    source_url: string;
    strategy: StandardizationStrategy;
    enabled?: boolean;
    sort_order?: number;
  }) {
    return request<StandardizationRuleResponse>('/api/standardization', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  updateStandardizationRule(id: string, input: Partial<{
    target_path: string;
    source_url: string;
    strategy: StandardizationStrategy;
    enabled: boolean;
    sort_order: number;
  }>) {
    return request<StandardizationRuleResponse>(`/api/standardization/${pathSegment(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  deleteStandardizationRule(id: string) {
    return request<{ ok: boolean }>(`/api/standardization/${pathSegment(id)}`, { method: 'DELETE' });
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
