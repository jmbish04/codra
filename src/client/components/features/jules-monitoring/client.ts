const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type JulesMonitorStatus =
  | 'pending'
  | 'planning'
  | 'plan_review'
  | 'awaiting_feedback'
  | 'executing'
  | 'pr_ready'
  | 'accepted'
  | 'stuck'
  | 'failed';

export type JulesActivityType =
  | 'userMessaged'
  | 'agentMessaged'
  | 'planGenerated'
  | 'planApproved'
  | 'progressUpdated'
  | 'sessionCompleted'
  | 'sessionFailed'
  | string;

export type JulesArtifact = {
  type: 'changeSet' | 'bashOutput' | 'media' | string;
  label?: string | null;
  summary?: string | null;
  command?: string | null;
  output?: string | null;
  exitCode?: number | null;
  additions?: number | null;
  deletions?: number | null;
  files?: number | null;
};
export type JulesActivity = {
  id: string;
  name: string;
  type: JulesActivityType;
  originator: 'agent' | 'user' | 'system' | string;
  createTime: string;
  description?: string | null;
  message?: string | null;
  title?: string | null;
  reason?: string | null;
  plan?: {
    id: string;
    steps: Array<{ id: string; title: string; description?: string | null; index?: number }>;
  } | null;
  planId?: string | null;
  artifacts: JulesArtifact[];
};

export type JulesMonitorTask = {
  taskId: string;
  packageId: string;
  packageTitle: string;
  packageSlug: string;
  repositoryId: number;
  repository: string;
  sessionId: string | null;
  sessionUrl: string | null;
  status: JulesMonitorStatus;
  iterations: number;
  lastPrUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JulesMonitorEvent = {
  id: string;
  taskId: string;
  event: string;
  summary: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

export type JulesMonitorHealth = {
  mode: 'external_watcher' | 'cron' | 'hybrid' | 'unknown';
  watcher: {
    state: 'online' | 'stale' | 'offline' | 'unknown';
    lastSeenAt: string | null;
    activeSessions: number;
    hostname: string | null;
  };
  poller: {
    state: 'healthy' | 'delayed' | 'unknown';
    lastRunAt: string | null;
    nextRunAt: string | null;
  };
};

export type JulesMonitorSummary = {
  total: number;
  active: number;
  needsAttention: number;
  accepted: number;
  counts: Partial<Record<JulesMonitorStatus, number>>;
  health: JulesMonitorHealth;
};

export type ListJulesMonitorTasksParams = {
  status?: JulesMonitorStatus | 'active' | 'terminal' | 'all';
  repository?: string;
  query?: string;
  limit?: number;
  offset?: number;
};

export type ListJulesActivitiesParams = {
  after?: string;
  limit?: number;
};

type JulesMonitorTasksResponse = {
  tasks: JulesMonitorTask[];
  total: number;
  summary: JulesMonitorSummary;
};

type JulesMonitorTaskResponse = {
  task: JulesMonitorTask;
  health: JulesMonitorHealth;
};

type JulesMonitorEventsResponse = {
  events: JulesMonitorEvent[];
};

type JulesActivitiesResponse = {
  activities: JulesActivity[];
  nextCursor: string | null;
  syncedAt: string | null;
};

function pathSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('A task id is required.');
  return encodeURIComponent(trimmed);
}

function queryString(values: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method?.toUpperCase() ?? 'GET';
  const headers = new Headers(init?.headers);
  headers.set('accept', 'application/json');
  if (!SAFE_METHODS.has(method)) {
    headers.set('content-type', 'application/json');
    headers.set('x-requested-with', 'XMLHttpRequest');
  }

  const response = await fetch(url, { credentials: 'same-origin', ...init, headers });
  if (response.status === 401) {
    if (location.pathname !== '/login') location.href = '/login';
    throw new Error('Your Codra session has expired.');
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Monitoring request failed with ${response.status}.`);
  }
  return (await response.json()) as T;
}

const ORCHESTRATION_API = '/api/planning-packages/orchestration';

/**
 * Frontend contract for Jules monitoring. Claude should implement these exact
 * Hono endpoints and map D1 snake_case rows to the camelCase DTOs above.
 */
export const julesMonitoringClient = {
  listTasks(params: ListJulesMonitorTasksParams = {}) {
    return request<JulesMonitorTasksResponse>(`${ORCHESTRATION_API}/tasks${queryString({
      status: params.status === 'all' ? undefined : params.status,
      repository: params.repository,
      query: params.query,
      limit: params.limit ?? 100,
      offset: params.offset ?? 0,
    })}`);
  },

  getTask(taskId: string) {
    return request<JulesMonitorTaskResponse>(`${ORCHESTRATION_API}/tasks/${pathSegment(taskId)}`);
  },

  listEvents(taskId: string) {
    return request<JulesMonitorEventsResponse>(`${ORCHESTRATION_API}/tasks/${pathSegment(taskId)}/events`);
  },

  listActivities(taskId: string, params: ListJulesActivitiesParams = {}) {
    return request<JulesActivitiesResponse>(`${ORCHESTRATION_API}/tasks/${pathSegment(taskId)}/activities${queryString({
      after: params.after,
      limit: params.limit ?? 200,
    })}`);
  },

  getSummary() {
    return request<{ summary: JulesMonitorSummary }>(`${ORCHESTRATION_API}/summary`);
  },
};
