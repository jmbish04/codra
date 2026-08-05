import { Link } from 'react-router-dom';
import { ArrowRight, Bot, GitPullRequest, RotateCcw } from 'lucide-react';
import { Button } from '@client/components/ui/button';
import { EmptyState } from '@client/components/shared/empty-state';
import { Skeleton } from '@client/components/shared/skeleton';
import { formatDateTime } from '@client/lib/format';
import type { JulesMonitorTask } from './client';
import { JulesStatusBadge } from './status';

/**
 * JulesSessionList
 */
export function JulesSessionList({
  tasks,
  loading,
  onRetry,
}: {
  tasks: JulesMonitorTask[];
  loading: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="overflow-hidden rounded-lg border border-border" aria-busy="true" aria-label="Loading Jules sessions">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="grid gap-3 border-b border-border/60 px-4 py-4 last:border-b-0 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
            <div className="space-y-2"><Skeleton width="55%" /><Skeleton width="35%" height="0.75rem" /></div>
            <Skeleton width="45%" />
            <Skeleton width="5rem" />
          </div>
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={<Bot />}
        title="No matching sessions"
        description="Change the filters or refresh after Codra starts a Jules planning session."
        action={{ label: 'Refresh sessions', onClick: onRetry }}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="hidden grid-cols-[minmax(0,1.45fr)_minmax(9rem,.8fr)_minmax(9rem,.75fr)_auto] gap-4 border-b border-border bg-secondary/35 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
        <span>Package</span><span>Status</span><span>Updated</span><span className="sr-only">Open</span>
      </div>
      <ul role="list" className="divide-y divide-border/70">
        {tasks.map((task) => (
          <li key={task.taskId}>
            <Link
              to={`/jules/monitor/${encodeURIComponent(task.taskId)}`}
              className="group grid gap-3 px-4 py-4 outline-none transition-colors hover:bg-secondary/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid-cols-[minmax(0,1.45fr)_minmax(9rem,.8fr)_minmax(9rem,.75fr)_auto] md:items-center md:gap-4"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">{task.packageTitle}</div>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="truncate font-mono">{task.repository}</span>
                  <span aria-hidden="true">·</span>
                  <span>Iteration {task.iterations}</span>
                </div>
              </div>
              <div className="flex items-center gap-2"><JulesStatusBadge status={task.status} /></div>
              <div className="text-xs text-muted-foreground">{formatDateTime(task.updatedAt)}</div>
              <div className="flex items-center justify-between gap-3 md:justify-end">
                {task.lastPrUrl ? (
                  <span className="inline-flex items-center gap-1 text-xs text-primary"><GitPullRequest className="h-3.5 w-3.5" /> PR ready</span>
                ) : task.error ? (
                  <span className="inline-flex items-center gap-1 text-xs text-danger"><RotateCcw className="h-3.5 w-3.5" /> Review</span>
                ) : null}
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
/**
 * SessionsLoadError
 */
export function SessionsLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start justify-between gap-3 rounded-lg border border-danger-border bg-danger-bg p-4 sm:flex-row sm:items-center">
      <div><p className="text-sm font-semibold text-danger">Sessions could not be loaded</p><p className="mt-1 text-sm text-muted-foreground">{message}</p></div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}><RotateCcw /> Retry</Button>
    </div>
  );
}
