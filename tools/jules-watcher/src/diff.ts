import type { PendingTask } from './api.js';

/** Reconcile currently-watched sessions against the desired set from the worker. */
export function diffSessions(
  watching: Iterable<string>, desired: PendingTask[],
): { toStart: PendingTask[]; toStop: string[] } {
  const watchingSet = new Set(watching);
  const desiredIds = new Set(desired.map((d) => d.sessionId));
  return {
    toStart: desired.filter((d) => !watchingSet.has(d.sessionId)),
    toStop: [...watchingSet].filter((id) => !desiredIds.has(id)),
  };
}

/** Runnable check (bun run src/index.ts --selfcheck). */
export function selfCheck(): void {
  const desired: PendingTask[] = [
    { taskId: 't1', sessionId: 's1', status: 'planning' },
    { taskId: 't2', sessionId: 's2', status: 'plan_review' },
  ];
  const d = diffSessions(['s2', 's3'], desired);
  if (d.toStart.length !== 1 || d.toStart[0].sessionId !== 's1') throw new Error('selfcheck: toStart wrong');
  if (d.toStop.length !== 1 || d.toStop[0] !== 's3') throw new Error('selfcheck: toStop wrong');
  console.log('selfcheck OK');
}
