import { useMemo } from 'react';
import { Activity, ArrowUpRight, Cpu, MessageSquare, DollarSign } from 'lucide-react';
import { StatsGrid } from './stats-grid';
import { fmtNumber, fmtUsd } from '@client/lib/utils';
import type { StatsPayload } from '@shared/schema';

interface OverviewStatsProps {
  stats: StatsPayload | null;
  days: number;
}

const generateMockTrend = (base: number, length: number) => {
  return Array.from({ length }, (_, i) => {
    const trend = (i / Math.max(1, length - 1)) * (base * 0.5);
    const noise = (Math.random() - 0.5) * (base * 0.3);
    return Math.max(0, base + trend + noise);
  });
};

/**
 * Common component for the 4 overview KPI cards used on Dashboard and Stats pages.
 * Handles loading states (skeletons) and mock sparklines for consistent aesthetics.
 */
export function OverviewStats({ stats, days }: OverviewStatsProps) {
  const mockTrends = useMemo(() => ({
    jobs: generateMockTrend(40, days),
    inputTokens: generateMockTrend(100, days),
    outputTokens: generateMockTrend(80, days),
    comments: generateMockTrend(20, days),
  }), [days]);

  // Real cost sparkline from the daily trend (not mocked like the others).
  const costTrend = useMemo(
    () => (stats ? stats.trend.map((point) => point.costUsd) : Array(days).fill(0)),
    [stats, days],
  );

  const items = [
    {
      icon: DollarSign,
      label: `Cost · ${days}d`,
      value: stats ? fmtUsd(stats.totals.costUsd) : null,
      trend: costTrend,
    },
    {
      icon: Activity,
      label: 'Total reviews',
      value: stats ? fmtNumber(stats.totals.jobs) : null,
      trend: stats ? mockTrends.jobs : Array(days).fill(0),
    },
    {
      icon: ArrowUpRight,
      label: 'Input tokens',
      value: stats ? fmtNumber(stats.totals.inputTokens) : null,
      trend: stats ? mockTrends.inputTokens : Array(days).fill(0),
    },
    {
      icon: Cpu,
      label: 'Output tokens',
      value: stats ? fmtNumber(stats.totals.outputTokens) : null,
      trend: stats ? mockTrends.outputTokens : Array(days).fill(0),
    },
    {
      icon: MessageSquare,
      label: 'Comments posted',
      value: stats ? fmtNumber(stats.totals.comments) : null,
      trend: stats ? mockTrends.comments : Array(days).fill(0),
    },
  ];

  return <StatsGrid items={items} columns={5} />;
}
