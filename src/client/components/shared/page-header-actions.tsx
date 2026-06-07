import { RefreshCw } from 'lucide-react';
import { Button } from '@client/components/ui/button';
import { TimeRangeSelect } from '@client/components/features/stats/time-range-select';
import { useIsDarkMode } from '@client/hooks/use-is-dark-mode';

interface PageHeaderActionsProps {
  days: number;
  onDaysChange: (days: number) => void;
  onRefresh: () => void;
  refreshing: boolean;
}

export function PageHeaderActions({
  days,
  onDaysChange,
  onRefresh,
  refreshing,
}: PageHeaderActionsProps) {
  const isDark = useIsDarkMode();
  const btnBg = isDark ? undefined : '#ffffff';

  return (
    <>
      <TimeRangeSelect
        value={days}
        onValueChange={onDaysChange}
        triggerStyle={btnBg ? { backgroundColor: btnBg } : undefined}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={onRefresh}
        disabled={refreshing}
        className="gap-2"
        style={btnBg ? { backgroundColor: btnBg } : undefined}
      >
        <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
        Refresh
      </Button>
    </>
  );
}
