import { useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  BarChart3,
  Bot,
  Gauge,
  GitBranch,
  RefreshCw,
  Server,
  TrendingUp,
} from 'lucide-react';

import { TimeRangeSelect } from '@client/components/features/stats/time-range-select';
import { PageHeader } from '@client/components/layout/page-header';
import { Skeleton } from '@client/components/shared/skeleton';
import { Alert } from '@client/components/ui/alert';
import { Button } from '@client/components/ui/button';
import { useIsDarkMode } from '@client/hooks/use-is-dark-mode';
import { usePolling } from '@client/hooks/use-polling';
import { api } from '@client/lib/api';
import { fmtNumber } from '@client/lib/utils';
import type { StatsPayload } from '@shared/schema';

const CHART = {
  primary: '#84cc16',
  primaryDark: '#e0fe56',
  comments: '#0ea5e9',
  warning: '#f59e0b',
  danger: '#ef4444',
  quiet: '#64748b',
  violet: '#8b5cf6',
};

const axisProps = {
  fontSize: 11,
  tickLine: false,
  tickMargin: 10,
  axisLine: false,
  tick: { fontFamily: 'var(--font-sans)', fill: 'var(--muted-foreground)' } as const,
};

function formatDay(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatCompact(value: number) {
  return value >= 1000 ? fmtNumber(value) : value.toLocaleString();
}

function ratio(numerator: number, denominator: number, decimals = 1) {
  if (!denominator) return '0';
  return (numerator / denominator).toFixed(decimals);
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function modelName(model: string) {
  return model.split('/').pop()?.replace(/-/g, ' ') ?? model;
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5 text-xs shadow-lg">
      {label && (
        <p className="mb-2 font-semibold text-foreground">
          {typeof label === 'string' && label.includes('-') ? formatDay(label) : label}
        </p>
      )}
      <div className="space-y-1.5">
        {payload.map((item: any) => (
          <div key={item.dataKey ?? item.name} className="flex min-w-32 items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="flex-1 capitalize text-muted-foreground">{item.name}</span>
            <span className="font-semibold tabular-nums text-foreground">
              {typeof item.value === 'number' ? formatCompact(item.value) : item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GraphSectionTitle() {
  return <div className="pt-2" aria-hidden="true" />;
}

function GraphShell({
  title,
  eyebrow,
  icon: Icon,
  children,
  className = '',
}: {
  title: string;
  eyebrow: string;
  icon: typeof Activity;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={`overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-md)] ${className}`}>
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{eyebrow}</p>
          <h3 className="mt-1 text-sm font-bold text-foreground">{title}</h3>
        </div>
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/15">
          <Icon size={15} strokeWidth={2.2} />
        </span>
      </div>
      {children}
    </article>
  );
}

function GraphCardGallery({ stats, days, isDark }: { stats: StatsPayload; days: number; isDark: boolean }) {
  const color = isDark ? CHART.primaryDark : CHART.primary;
  const tokenTrend = stats.trend.map((day) => ({
    ...day,
    tokens: day.inputTokens + day.outputTokens,
    tokenDensity: Math.round((day.inputTokens + day.outputTokens) / Math.max(day.jobs, 1)),
    commentRate: Number(ratio(day.comments, Math.max(day.jobs, 1), 1)),
  }));
  const cumulativeTrend = stats.trend.reduce<{ day: string; reviews: number; comments: number }[]>((acc, day) => {
    const prev = acc[acc.length - 1];
    acc.push({
      day: day.day,
      reviews: (prev?.reviews ?? 0) + day.jobs,
      comments: (prev?.comments ?? 0) + day.comments,
    });
    return acc;
  }, []);
  const repoMax = Math.max(...stats.topRepos.map((repo) => repo.jobs), 1);
  const modelMax = Math.max(...stats.models.map((model) => model.calls), 1);

  return (
    <div className="flex flex-col gap-5">
      <GraphSectionTitle />

      <div className="grid gap-5 lg:grid-cols-12">
        <GraphShell title="Cumulative reviews" eyebrow="Line" icon={TrendingUp} className="lg:col-span-7">
          <div className="h-64 px-2 pb-4 pt-4">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <LineChart data={cumulativeTrend} margin={{ left: -18, right: 18, top: 10, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" {...axisProps} tickFormatter={formatDay} interval={Math.max(Math.floor(days / 8), 0)} />
                <YAxis {...axisProps} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="reviews" name="reviews" stroke={color} strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="comments" name="comments" stroke={CHART.comments} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </GraphShell>

        <GraphShell title="Token load" eyebrow="Area" icon={Server} className="lg:col-span-5">
          <div className="h-64 px-2 pb-4 pt-4">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <AreaChart data={tokenTrend} margin={{ left: -18, right: 18, top: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="tokenLoadFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.violet} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={CHART.violet} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" {...axisProps} tickFormatter={formatDay} interval={Math.max(Math.floor(days / 5), 0)} />
                <YAxis {...axisProps} tickFormatter={formatCompact} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="tokens" name="tokens" stroke={CHART.violet} strokeWidth={2.25} fill="url(#tokenLoadFill)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </GraphShell>
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        <GraphShell title="Reviews vs comments" eyebrow="Dual bars" icon={BarChart3} className="lg:col-span-6">
          <div className="h-64 px-2 pb-4 pt-4">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={stats.trend} margin={{ left: -18, right: 18, top: 10, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" {...axisProps} tickFormatter={formatDay} interval={Math.max(Math.floor(days / 6), 0)} />
                <YAxis {...axisProps} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="jobs" name="reviews" fill={color} radius={[4, 4, 0, 0]} />
                <Bar dataKey="comments" name="comments" fill={CHART.comments} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GraphShell>

        <GraphShell title="Token density" eyebrow="Line" icon={Gauge} className="lg:col-span-6">
          <div className="h-64 px-2 pb-4 pt-4">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <LineChart data={tokenTrend} margin={{ left: -18, right: 18, top: 10, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" {...axisProps} tickFormatter={formatDay} interval={Math.max(Math.floor(days / 6), 0)} />
                <YAxis {...axisProps} tickFormatter={formatCompact} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="tokenDensity" name="tokens/review" stroke={CHART.warning} strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </GraphShell>
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        <GraphShell title="Repository bars" eyebrow="Horizontal" icon={GitBranch} className="lg:col-span-6">
          <div className="space-y-3 px-5 pb-5 pt-5">
            {stats.topRepos.slice(0, 7).map((repo) => (
              <div key={`${repo.owner}/${repo.repo}`} className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-3">
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate font-semibold text-foreground">{repo.owner}/{repo.repo}</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${percent(repo.jobs, repoMax)}%` }} />
                  </div>
                </div>
                <span className="text-right text-xs font-bold tabular-nums text-foreground">{repo.jobs}</span>
              </div>
            ))}
          </div>
        </GraphShell>

        <GraphShell title="Model calls" eyebrow="Horizontal" icon={Bot} className="lg:col-span-6">
          <div className="space-y-3 px-5 pb-5 pt-5">
            {stats.models.slice(0, 7).map((model) => (
              <div key={model.modelUsed} className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-3">
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate font-semibold text-foreground">{modelName(model.modelUsed)}</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-[oklch(54%_0.17_295)]" style={{ width: `${percent(model.calls, modelMax)}%` }} />
                  </div>
                </div>
                <span className="text-right text-xs font-bold tabular-nums text-foreground">{model.calls}</span>
              </div>
            ))}
          </div>
        </GraphShell>
      </div>

    </div>
  );
}

function PanelHeader({
  label,
  value,
  detail,
}: {
  label: string;
  value?: string;
  detail?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/15">
          <TrendingUp size={15} strokeWidth={2.2} />
        </span>
        <div>
          <h2 className="text-sm font-bold text-foreground">{label}</h2>
          {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
        </div>
      </div>
      {value && (
        <span className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-bold tabular-nums text-foreground">
          {value}
        </span>
      )}
    </div>
  );
}

function ReviewFlowCard({
  stats,
  days,
  isDark,
}: {
  stats: StatsPayload;
  days: number;
  isDark: boolean;
}) {
  const color = isDark ? CHART.primaryDark : CHART.primary;
  const totalReviews = stats.trend.reduce((sum, day) => sum + day.jobs, 0);
  const maxDay = stats.trend.reduce(
    (best, day) => (day.jobs > best.jobs ? day : best),
    stats.trend[0] ?? { day: '', jobs: 0 },
  );

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-md)]">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div>
          <PanelHeader
            label="Review flow"
            detail={`Daily review and comment activity across the last ${days} days`}
            value={`${fmtNumber(totalReviews)} total`}
          />
          <div className="h-[21rem] px-2 pb-4 pt-4 sm:px-4">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <AreaChart data={stats.trend} margin={{ left: -18, right: 18, top: 12, bottom: 0 }}>
                <defs>
                  <linearGradient id="reviewFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="commentFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.comments} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={CHART.comments} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="day"
                  {...axisProps}
                  interval={Math.max(Math.floor(days / 8), 0)}
                  tickFormatter={formatDay}
                />
                <YAxis {...axisProps} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: color, strokeDasharray: '4 4' }} />
                <Area
                  type="monotone"
                  dataKey="jobs"
                  name="reviews"
                  stroke={color}
                  strokeWidth={2.5}
                  fill="url(#reviewFill)"
                  dot={false}
                  activeDot={{ r: 4, fill: color, stroke: 'var(--card)', strokeWidth: 2 }}
                />
                <Area
                  type="monotone"
                  dataKey="comments"
                  name="comments"
                  stroke={CHART.comments}
                  strokeWidth={2}
                  fill="url(#commentFill)"
                  dot={false}
                  activeDot={{ r: 4, fill: CHART.comments, stroke: 'var(--card)', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <aside className="border-t border-border bg-secondary/25 p-5 lg:border-l lg:border-t-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Peak day
          </p>
          <p className="mt-2 text-2xl font-bold tracking-normal text-foreground tabular-nums">
            {maxDay.jobs}
          </p>
          <p className="text-xs text-muted-foreground">{maxDay.day ? formatDay(maxDay.day) : 'No activity'}</p>

          <div className="my-5 h-px bg-border" />

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">Daily average</span>
              <span className="text-sm font-bold tabular-nums text-foreground">
                {ratio(totalReviews, days)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">Comment rate</span>
              <span className="text-sm font-bold tabular-nums text-foreground">
                {ratio(stats.totals.comments, Math.max(totalReviews, 1))}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">Active repos</span>
              <span className="text-sm font-bold tabular-nums text-foreground">
                {stats.topRepos.length}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

function ReviewFlowSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-md)]">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/15">
              <Activity size={15} strokeWidth={2.2} />
            </span>
            <div className="space-y-2">
              <Skeleton height={16} width={108} />
              <Skeleton height={12} width={240} />
            </div>
          </div>
          <div className="mt-8 h-72 rounded-md bg-muted/70 skeleton" />
        </div>
        <div className="border-t border-border bg-secondary/25 p-5 lg:border-l lg:border-t-0">
          <Skeleton height={12} width={72} />
          <Skeleton className="mt-3" height={32} width={48} />
          <div className="my-5 h-px bg-border" />
          <div className="space-y-4">
            <Skeleton height={14} width="100%" />
            <Skeleton height={14} width="88%" />
            <Skeleton height={14} width="92%" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function StatsPage() {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const isDark = useIsDarkMode();

  const load = async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await api.getStats(days);
      setStats(res.stats);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stats.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  usePolling(load, 30_000, [days]);

  return (
    <section className="page-enter flex flex-col gap-6">
      <PageHeader
        category="Reports"
        title="Review metrics"
        description="Daily review and comment activity for the selected range."
        actions={
          <>
            <TimeRangeSelect value={days} onValueChange={setDays} />
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

      {stats ? (
        <>
          <ReviewFlowCard stats={stats} days={days} isDark={isDark} />
          <GraphCardGallery stats={stats} days={days} isDark={isDark} />
        </>
      ) : (
        loading && <ReviewFlowSkeleton />
      )}
    </section>
  );
}
