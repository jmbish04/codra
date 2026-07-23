import type { JobDetail } from '@shared/schema';
import { Alert } from '@client/components/ui/alert';

/** Matches STUCK_JOB_THRESHOLD_SECONDS on the server. */
const STUCK_THRESHOLD_MS = 900_000;

/**
 * Explains why a job appears to sit in "queued"/"running" with no progress,
 * instead of leaving the user staring at a status with no context.
 */
export function JobStuckNotice({ job }: { job: JobDetail }) {
  if (job.status !== 'queued' && job.status !== 'running') return null;

  const lastProgress = new Date(job.updatedAt).getTime();
  const ageMs = Date.now() - lastProgress;
  if (Number.isNaN(ageMs) || ageMs < STUCK_THRESHOLD_MS) return null;

  const minutes = Math.round(ageMs / 60_000);
  return (
    <Alert variant="destructive">
      <span className="font-semibold">This review has been {job.status} for {minutes} min with no progress.</span>{' '}
      A worker never picked it up or was evicted mid-run. Codra re-drives stuck jobs automatically on its
      next maintenance pass; if it does not clear, use Force Restart above, or check the worker logs.
    </Alert>
  );
}
