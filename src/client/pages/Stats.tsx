import { useEffect, useRef, useState } from 'react';
import { api } from '@client/lib/api';
import type { StatsPayload } from '@shared/schema';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { TrendingUp, CheckCircle2, Cpu, Terminal, Activity, ArrowUpRight, MessageSquare } from 'lucide-react';
import { TimeRangeSelect } from '@client/components/time-range-select';

/* ── Emerald palette (static — needed for SVG attributes) ── */
const EM      = '#10b981'; // emerald-500
const EM_DARK = '#34d399'; // emerald-400 (for dark mode charts)

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

const VERDICT_COLORS = {
  approve:         EM,
  comment:         '#f59e0b',
  request_changes: '#f87171',
  none:            '#6b7280',
};
const MODEL_HUES = [155, 45, 250, 25, 295];

/* ── Custom tooltip ── */
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="surface px-3 py-2.5 text-xs shadow-lg">
      {label && <p className="font-semibold text-foreground mb-1">{label}</p>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-muted-foreground capitalize">{p.name}:</span>
          <span className="font-semibold text-foreground tabular-nums">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

/* ── Shared axis props ── */
const axisProps = {
  fontSize: 10,
  tickLine: false,
  axisLine: false,
  tick: { fontFamily: 'var(--font-sans)', fill: 'var(--muted-foreground)' } as const,
};

/* ── Scorecard strip ── */
function KpiStrip({ stats }: { stats: StatsPayload }) {
  const items = [
    { icon: Activity,       label: 'Reviews',       value: fmt(stats.totals.jobs) },
    { icon: ArrowUpRight,   label: 'Input tokens',  value: fmt(stats.totals.inputTokens) },
    { icon: Cpu,            label: 'Output tokens', value: fmt(stats.totals.outputTokens) },
    { icon: MessageSquare,  label: 'Comments',      value: fmt(stats.totals.comments) },
  ];

  return (
    <div className="surface grid grid-cols-4 divide-x divide-border">
      {items.map(({ icon: Icon, label, value }, i) => (
        <div key={i} className="flex flex-col gap-2.5 px-6 py-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon size={13} strokeWidth={1.75} />
            <span className="stat-label">{label}</span>
          </div>
          <p className="stat-number">{value}</p>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   EVIL Chart: Full-width Area — 30-day review volume
══════════════════════════════════════════════════════════ */
function EvilAreaChart({ data, isDark, days }: { data: { day: string; jobs: number }[]; isDark: boolean; days: number }) {
  const color = isDark ? EM_DARK : EM;
  return (
    <div className="chart-card">
      <div className="chart-card-inner" />
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-primary" strokeWidth={2} />
          <span className="text-sm font-semibold text-foreground">Review volume · last {days} days</span>
        </div>
        <span className="text-xs text-muted-foreground font-mono">
          {data.reduce((s, d) => s + d.jobs, 0)} total
        </span>
      </div>
      <div className="px-1 pb-4" style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: -16, right: 12, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={color} stopOpacity={0.35} />
                <stop offset="55%"  stopColor={color} stopOpacity={0.08} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
              <filter id="areaGlow" x="-10%" y="-30%" width="120%" height="160%">
                <feGaussianBlur stdDeviation="3.5" result="blur" in="SourceGraphic" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="var(--border)"
              strokeOpacity={0.6}
            />
            <XAxis
              dataKey="day"
              {...axisProps}
              tickFormatter={(v) => {
                const [, m, d] = v.split('-');
                return `${m}/${d}`;
              }}
              interval={4}
            />
            <YAxis {...axisProps} />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: '4 3' }}
            />
            <Area
              type="monotone"
              dataKey="jobs"
              name="reviews"
              stroke={color}
              strokeWidth={2.5}
              fill="url(#areaFill)"
              filter="url(#areaGlow)"
              dot={false}
              activeDot={{
                r: 4,
                fill: color,
                stroke: 'var(--card)',
                strokeWidth: 2.5,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   EVIL Chart: Bar — language models
══════════════════════════════════════════════════════════ */
function EvilBarChart({
  models, isDark,
}: {
  models: StatsPayload['models'];
  isDark: boolean;
}) {
  const color = isDark ? EM_DARK : EM;
  const chartData = models.map((m) => ({
    name: m.modelUsed.split('/').pop() ?? m.modelUsed,
    calls: m.calls,
  }));

  return (
    <div className="chart-card flex flex-col">
      <div className="chart-card-inner" />
      <div className="flex items-center gap-2 px-5 pt-5 pb-3">
        <Cpu size={14} className="text-primary" strokeWidth={2} />
        <span className="text-sm font-semibold text-foreground">Language models</span>
      </div>
      <div className="flex-1 px-1 pb-4" style={{ minHeight: 190 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ left: -16, right: 12, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={color} stopOpacity={0.95} />
                <stop offset="100%" stopColor={color} stopOpacity={0.45} />
              </linearGradient>
              <filter id="barGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.5" result="blur" in="SourceGraphic" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
            <XAxis dataKey="name" {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: `${color}14` }} />
            <Bar
              dataKey="calls"
              name="calls"
              fill="url(#barFill)"
              radius={[5, 5, 0, 0]}
              maxBarSize={52}
              filter="url(#barGlow)"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   EVIL Chart: Donut — decision mix
══════════════════════════════════════════════════════════ */
const RADIAN = Math.PI / 180;
function CustomLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) {
  if (percent < 0.08) return null;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x} y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={10}
      fontWeight={700}
      fontFamily="var(--font-sans)"
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

function EvilDonut({ verdictData }: { verdictData: { name: string; value: number; color: string }[] }) {
  return (
    <div className="chart-card flex flex-col">
      <div className="chart-card-inner" />
      <div className="flex items-center gap-2 px-5 pt-5 pb-3">
        <CheckCircle2 size={14} className="text-primary" strokeWidth={2} />
        <span className="text-sm font-semibold text-foreground">Decision mix</span>
      </div>
      <div className="flex-1 flex items-center gap-4 px-4 pb-5" style={{ minHeight: 190 }}>
        <div style={{ width: 160, height: 160, flexShrink: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <defs>
                <filter id="donutGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" in="SourceGraphic" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <Pie
                data={verdictData}
                innerRadius={44}
                outerRadius={70}
                paddingAngle={3}
                dataKey="value"
                strokeWidth={0}
                labelLine={false}
                label={CustomLabel}
                animationBegin={0}
                animationDuration={900}
                filter="url(#donutGlow)"
              >
                {verdictData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex flex-col gap-2.5 min-w-0">
          {verdictData.map((v) => (
            <div key={v.name} className="flex items-center gap-2.5">
              <div
                className="shrink-0 h-2.5 w-2.5 rounded-sm"
                style={{ background: v.color, boxShadow: `0 0 6px ${v.color}` }}
              />
              <span className="capitalize text-xs text-muted-foreground truncate">
                {v.name.replace(/_/g, ' ')}
              </span>
              <span className="ml-auto pl-2 font-semibold tabular-nums text-xs text-foreground shrink-0">
                {v.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Top Repos  
══════════════════════════════════════════════════════════ */
function TopRepos({ repos }: { repos: StatsPayload['topRepos'] }) {
  const max = Math.max(...repos.map((r) => r.jobs), 1);
  return (
    <div className="chart-card flex flex-col">
      <div className="chart-card-inner" />
      <div className="flex items-center gap-2 px-5 pt-5 pb-3">
        <Terminal size={14} className="text-primary" strokeWidth={2} />
        <span className="text-sm font-semibold text-foreground">Active repositories</span>
      </div>
      <div className="flex flex-col divide-y divide-border px-5 pb-5 flex-1">
        {repos.map((repo, i) => {
          const pct = (repo.jobs / max) * 100;
          return (
            <div key={i} className="flex flex-col gap-1.5 py-2.5 first:pt-0">
              <div className="flex items-center justify-between text-xs">
                <span className="truncate text-foreground font-medium">
                  {repo.owner}/{repo.repo}
                </span>
                <span className="ml-3 shrink-0 font-mono font-semibold text-foreground tabular-nums">
                  {repo.jobs}
                </span>
              </div>
              <div className="h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(to right, ${EM}, oklch(72% 0.18 155))`,
                    boxShadow: `0 0 6px ${EM}80`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Main page
══════════════════════════════════════════════════════════ */
export function StatsPage() {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
    const obs = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    api.getStats(days)
      .then((r) => setStats(r.stats))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load stats.'));
  }, [days]);

  if (!stats) {
    return (
      <section className="page-enter flex flex-col gap-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary/70 mb-1">Analytics</p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground" style={{ letterSpacing: '-0.025em' }}>
            System insights
          </h1>
        </header>
        <div className="surface px-5 py-4 text-sm text-muted-foreground">
          {error ?? 'Loading…'}
        </div>
      </section>
    );
  }

  const verdictData = stats.verdicts
    .map((v) => ({
      name: v.verdict ?? 'none',
      value: v.count,
      color: VERDICT_COLORS[v.verdict as keyof typeof VERDICT_COLORS] ?? '#6b7280',
    }))
    .filter((v) => v.value > 0);

  return (
    <section className="page-enter flex flex-col gap-5">

      {/* Header */}
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary/70 mb-1">Analytics</p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground" style={{ letterSpacing: '-0.025em' }}>
            System insights
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <TimeRangeSelect 
            value={days}
            onValueChange={setDays}
          />
        </div>
      </header>
      
      {/* KPI strip */}
      <KpiStrip stats={stats} />

      {/* Full-width area chart */}
      <EvilAreaChart data={stats.trend} isDark={isDark} days={days} />

      {/* Row 2: bar + donut */}
      <div className="grid grid-cols-2 gap-5">
        <EvilBarChart models={stats.models} isDark={isDark} />
        <EvilDonut verdictData={verdictData} />
      </div>

      {/* Repos (spans full width if single, half if side-by-side) */}
      {stats.topRepos.length > 0 && <TopRepos repos={stats.topRepos} />}

    </section>
  );
}
