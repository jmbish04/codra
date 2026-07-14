export const supportedGitHubWebhookEvents = ['pull_request', 'issue_comment', 'star', 'watch', 'fork'] as const;

export type GitHubWebhookEventName = typeof supportedGitHubWebhookEvents[number];

export function isSupportedGitHubWebhookEvent(eventName: string): eventName is GitHubWebhookEventName {
  return (supportedGitHubWebhookEvents as readonly string[]).includes(eventName);
}

export type PullRequestWebhookPayload = {
  action: 'opened' | 'synchronize' | 'ready_for_review' | 'reopened' | 'closed';
  installation?: { id: number };
  repository: {
    owner: { login: string };
    name: string;
  };
  pull_request: {
    number: number;
    title: string;
    user: { login: string };
    head: { sha: string; ref: string };
    base: { sha: string; ref: string };
    draft: boolean;
    body: string | null;
  };
};

export type IssueCommentWebhookPayload = {
  action: 'created';
  installation?: { id: number };
  repository: {
    owner: { login: string };
    name: string;
  };
  issue: {
    number: number;
    pull_request?: {
      url: string;
    };
  };
  comment: {
    id: number;
    body: string;
  };
};

export type StarWebhookPayload = {
  action: 'created' | 'deleted';
  installation?: { id: number };
  repository: {
    id: number;
    full_name: string;
    language?: string | null;
    topics?: string[];
    stargazers_count?: number;
    owner: { login: string };
    name: string;
  };
};

export type WatchWebhookPayload = {
  action: 'started';
  installation?: { id: number };
  repository: {
    id: number;
    full_name: string;
    language?: string | null;
    topics?: string[];
    stargazers_count?: number;
    owner: { login: string };
    name: string;
  };
};

export type ForkWebhookPayload = {
  installation?: { id: number };
  forkee: {
    id: number;
    full_name: string;
    language?: string | null;
    topics?: string[];
    stargazers_count?: number;
    owner: { login: string };
    name: string;
  };
  repository: {
    id: number;
    full_name: string;
    owner: { login: string };
    name: string;
  };
};

export type GitHubWebhookPayload = 
  | PullRequestWebhookPayload 
  | IssueCommentWebhookPayload
  | StarWebhookPayload
  | WatchWebhookPayload
  | ForkWebhookPayload;
