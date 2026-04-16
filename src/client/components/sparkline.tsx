import { AreaChart, Area, ResponsiveContainer } from 'recharts';

export function Sparkline({ data, className }: { data: number[], className?: string }) {
  const chartData = data.map((value, i) => ({ value, index: i }));
  
  return (
    <div className={`absolute inset-0 z-0 overflow-hidden pointer-events-none opacity-40 dark:opacity-60 ${className || ''}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.5} />
              <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--primary)"
            strokeWidth={1.5}
            fillOpacity={1}
            fill="url(#colorValue)"
            isAnimationActive={true}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
