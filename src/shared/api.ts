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
  configs: import('./schema').ModelConfig[];
};
