import * as React from 'react';
import { cn } from '@client/lib/utils';
import { LucideIcon } from 'lucide-react';
import { Skeleton } from '@client/components/shared/skeleton';
import { Sparkline } from '@client/components/shared/sparkline';

interface StatsItem {
  label: string;
  value: string | number | null;
  icon: LucideIcon;
  trend?: number[];
}

interface StatsGridProps extends React.HTMLAttributes<HTMLDivElement> {
  items: StatsItem[];
  columns?: number;
}

export function StatsGrid({ items, columns = 4, className, ...props }: StatsGridProps) {
  const gridCols = {
    2: 'grid-cols-2',
    4: 'grid-cols-2 sm:grid-cols-4',
    5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
  }[columns as 2 | 4 | 5] || 'grid-cols-2 sm:grid-cols-4';

  return (
    <div
      className={cn(
        'surface surface-static-shadow grid divide-x divide-y divide-border overflow-hidden',
        gridCols,
        columns === 4 && 'sm:divide-y-0',
        className
      )}
      {...props}
    >
      {items.map(({ label, value, icon: Icon, trend }, i) => (
        <div 
          key={i} 
          className="flex flex-col gap-2.5 px-5 py-4 sm:px-6 sm:py-5 relative overflow-hidden"
        >
          {trend && <Sparkline data={trend} />}
          
          <div className="relative z-10 flex items-center gap-2 text-muted-foreground">
            <Icon size={13} strokeWidth={1.75} />
            <span className="stat-label">{label}</span>
          </div>
          
          <div className="relative z-10">
            {value !== null ? (
              <p className="stat-number">{value}</p>
            ) : (
              <Skeleton height={36} width={60} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
