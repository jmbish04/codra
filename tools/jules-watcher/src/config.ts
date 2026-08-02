export interface WatcherConfig {
  workerUrl: string;      // e.g. https://codra.hacolby.workers.dev
  apiKey: string;         // WORKER_API_KEY
  julesApiKey: string;    // JULES_API_KEY
  agentId: string;        // stable id for this machine
  pollMs: number;         // how often to reconcile watched sessions
  heartbeatMs: number;    // how often to prove liveness to the worker
  version: string;
}

import { getSecret, getWorkerApiKey } from './secrets.js';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export function loadConfig(): WatcherConfig {
  // Secrets come from the local `tokens` CLI (secret store), not env/disk.
  // WORKER_URL / AGENT_ID / intervals are plain config from env.
  return {
    workerUrl: req('WORKER_URL').replace(/\/+$/, ''),
    apiKey: getWorkerApiKey(),
    julesApiKey: getSecret('JULES_API_KEY'),
    agentId: process.env.AGENT_ID || `mac-${process.env.USER ?? 'watcher'}`,
    pollMs: Number(process.env.POLL_MS) || 15_000,
    heartbeatMs: Number(process.env.HEARTBEAT_MS) || 30_000,
    version: '0.1.0',
  };
}
