import type { WatcherConfig } from './config.js';

export interface PendingTask { taskId: string; sessionId: string; status: string }

/** Thin authed client for the codra worker's machine-to-machine agent endpoints. */
export class WorkerClient {
  constructor(private cfg: WatcherConfig) {}

  private headers() {
    return { 'X-API-Key': this.cfg.apiKey, 'content-type': 'application/json' };
  }

  async getPending(): Promise<PendingTask[]> {
    const res = await fetch(`${this.cfg.workerUrl}/api/agent/pending`, { headers: this.headers() });
    if (!res.ok) throw new Error(`pending ${res.status}`);
    const body = await res.json() as { tasks: PendingTask[] };
    return body.tasks ?? [];
  }

  async heartbeat(activeSessions: number): Promise<void> {
    await fetch(`${this.cfg.workerUrl}/api/agent/heartbeat`, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ agentId: this.cfg.agentId, hostname: process.env.HOSTNAME ?? undefined, version: this.cfg.version, activeSessions }),
    });
  }

  async julesEvent(taskId: string): Promise<void> {
    await fetch(`${this.cfg.workerUrl}/api/agent/jules-event?taskId=${encodeURIComponent(taskId)}`, {
      method: 'POST', headers: this.headers(),
    });
  }

  // ---- fleet / merge job queue ----

  async getFleetJobs(): Promise<FleetJob[]> {
    const res = await fetch(`${this.cfg.workerUrl}/api/agent/fleet-jobs`, { headers: this.headers() });
    if (!res.ok) throw new Error(`fleet-jobs ${res.status}`);
    return ((await res.json()) as { jobs: FleetJob[] }).jobs ?? [];
  }

  async claimFleetJob(jobId: string): Promise<boolean> {
    const res = await fetch(`${this.cfg.workerUrl}/api/agent/fleet-jobs/${jobId}/claim`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ runner: this.cfg.agentId }),
    });
    return res.status === 200;
  }

  async reportFleetResult(jobId: string, body: { status: 'completed' | 'failed'; result?: unknown; error?: string }): Promise<void> {
    await fetch(`${this.cfg.workerUrl}/api/agent/fleet-jobs/${jobId}/result`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify(body),
    });
  }

  /** Ask codra to review a staged reconciliation before merging. */
  async mergeReview(body: { repositoryId: number; repository: string; reconciliationKey: string; summary: string; prNumber?: number }): Promise<{ approved: boolean; feedback: string }> {
    const res = await fetch(`${this.cfg.workerUrl}/api/agent/merge-review`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`merge-review ${res.status}`);
    return (await res.json()) as { approved: boolean; feedback: string };
  }
}

export interface FleetJob { jobId: string; kind: 'init' | 'analyze' | 'dispatch' | 'merge'; repositoryId: number; repository: string; params: any }
