import { useState, useMemo } from 'react';
import { api } from '@client/lib/api';
import type { StatsPayload } from '@shared/schema';
import type { JobSummary } from '@shared/schema';
import { Activity, History, RefreshCw, Settings, ArrowRight } from 'lucide-react';
import { JobsTable } from '@client/components/shared/jobs-table';
import { Link } from 'react-router-dom';

import { Button } from '@client/components/ui/button';
import { TimeRangeSelect } from '@client/components/features/stats/time-range-select';
import { PageHeader } from '@client/components/layout/page-header';
import { OverviewStats } from '@client/components/features/stats/overview-stats';
import { usePolling } from '@client/hooks/use-polling';
import { fmtNumber } from '@client/lib/utils';
import { Alert } from '@client/components/ui/alert';

export function DashboardPage() {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [days, setDays] = useState(30);

  const load = async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const [statsRes, jobsRes] = await Promise.all([
        api.getStats(days),
        api.getJobs({ limit: 10 }),
      ]);
      setStats(statsRes.stats);
      setRecentJobs(jobsRes.jobs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh dashboard.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  usePolling(load, 15_000, [days]);


  return (
    <section className="page-enter flex flex-col gap-6">

      <PageHeader
        category="Home"
        title="Dashboard"
        description="Totals and recent review jobs for the selected time range."
        actions={
          <>
            <TimeRangeSelect 
              value={days}
              onValueChange={setDays}
            />

            <Button
              variant="outline"
              size="sm"
              onClick={() => load(true)}
              disabled={refreshing}
              className="gap-2"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </Button>
          </>
        }
      />

      {error && <Alert variant="destructive">{error}</Alert>}

      <OverviewStats stats={stats} days={days} />

      {/* ── Activity Stream ── */}
      <div className="flex flex-col gap-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <History size={14} strokeWidth={1.75} className="text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Recent reviews</h2>
          </div>
          <Link to="/jobs">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              View all <ArrowRight size={13} />
            </Button>
          </Link>
        </div>

        <div className="surface overflow-hidden">
          <JobsTable
            jobs={recentJobs}
            loading={loading}
            columns={['repo', 'pr', 'trigger', 'status', 'verdict', 'created']}
          />

          {!loading && recentJobs.length > 0 && (
            <div className="px-5 py-2.5 bg-muted/20 border-t border-border/50">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/40 text-center">
                {recentJobs.length} review jobs · refreshes every 15s
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
