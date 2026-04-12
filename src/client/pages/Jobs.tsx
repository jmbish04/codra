import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@client/lib/api';
import { StatusBadge } from '@client/components/StatusBadge';
import { Skeleton } from '@client/components/Skeleton';
import { EmptyState } from '@client/components/EmptyState';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Card, CardContent } from '@client/components/ui/card';
import { Inbox, ChevronLeft, ChevronRight } from 'lucide-react';
import type { JobSummary } from '@shared/schema';

export function JobsPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    status: '',
    verdict: '',
    search: '',
    page: 1,
  });

  const limit = 20;

  useEffect(() => {
    let stopped = false;

    const load = async () => {
      try {
        const response = await api.getJobs({
          status: filters.status || undefined,
          verdict: filters.verdict || undefined,
          search: filters.search || undefined,
          limit,
          offset: (filters.page - 1) * limit,
        });
        if (!stopped) {
          setJobs(response.jobs);
          setTotal(response.total);
          setError(null);
          setLoading(false);
        }
      } catch (loadError) {
        if (!stopped) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load jobs.');
          setLoading(false);
        }
      }
    };

    load();
    const timer = window.setInterval(load, 10_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [filters]);

  const totalPages = Math.ceil(total / limit);

  const selectClass =
    'h-9 rounded-xl border border-input bg-card/60 px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

  return (
    <section className="flex flex-col gap-6">
      {/* Header */}
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">Overview</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Recent review jobs</h1>
        </div>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1 flex-[2] min-w-[160px]">
          <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Search PRs</label>
          <Input
            type="text"
            placeholder="Title or #number…"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))}
          />
        </div>
        <div className="flex flex-col gap-1 min-w-[140px]">
          <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Status</label>
          <select
            className={selectClass}
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value, page: 1 }))}
          >
            <option value="">All Statuses</option>
            <option value="queued">Queued</option>
            <option value="running">Running</option>
            <option value="done">Done</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div className="flex flex-col gap-1 min-w-[160px]">
          <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Verdict</label>
          <select
            className={selectClass}
            value={filters.verdict}
            onChange={(e) => setFilters((f) => ({ ...f, verdict: e.target.value, page: 1 }))}
          >
            <option value="">All Verdicts</option>
            <option value="approve">Approved</option>
            <option value="comment">Commented</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Repo</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">PR</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Trigger</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Verdict</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Files</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tokens</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Created</th>
                </tr>
              </thead>
              <tbody>
                {loading && jobs.length === 0
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/40">
                        <td className="px-4 py-3"><Skeleton width={100} /></td>
                        <td className="px-4 py-3"><Skeleton width="80%" /></td>
                        <td className="px-4 py-3"><Skeleton width={60} /></td>
                        <td className="px-4 py-3"><Skeleton width={70} /></td>
                        <td className="px-4 py-3"><Skeleton width={70} /></td>
                        <td className="px-4 py-3"><Skeleton width={30} /></td>
                        <td className="px-4 py-3"><Skeleton width={60} /></td>
                        <td className="px-4 py-3"><Skeleton width={90} /></td>
                      </tr>
                    ))
                  : jobs.map((job) => (
                      <tr
                        key={job.id}
                        className="border-b border-border/40 transition-colors hover:bg-muted/20"
                      >
                        <td className="px-4 py-3 font-medium">
                          <Link
                            to={`/jobs/${job.id}`}
                            className="text-accent hover:underline underline-offset-2"
                          >
                            {job.owner}/{job.repo}
                          </Link>
                        </td>
                        <td className="px-4 py-3 max-w-[260px]">
                          <span className="font-semibold text-foreground">#{job.prNumber}</span>{' '}
                          <span className="text-muted-foreground truncate">{job.prTitle ?? 'Untitled PR'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground capitalize">
                            {job.trigger}
                          </span>
                        </td>
                        <td className="px-4 py-3"><StatusBadge label={job.status} /></td>
                        <td className="px-4 py-3">
                          {job.verdict ? <StatusBadge label={job.verdict} /> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 tabular-nums">{job.fileCount}</td>
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">
                          {(job.totalInputTokens + job.totalOutputTokens).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {new Date(job.createdAt).toLocaleDateString()}
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
                  ? "We couldn't find any jobs matching your current filters. Try adjusting them."
                  : 'There are no review jobs yet. Link a repository or open a PR to get started.'
              }
              className="rounded-none border-0"
            />
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 border-t border-border/40 px-4 py-3">
              <Button
                variant="outline"
                size="sm"
                disabled={filters.page === 1}
                onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
              >
                <ChevronLeft size={14} /> Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {filters.page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={filters.page === totalPages}
                onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
              >
                Next <ChevronRight size={14} />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
