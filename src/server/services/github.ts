import { GitHubClient, type GitHubReviewComment } from '../core/github';

export class GitHubService {
  private client: GitHubClient;

  constructor(env: Env, installationId: string, tracker?: { incrementSubrequests(count?: number): void }) {
    this.client = new GitHubClient(env, installationId, tracker);
  }

  async getPullRequest(owner: string, repo: string, prNumber: number) {
    return this.client.getPullRequest(owner, repo, prNumber);
  }

  async getPullRequestDiff(owner: string, repo: string, prNumber: number) {
    return this.client.getPullRequestDiff(owner, repo, prNumber);
  }

  async createCheckRun(owner: string, repo: string, params: { headSha: string; title: string; summary: string }) {
    return this.client.createCheckRun(owner, repo, params);
  }

  async updateCheckRun(owner: string, repo: string, checkRunId: number, params: { title: string; summary: string; status?: 'in_progress' | 'completed'; conclusion?: 'success' | 'neutral' | 'failure' }) {
    return this.client.updateCheckRun(owner, repo, checkRunId, params);
  }

  async createReview(owner: string, repo: string, prNumber: number, params: { commitSha: string; event: 'APPROVE' | 'COMMENT'; body: string; comments: GitHubReviewComment[] }) {
    return this.client.createReview(owner, repo, prNumber, params);
  }

  async ensureLabel(owner: string, repo: string, name: string, color: string) {
    return this.client.ensureLabel(owner, repo, name, color);
  }

  async addIssueLabels(owner: string, repo: string, prNumber: number, labels: string[]) {
    return this.client.addIssueLabels(owner, repo, prNumber, labels);
  }

  async removeIssueLabelsIfPresent(owner: string, repo: string, prNumber: number, labels: string[]) {
    return this.client.removeIssueLabelsIfPresent(owner, repo, prNumber, labels);
  }

  async removeIssueLabel(owner: string, repo: string, prNumber: number, label: string) {
    return this.client.removeIssueLabel(owner, repo, prNumber, label);
  }

  async getRepoFileWithRefOrNull(owner: string, repo: string, path: string, ref?: string) {
    return this.client.getRepoFileWithRefOrNull(owner, repo, path, ref);
  }

  async createOrUpdateFileContents(
    owner: string,
    repo: string,
    path: string,
    input: { message: string; content: string; sha?: string; branch?: string }
  ) {
    return this.client.createOrUpdateFileContents(owner, repo, path, input);
  }

  async getRepoTree(owner: string, repo: string, sha: string) {
    return this.client.getRepoTree(owner, repo, sha);
  }

  async createIssueComment(owner: string, repo: string, issueNumber: number, body: string) {
    return this.client.createIssueComment(owner, repo, issueNumber, body);
  }

  async updateIssueComment(owner: string, repo: string, commentId: number, body: string) {
    return this.client.updateIssueComment(owner, repo, commentId, body);
  }

  async getRepo(owner: string, repo: string) {
    return this.client.getRepo(owner, repo);
  }

  async getRef(owner: string, repo: string, ref: string) {
    return this.client.getRef(owner, repo, ref);
  }

  async createBranch(owner: string, repo: string, branchName: string, fromSha: string) {
    return this.client.createBranch(owner, repo, branchName, fromSha);
  }

  async createPullRequest(
    owner: string,
    repo: string,
    params: { title: string; body: string; head: string; base: string },
  ) {
    return this.client.createPullRequest(owner, repo, params);
  }

  async listPullRequests(
    owner: string,
    repo: string,
    params: { state?: 'open' | 'closed' | 'all'; head?: string; base?: string; per_page?: number },
  ) {
    return this.client.listPullRequests(owner, repo, params);
  }
}
