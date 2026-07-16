import { BATCH_STEP_NAME, type JobSummary } from '@shared/schema';

export interface WaitInfo {
  /** Short banner label. */
  label: string;
  /** One-sentence explanation of why the job is waiting. */
  detail: string;
  tone: 'neutral' | 'warning';
}

const MINUTE = 60_000;
const STALE_QUEUE_MS = 10 * MINUTE;

function humanizeDuration(ms: number): string {
  const mins = Math.round(ms / MINUTE);
  if (mins < 1) return 'less than a minute';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${hours}h ${rem}m`;
}

function humanizeUntil(ms: number): string {
  const mins = Math.max(1, Math.round(ms / MINUTE));
  return mins < 60 ? `~${mins} min` : `~${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * Explains why an active (queued/running) job is waiting, derived entirely from
 * fields already on the job summary. Returns null when the job is progressing
 * normally (so callers fall back to their default "reviewing" UI).
 *
 * The dominant "stuck for hours" cause is `nextRetryAt`: the job paused between
 * chunks and is backing off after a model-provider slowdown.
 */
export function describeWait(job: JobSummary, now = Date.now()): WaitInfo | null {
  if (job.status !== 'queued' && job.status !== 'running') return null;

  const retryAt = job.nextRetryAt ? new Date(job.nextRetryAt).getTime() : null;
  const waitingOnRetry = retryAt !== null && Number.isFinite(retryAt) && retryAt > now;

  // A queued Workers AI batch also sets nextRetryAt (it polls on a delay), so
  // check the step first — otherwise a healthy batch reads as a provider
  // outage. Batches normally land within ~5 minutes.
  if (job.steps?.some((step) => step.name === BATCH_STEP_NAME && step.status === 'running')) {
    return {
      label: 'Queued on the Workers AI batch API',
      detail: waitingOnRetry
        ? `All files were submitted as one batch; Codra is polling for results and will check again in ${humanizeUntil(retryAt - now)}. Batches typically complete within ~5 minutes.`
        : 'All files were submitted as one batch. Codra is waiting for the results.',
      tone: 'neutral',
    };
  }

  // Paused between chunks, waiting on a scheduled retry (model provider outage
  // backoff, up to ~15 min per attempt). Most common reason for long waits.
  if (waitingOnRetry) {
    const reason = job.errorMessage?.trim();
    return {
      label: 'Paused — will retry automatically',
      detail: reason
        ? `Next attempt in ${humanizeUntil(retryAt! - now)}. Last issue: ${reason}`
        : `Next attempt in ${humanizeUntil(retryAt! - now)} after a model provider slowdown.`,
      tone: 'warning',
    };
  }

  const waitedMs = now - new Date(job.createdAt).getTime();

  // Never picked up by a worker yet.
  if (job.status === 'queued' && !job.startedAt) {
    const stale = waitedMs > STALE_QUEUE_MS;
    return {
      label: stale ? 'Still queued — longer than usual' : 'Waiting for a worker',
      detail: stale
        ? `Queued ${humanizeDuration(waitedMs)} ago. The review queue is backed up or a worker is scaling up — it will start automatically. Use Force Restart to requeue.`
        : `Queued ${humanizeDuration(waitedMs)} ago, waiting for an available review worker.`,
      tone: stale ? 'warning' : 'neutral',
    };
  }

  // Running but carrying an error message (degraded, still finishing).
  if (job.status === 'running' && job.errorMessage) {
    return { label: 'Running with issues', detail: job.errorMessage, tone: 'warning' };
  }

  return null;
}
