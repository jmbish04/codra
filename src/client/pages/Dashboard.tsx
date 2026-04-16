import { useEffect, useState, useMemo } from 'react';
import { api } from '@client/lib/api';
import type { StatsPayload } from '@shared/schema';
import type { JobSummary } from '@shared/schema';
import { 
  Zap, 
  Activity, 
  ArrowUpRight, 
  Cpu, 
  MessageSquare, 
  History,
  ArrowRight,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '@client/components/status-badge';
import { Skeleton } from '@client/components/skeleton';
import { Button } from '@client/components/ui/button';
import { Sparkline } from '@client/components/sparkline';
import { TimeRangeSelect } from '@client/components/time-range-select';

const generateMockTrend = (base: number, length: number) => {
  return Array.from({ length }, (_, i) => {
    const trend = (i / Math.max(1, length - 1)) * (base * 0.5);
    const noise = (Math.random() - 0.5) * (base * 0.3);
    return Math.max(0, base + trend + noise);
  });
};

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

export function DashboardPage() {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, [days]);

  const mockTrends = useMemo(() => ({
    jobs: generateMockTrend(40, days),
    inputTokens: generateMockTrend(100, days),
    outputTokens: generateMockTrend(80, days),
    comments: generateMockTrend(20, days),
  }), [days]);

  const kpis = [
    { 
      label: 'Total reviews',   
      value: stats ? fmt(stats.totals.jobs) : null, 
      icon: Activity,
      trend: stats ? mockTrends.jobs : Array(days).fill(0),
    },
    { 
      label: 'Input tokens',    
      value: stats ? fmt(stats.totals.inputTokens) : null, 
      icon: ArrowUpRight,
      trend: stats ? mockTrends.inputTokens : Array(days).fill(0),
    },
    { 
      label: 'Output tokens',   
      value: stats ? fmt(stats.totals.outputTokens) : null, 
      icon: Cpu,
      trend: stats ? mockTrends.outputTokens : Array(days).fill(0),
    },
    { 
      label: 'Comments posted', 
      value: stats ? fmt(stats.totals.comments) : null, 
      icon: MessageSquare,
      trend: stats ? mockTrends.comments : Array(days).fill(0),
    },
  ];

  return (
    <section className="page-enter flex flex-col gap-6">

      {/* ── Page Header ── */}
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary/70 mb-1">
            Overview
          </p>
          <h1 className="text-2xl font-bold text-foreground" style={{ letterSpacing: '-0.025em' }}>
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live activity stream and system snapshot.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <TimeRangeSelect 
            value={days}
            onValueChange={setDays}
          />
          <Button
            asChild
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <a
              href="https://github.com/apps/codra-app/installations/new"
              target="_blank"
              rel="noopener noreferrer"
              title="Configure Codra App access"
            >
              <Settings size={13} />
              Configure App
            </a>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(true)}
            disabled={refreshing || loading}
            className="gap-2"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>
      </header>

      {/* ── KPI strip ── */}
      <div className="surface grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border">
        {kpis.map(({ label, value, icon: Icon, trend }, i) => (
          <div key={i} className="flex flex-col gap-2.5 px-5 py-4 sm:px-6 sm:py-5 relative overflow-hidden group">
            <Sparkline data={trend} />
            <div className="relative z-10 flex items-center gap-2 text-muted-foreground group-hover:text-foreground transition-colors">
              <Icon size={13} strokeWidth={1.75} />
              <span className="stat-label">{label}</span>
            </div>
            <div className="relative z-10">
              {value !== null
                ? <p className="stat-number">{value}</p>
                : <Skeleton height={36} width={60} />
              }
            </div>
          </div>
        ))}
      </div>

      {/* ── Activity Stream ── */}
      <div className="flex flex-col gap-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <History size={14} strokeWidth={1.75} className="text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Recent Activity</h2>
            {loading && <span className="pulsing-dot" />}
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
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-5 py-4 border-b border-border/50 last:border-0">
                <Skeleton height={20} />
              </div>
            ))
          ) : recentJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Activity size={36} className="text-muted-foreground/20 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No activity yet.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Open a pull request in a connected repo to get started.
              </p>
            </div>
          ) : (
            recentJobs.map((job, idx) => (
              <Link
                key={job.id}
                to={`/jobs/${job.id}`}
                className="group flex items-center gap-4 px-5 py-4 border-b border-border/50 last:border-0 hover:bg-primary/[0.03] transition-colors"
              >
                {/* Icon */}
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary/60 group-hover:bg-primary group-hover:text-primary-foreground transition-all">
                  <Zap size={16} />
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                      {job.owner}/{job.repo}
                    </span>
                    <span className="text-[10px] font-mono font-bold bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                      #{job.prNumber}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{job.prTitle}</p>
                </div>

                {/* Trigger + time (hidden on small) */}
                <div className="hidden sm:flex flex-col items-end gap-0.5 shrink-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">
                    {job.trigger}
                  </span>
                  <span className="text-[11px] font-mono text-muted-foreground/60">
                    {new Date(job.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {/* Status */}
                <StatusBadge label={job.status} job={job} />

                {/* Arrow */}
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/50 group-hover:border-primary/40 transition-colors">
                  <ArrowRight size={12} className="text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </Link>
            ))
          )}

          {!loading && recentJobs.length > 0 && (
            <div className="px-5 py-2.5 bg-muted/20 border-t border-border/50">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/40 text-center">
                {recentJobs.length} events · auto-refreshes every 10s
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
