import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WatcherConfig } from './config.js';
import { WorkerClient, type FleetJob } from './api.js';
import type { WatcherUI } from './ui.js';

const exec = promisify(execFile);

/**
 * Runs jules-fleet / jules-merge CLIs on this host (the Worker can't — both
 * packages import node:child_process + fs). Claims queued jobs from codra,
 * executes the real CLI, and reports the result back.
 *
 * Merge jobs go through codra's review gate: scan → ask the worker to approve →
 * merge only if approved. codra's circuit breaker bounds attempts server-side.
 */

/** Pure job → argv mapping (init/analyze/dispatch). Merge is handled separately. */
export function jobToArgv(job: FleetJob): { cmd: string; args: string[] } | null {
  const base = ['-y', '@google/jules-fleet', job.kind, '--repo', job.repository, '--non-interactive'];
  switch (job.kind) {
    case 'init': return { cmd: 'npx', args: base };
    case 'analyze': return { cmd: 'npx', args: job.params?.milestone ? [...base, '--milestone', String(job.params.milestone)] : base };
    case 'dispatch': return { cmd: 'npx', args: job.params?.milestone ? [...base, '--milestone', String(job.params.milestone)] : base };
    default: return null; // merge handled in runMerge
  }
}

export class FleetRunner {
  private readonly worker: WorkerClient;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private cfg: WatcherConfig, private ui: WatcherUI) {
    this.worker = new WorkerClient(cfg);
  }

  start(intervalMs = 30_000) {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }
  stop() { if (this.timer) clearInterval(this.timer); }

  private async tick() {
    let jobs: FleetJob[];
    try { jobs = await this.worker.getFleetJobs(); }
    catch (err) { this.ui.log(`fleet-jobs poll failed: ${err instanceof Error ? err.message : err}`); return; }
    for (const job of jobs) {
      if (!(await this.worker.claimFleetJob(job.jobId))) continue; // someone else took it
      this.ui.log(`running fleet ${job.kind} for ${job.repository}`);
      try {
        const result = job.kind === 'merge' ? await this.runMerge(job) : await this.runCli(job);
        await this.worker.reportFleetResult(job.jobId, { status: 'completed', result });
      } catch (err) {
        await this.worker.reportFleetResult(job.jobId, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
        this.ui.log(`fleet ${job.kind} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async runCli(job: FleetJob) {
    const mapped = jobToArgv(job);
    if (!mapped) throw new Error(`no command for kind ${job.kind}`);
    const { stdout } = await exec(mapped.cmd, mapped.args, { env: process.env, maxBuffer: 10 * 1024 * 1024 });
    return { stdout: stdout.slice(0, 20_000) };
  }

  /** Merge with codra's review gate. */
  private async runMerge(job: FleetJob) {
    const prs: number[] = Array.isArray(job.params?.prs) ? job.params.prs : [];
    if (prs.length === 0) throw new Error('merge job requires params.prs');
    const repositoryId = job.repositoryId;

    // 1. Scan for overlaps → a summary codra can review.
    const scan = await exec('npx', ['-y', '@google/jules-merge', 'scan', '--json', JSON.stringify({ prs, repo: job.repository })],
      { env: process.env, maxBuffer: 10 * 1024 * 1024 });
    const summary = scan.stdout.slice(0, 12_000);

    // 2. codra reviews + approves (circuit-broken server-side).
    const key = `reconcile/${job.repository}/${prs.join('-')}`;
    const verdict = await this.worker.mergeReview({ repositoryId, repository: job.repository, reconciliationKey: key, summary });
    if (!verdict.approved) return { merged: false, reason: verdict.feedback || 'not approved by codra' };

    // 3. Merge only on approval.
    // ponytail: this merges what jules-merge staged; conflict reconciliation
    // (get-contents/stage-resolution authoring) is the next iteration — for a
    // clean/no-conflict batch this is sufficient.
    const merge = await exec('npx', ['-y', '@google/jules-merge', 'merge', '--json', JSON.stringify({ prs, repo: job.repository })],
      { env: process.env, maxBuffer: 10 * 1024 * 1024 });
    return { merged: true, output: merge.stdout.slice(0, 20_000) };
  }
}

/** Runnable check for the pure argv mapping. */
export function fleetSelfCheck(): void {
  const a = jobToArgv({ jobId: 'j', kind: 'dispatch', repository: 'o/r', params: { milestone: '2' } });
  if (!a || a.cmd !== 'npx' || !a.args.includes('dispatch') || !a.args.includes('--milestone') || !a.args.includes('2')) {
    throw new Error('fleetSelfCheck: dispatch argv wrong');
  }
  if (jobToArgv({ jobId: 'j', kind: 'merge', repository: 'o/r', params: {} }) !== null) throw new Error('fleetSelfCheck: merge should be null');
  console.log('fleetSelfCheck OK');
}
