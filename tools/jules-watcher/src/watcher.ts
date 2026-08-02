import { connect, MemoryStorage, MemorySessionStorage } from '@google/jules-sdk';
import type { JulesClient } from '@google/jules-sdk';
import type { WatcherConfig } from './config.js';
import { WorkerClient, type PendingTask } from './api.js';
import { diffSessions } from './diff.js';
import type { WatcherUI, WatcherState } from './ui.js';

/**
 * Holds Jules `activities.updates()` streams open for every active task the
 * worker reports, and pokes the worker (`/api/agent/jules-event`) whenever Jules
 * emits — so the worker only runs short, event-triggered steps. Also heartbeats
 * on a cadence so the worker knows the Mac is alive; the worker's cron poller is
 * the fallback for whenever this daemon is offline.
 */
export class Watcher {
  private readonly jules: JulesClient;
  private readonly worker: WorkerClient;
  private readonly watching = new Map<string, PendingTask>(); // sessionId → task
  private lastHeartbeat = '';
  private lastEvent = '';
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(private cfg: WatcherConfig, private ui: WatcherUI) {
    this.jules = connect({ apiKey: cfg.julesApiKey, storageFactory: { activity: () => new MemoryStorage(), session: () => new MemorySessionStorage() } });
    this.worker = new WorkerClient(cfg);
  }

  start() {
    void this.reconcile();
    void this.beat();
    this.timers.push(setInterval(() => void this.reconcile(), this.cfg.pollMs));
    this.timers.push(setInterval(() => void this.beat(), this.cfg.heartbeatMs));
  }

  stop() { this.timers.forEach(clearInterval); this.ui.destroy(); }

  private pushState() {
    const state: WatcherState = {
      agentId: this.cfg.agentId, workerUrl: this.cfg.workerUrl,
      watching: [...this.watching.values()].map((t) => ({ sessionId: t.sessionId, taskId: t.taskId, status: t.status })),
      lastHeartbeat: this.lastHeartbeat, lastEvent: this.lastEvent,
    };
    this.ui.setState(state);
  }

  private async beat() {
    try {
      await this.worker.heartbeat(this.watching.size);
      this.lastHeartbeat = new Date().toLocaleTimeString();
    } catch (err) {
      this.ui.log(`heartbeat failed: ${err instanceof Error ? err.message : err}`);
    }
    this.pushState();
  }

  private async reconcile() {
    let pending: PendingTask[];
    try { pending = await this.worker.getPending(); }
    catch (err) { this.ui.log(`pending failed: ${err instanceof Error ? err.message : err}`); return; }

    const { toStart, toStop } = diffSessions(this.watching.keys(), pending);
    for (const t of pending) this.watching.set(t.sessionId, t); // refresh statuses
    for (const id of toStop) this.watching.delete(id);
    for (const t of toStart) this.watchSession(t);
    this.pushState();
  }

  /** Stream future activities for one session; trigger the worker on each. */
  private watchSession(task: PendingTask) {
    const run = async () => {
      try {
        for await (const _activity of this.jules.session(task.sessionId).activities.updates()) {
          if (!this.watching.has(task.sessionId)) break; // stopped watching
          this.lastEvent = `${new Date().toLocaleTimeString()} activity on ${task.sessionId.slice(0, 8)}`;
          this.pushState();
          try { await this.worker.julesEvent(task.taskId); }
          catch (err) { this.ui.log(`trigger failed: ${err instanceof Error ? err.message : err}`); }
        }
      } catch (err) {
        this.ui.log(`stream ${task.sessionId.slice(0, 8)} ended: ${err instanceof Error ? err.message : err}`);
      }
    };
    void run();
  }
}
