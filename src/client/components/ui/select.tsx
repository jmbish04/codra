import { ChevronDown } from 'lucide-react';
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
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  label,
  className,
  triggerClassName,
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
              'h-9 w-full justify-between bg-background border-border/50 px-3 py-2 text-sm font-normal transition-all hover:bg-accent/50',
              !selectedOption && 'text-muted-foreground',
              triggerClassName
            )}
          >
            <span className="truncate">
              {selectedOption ? selectedOption.label : placeholder}
            </span>
            <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-[var(--radix-dropdown-menu-trigger-width)] p-1">
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => onValueChange(option.value)}
              className={cn(
                "flex items-center justify-between cursor-pointer py-1.5",
                value === option.value && "bg-accent font-medium"
              )}
            >
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
