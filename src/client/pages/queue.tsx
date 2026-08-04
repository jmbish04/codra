import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@client/lib/api';
import { EmptyState } from '@client/components/shared/empty-state';
import { Button } from '@client/components/ui/button';
import { PageHeader } from '@client/components/layout/page-header';
import { usePolling } from '@client/hooks/use-polling';
import { useJobsFeed } from '@client/hooks/use-jobs-feed';
import { ListChecks, RefreshCw, Trash2, X, ExternalLink } from 'lucide-react';
import type { JobSummary } from '@shared/schema';

function timeAgo(value: string) {
  const diff = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const abs = Math.abs(diff);
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86_400], ['hour', 3_600], ['minute', 60],
  ];
  for (const [unit, secs] of units) {
    if (abs >= secs) return fmt.format(Math.round(diff / secs), unit);
  }
  return 'just now';
}

export function QueuePage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      // Cap high: the whole point of this page is to see everything waiting.
      const res = await api.getJobs({ status: 'queued', limit: 200, offset: 0 });
      setJobs(res.jobs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the queue.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  usePolling(load, 30_000, []);
  const live = useJobsFeed(() => load());

  const cancelOne = async (job: JobSummary) => {
    if (busyId) return;
    setBusyId(job.id);
    try {
      await api.cancelJob(job.id);
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
      toast.success('Job cancelled', { description: `${job.owner}/${job.repo} #${job.prNumber} removed from the queue.` });
    } catch (e) {
      toast.error('Could not cancel job', { description: e instanceof Error ? e.message : 'Please try again.' });
    } finally {
      setBusyId(null);
    }
  };

  const clearQueue = async () => {
    if (clearing || jobs.length === 0) return;
    if (!confirm(`Cancel all ${jobs.length} queued review(s)? This stops them before any model cost is spent. This cannot be undone.`)) return;
    setClearing(true);
    const tid = toast.loading('Clearing the queue…');
    try {
      const { cancelledCount } = await api.cancelQueuedJobs();
      setJobs([]);
      toast.success('Queue cleared', { id: tid, description: `${cancelledCount} queued review(s) cancelled.` });
    } catch (e) {
      toast.error('Could not clear the queue', { id: tid, description: e instanceof Error ? e.message : 'Please try again.' });
      await load(true);
    } finally {
      setClearing(false);
    }
  };

  return (
    <section className="page-enter flex flex-col gap-6">
      <PageHeader
        category="Queue"
        title="Pending reviews"
        description={!loading && `${jobs.length.toLocaleString()} review${jobs.length === 1 ? '' : 's'} waiting to run`}
        actions={
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider border ${live ? 'bg-success/15 text-success border-success/20' : 'bg-secondary text-muted-foreground border-border'}`}
              title={live ? 'Live updates connected' : 'Reconnecting…'}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-success animate-pulse' : 'bg-muted-foreground'}`} />
              {live ? 'Live' : 'Offline'}
            </span>
            <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing} className="gap-2">
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={clearQueue}
              disabled={clearing || jobs.length === 0}
              className="gap-2"
            >
              <Trash2 size={14} />
              Clear queue
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && jobs.length === 0 && !error ? (
        <EmptyState
          icon={<ListChecks size={28} />}
          title="Queue is empty"
          description="No reviews are waiting to run. New pull requests will appear here as they are queued."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Repository / PR</th>
                <th className="hidden px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground sm:table-cell">Author</th>
                <th className="hidden px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground md:table-cell">Queued</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Cancel</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-border/60 last:border-0 hover:bg-secondary/30">
                  <td className="px-4 py-3">
                    <Link to={`/jobs/${job.id}`} className="group inline-flex items-center gap-1.5 font-medium text-foreground hover:text-primary">
                      <span className="truncate">{job.owner}/{job.repo} <span className="text-muted-foreground">#{job.prNumber}</span></span>
                      <ExternalLink size={12} className="opacity-0 transition-opacity group-hover:opacity-60" />
                    </Link>
                    {job.prTitle && <p className="mt-0.5 max-w-[42ch] truncate text-xs text-muted-foreground">{job.prTitle}</p>}
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{job.prAuthor ?? '—'}</td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell" title={new Date(job.createdAt).toLocaleString()}>{timeAgo(job.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => cancelOne(job)}
                      disabled={busyId === job.id}
                      aria-label={`Cancel review for ${job.owner}/${job.repo} #${job.prNumber}`}
                      className="gap-1.5 text-muted-foreground hover:text-destructive"
                    >
                      <X size={14} />
                      Cancel
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
