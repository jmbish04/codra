import * as React from 'react';
import { Calendar, ChevronDown, Clock } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@client/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from './ui/dropdown-menu';

interface TimeRangeSelectProps {
  value: number;
  onValueChange: (value: number) => void;
  className?: string;
}

const timeRanges = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 14 days', value: 14 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
];

export function TimeRangeSelect({ value, onValueChange, className }: TimeRangeSelectProps) {
  const selectedRange = timeRanges.find((r) => r.value === value) || timeRanges[2];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "w-[160px] justify-between border-border/50 bg-background hover:bg-accent/50 transition-all duration-200",
            className
          )}
        >
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-primary/70" />
            <span className="font-medium text-xs truncate">{selectedRange.label}</span>
          </div>
          <ChevronDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[180px]" align="end">
        <DropdownMenuRadioGroup value={value.toString()} onValueChange={(v) => onValueChange(Number(v))}>
          {timeRanges.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value.toString()}
              className="py-1.5 cursor-pointer transition-colors duration-200 text-xs"
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
