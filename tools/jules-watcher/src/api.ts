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
}
