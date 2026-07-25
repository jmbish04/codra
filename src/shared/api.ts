import type { JobDetail, JobSummary, RepoConfigRecord, StatsPayload } from './schema';

export type AuthSessionUser = {
  githubUserId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  email: string | null;
  signedInAt: string;
};

export type ApiErrorPayload = {
  error: string;
};

export type JobsResponse = {
  jobs: JobSummary[];
  total: number;
};

export type AuthSessionResponse = {
  user: AuthSessionUser;
};

export type UpdatesEmailStatus = 'pending' | 'subscribed';

export type UpdatesEmailResponse = {
  status: UpdatesEmailStatus;
  email: string | null;
  updatedAt: string | null;
};

export type JobDetailResponse = {
  job: JobDetail;
};

export type RetryJobResponse = {
  job: JobSummary;
};

export type RepoConfigsResponse = {
  repos: RepoConfigRecord[];
};

export type RepoConfigResponse = {
  repo: RepoConfigRecord;
};

export type StatsResponse = {
  stats: StatsPayload;
};

export type SyncReposResponse = {
  ok: boolean;
  synced: string[];
};

export type DlqMessage = {
  lease_id: string;
  body: unknown;
  metadata: {
    attempts: number;
    timestamp: string;
  };
};

export type DlqResponse = {
  messages: DlqMessage[];
  count: number;
};

export type ModelConfigsResponse = {
  providers: import('./schema').LlmProvider[];
  configs: import('./schema').ModelConfig[];
  syncErrors?: Array<{ providerId: string; providerName: string; error: string }>;
};

export type WebhookDeliverySummary = {
  id: string;
  received_at: string;
  event_name: string;
  outcome: string;
  action: string | null;
  pr_number: number | null;
  job_id: string | null;
  error: string | null;
  owner: string | null;
  repo: string | null;
};

export type WebhookDeliveriesResponse = {
  items: WebhookDeliverySummary[];
  total: number;
};

export type WebhookDeliveryDetailResponse = {
  delivery: WebhookDeliverySummary & { payload: unknown };
};

export type PrSyncRepoStat = {
  owner: string;
  repo: string;
  openPrs: number;
  enqueued: number;
  skipped: number;
  errors: number;
};

export type PrSyncResponse = {
  ok: boolean;
  repos: PrSyncRepoStat[];
  totalEnqueued: number;
};

export type StandardizationStrategy = 'create_if_missing' | 'merge_json' | 'merge_mcp_servers' | 'overwrite';

export type StandardizationRule = {
  id: string;
  target_path: string;
  source_url: string;
  strategy: StandardizationStrategy;
  enabled: boolean;
  sort_order: number;
  updated_at: string;
};

export type StandardizationRulesResponse = {
  rules: StandardizationRule[];
};

export type StandardizationRuleResponse = {
  rule: StandardizationRule;
};

export type AgentAction = {
  id: string;
  created_at: string;
  owner: string;
  repo: string;
  action_type: string;
  summary: string;
  files: string[];
  pr_number: number | null;
  pr_url: string | null;
  triggering_pr_number: number | null;
  triggering_job_id: string | null;
};

export type AgentActionsResponse = {
  actions: AgentAction[];
};

export type SecretsStoreSecretInfo = { name: string; comment: string | null };
export type AvailableSecretsResponse = { store_id: string; secrets: SecretsStoreSecretInfo[] };

export type StandardSecretBinding = {
  id: string;
  binding_name: string;
  secret_name: string;
  store_id: string;
  description: string | null;
  enabled: boolean;
  updated_at: string;
};
export type StandardSecretBindingsResponse = { bindings: StandardSecretBinding[] };

export type MissingSecretReport = {
  id: string;
  created_at: string;
  owner: string;
  repo: string;
  secret_name: string;
  store_id: string;
  triggering_pr_number: number | null;
  resolved: boolean;
};
export type MissingSecretReportsResponse = { reports: MissingSecretReport[] };

export type WebhookOutcomeStat = { outcome: string; count: number };
export type WebhookStatsResponse = { stats: WebhookOutcomeStat[] };
export type WebhookRepoRef = { owner: string; repo: string };
export type WebhookReposResponse = { repos: WebhookRepoRef[] };

export type RepoTestConfig = {
  baseUrl: string | null;
  hasApiKey: boolean;
  hasFrontendPassword: boolean;
};
export type TestConfigResponse = { repo: string; config: RepoTestConfig };
