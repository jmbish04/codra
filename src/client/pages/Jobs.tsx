import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@client/lib/api';
import { StatusBadge } from '@client/components/status-badge';
import { Skeleton } from '@client/components/skeleton';
import { EmptyState } from '@client/components/empty-state';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Select } from '@client/components/ui/select';
import { Inbox, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import type { JobSummary } from '@shared/schema';

export function JobsPage() {
  const [jobs, setJobs]   = useState<JobSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState({
    status: '', verdict: '', search: '', page: 1,
  });

  const limit = 20;

  useEffect(() => {
    let stopped = false;

    const load = async (isManual = false) => {
      if (isManual) setRefreshing(true);
      try {
        const res = await api.getJobs({
          status:  filters.status  || undefined,
          verdict: filters.verdict || undefined,
          search:  filters.search  || undefined,
          limit,
          offset:  (filters.page - 1) * limit,
        });
        if (!stopped) {
          setJobs(res.jobs);
          setTotal(res.total);
          setError(null);
          setLoading(false);
        }
      } catch (e) {
        if (!stopped) {
          setError(e instanceof Error ? e.message : 'Failed to load jobs.');
          setLoading(false);
        }
      } finally {
        if (!stopped) setRefreshing(false);
      }
    };

    load();
    const timer = window.setInterval(load, 10_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [filters]);

  const totalPages = Math.ceil(total / limit);


  const thCls = 'px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground select-none';

  return (
    <section className="page-enter flex flex-col gap-6">

      {/* Header */}
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary/70 mb-1">Overview</p>
          <h1
            className="text-2xl font-bold text-foreground"
            style={{ letterSpacing: '-0.025em' }}
          >
            Review jobs
          </h1>
          {!loading && (
            <p className="mt-1 text-sm text-muted-foreground">
              {total.toLocaleString()} {total === 1 ? 'job' : 'jobs'} found
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFilters((f) => ({ ...f }))}
          disabled={refreshing}
          className="gap-2"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </header>

      {/* Filters */}
      <div className="surface p-4 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1.5 flex-[2] min-w-[160px]">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Search
          </label>
          <Input
            type="text"
            placeholder="Title or #number…"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))}
            className="h-9 bg-background shadow-none"
          />
        </div>
        <Select
          label="Status"
          value={filters.status}
          onValueChange={(v) => setFilters((f) => ({ ...f, status: v, page: 1 }))}
          options={[
            { label: 'All statuses', value: '' },
            { label: 'Queued', value: 'queued' },
            { label: 'Running', value: 'running' },
            { label: 'Done', value: 'done' },
            { label: 'Failed', value: 'failed' },
          ]}
          className="min-w-[140px] flex-1"
        />
        <Select
          label="Verdict"
          value={filters.verdict}
          onValueChange={(v) => setFilters((f) => ({ ...f, verdict: v, page: 1 }))}
          options={[
            { label: 'All verdicts', value: '' },
            { label: 'Approved', value: 'approve' },
            { label: 'Commented', value: 'comment' },
          ]}
          className="min-w-[150px] flex-1"
        />
      </div>

      {error && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-border)', color: 'var(--danger)' }}
        >
          {error}
        </div>
      )}

      {/* Table */}
      <div className="surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className={thCls}>Repository</th>
                <th className={thCls}>Pull request</th>
                <th className={thCls}>Trigger</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>Verdict</th>
                <th className={`${thCls} text-right`}>Files</th>
                <th className={`${thCls} text-right`}>Tokens</th>
                <th className={thCls}>Created</th>
              </tr>
            </thead>
            <tbody>
              {loading && jobs.length === 0
                ? Array.from({ length: 7 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/40">
                      {[100, '75%', 55, 65, 65, 26, 54, 80].map((w, j) => (
                        <td key={j} className="px-4 py-3.5">
                          <Skeleton width={typeof w === 'number' ? w : w} />
                        </td>
                      ))}
                    </tr>
                  ))
                : jobs.map((job) => (
                    <tr
                      key={job.id}
                      className="border-b border-border/40 transition-colors hover:bg-primary/[0.03] cursor-default"
                    >
                      {/* Repo */}
                      <td className="px-4 py-3.5">
                        <Link
                          to={`/jobs/${job.id}`}
                          className="font-semibold text-primary hover:underline underline-offset-2 text-sm"
                        >
                          {job.owner}/{job.repo}
                        </Link>
                      </td>

                      {/* PR */}
                      <td className="px-4 py-3.5 max-w-[260px]">
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <span className="shrink-0 font-mono text-[11px] font-semibold text-muted-foreground">
                            #{job.prNumber}
                          </span>
                          <span className="truncate text-foreground">
                            {job.prTitle ?? 'Untitled PR'}
                          </span>
                        </div>
                      </td>

                      {/* Trigger */}
                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-secondary text-secondary-foreground">
                          {job.trigger}
                        </span>
                      </td>

                      {/* Status / Verdict */}
                      <td className="px-4 py-3.5"><StatusBadge label={job.status} job={job} /></td>
                      <td className="px-4 py-3.5">
                        {job.verdict
                          ? <StatusBadge label={job.verdict} />
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>

                      {/* Files */}
                      <td className="px-4 py-3.5 text-right font-mono text-xs text-muted-foreground tabular-nums">
                        {job.fileCount}
                      </td>

                      {/* Tokens */}
                      <td className="px-4 py-3.5 text-right font-mono text-xs text-muted-foreground tabular-nums">
                        {(job.totalInputTokens + job.totalOutputTokens).toLocaleString()}
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3.5 text-sm text-muted-foreground whitespace-nowrap">
                        {new Date(job.createdAt).toLocaleDateString(undefined, {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        {!loading && jobs.length === 0 && (
          <EmptyState
            icon={<Inbox />}
            title="No jobs found"
            description={
              filters.search || filters.status || filters.verdict
                ? 'No jobs match your filters. Try adjusting them.'
                : 'No review jobs yet. Install Codra and open a pull request to get started.'
            }
            className="rounded-none border-0"
          />
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
            <span className="text-xs text-muted-foreground">
              Page {filters.page} of {totalPages} · {total} jobs
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline" size="sm"
                disabled={filters.page === 1}
                onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
                className="h-8 gap-1 px-3"
              >
                <ChevronLeft size={13} /> Prev
              </Button>
              <Button
                variant="outline" size="sm"
                disabled={filters.page === totalPages}
                onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
                className="h-8 gap-1 px-3"
              >
                Next <ChevronRight size={13} />
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
