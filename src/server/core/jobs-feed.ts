/**
 * Notify the jobs dashboard that a job was created or changed status, so
 * connected WebSocket clients refresh in real time. Fire-and-forget: never
 * throws, never blocks the caller.
 */
export function notifyJobsChanged(
  env: Env,
  event?: { jobId?: string; status?: string; prNumber?: number; owner?: string; repo?: string },
): Promise<unknown> {
  try {
    const stub = env.JobsFeed.get(env.JobsFeed.idFromName('global'));
    return stub.fetch('http://jobs-feed/broadcast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'jobs-changed', at: Date.now(), ...event }),
    }).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}
