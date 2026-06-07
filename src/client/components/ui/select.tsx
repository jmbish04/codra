import { ChevronDown } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@client/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { Button } from './button';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: string;
  className?: string;
  triggerClassName?: string;
  triggerStyle?: CSSProperties;
  leadingIcon?: ReactNode;
  /**
   * 'page'  — trigger sits on the gray page background (e.g. "Last 30 days").
   *            Dropdown gets white bg so it lifts off the page.
   * 'card'  — trigger sits inside a white card (e.g. "All statuses").
   *            Dropdown gets zinc-50 bg so it's distinguishable from the card.
   * Defaults to 'page'.
   */
  variant?: 'page' | 'card';
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  label,
  className,
  triggerClassName,
  triggerStyle,
  leadingIcon,
  variant = 'page',
}: SelectProps) {
  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
          {label}
        </label>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              'h-9 w-full justify-between px-3 py-2 text-sm font-normal transition-all focus-visible:ring-0 focus-visible:ring-offset-0',
              variant === 'page' ? 'bg-card' : 'bg-muted/50',
              !selectedOption && 'text-muted-foreground',
              triggerClassName,
            )}
            style={triggerStyle}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {leadingIcon && (
                <span className="shrink-0 text-primary/70">
                  {leadingIcon}
                </span>
              )}
              <span className="min-w-0 truncate">
                {selectedOption ? selectedOption.label : placeholder}
              </span>
            </span>
            <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          collisionPadding={12}
          className="max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))] min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-[calc(100vw-1.5rem)] overflow-y-auto sm:w-max sm:max-w-[42rem]"
        >
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => onValueChange(option.value)}
              className={cn(
                'cursor-pointer whitespace-normal break-words py-2',
                value === option.value &&
                  'bg-primary/10 font-medium text-primary dark:bg-primary/[0.12] dark:text-primary',
              )}
            >
              <span className="min-w-0">{option.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
