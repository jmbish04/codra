import * as React from "react";
import { cn } from "@client/lib/utils";

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  onCheckedChange?: (checked: boolean) => void;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, onCheckedChange, onChange, ...props }, ref) => {
    return (
      <label className="relative inline-flex cursor-pointer items-center">
        <input
          type="checkbox"
          className="sr-only peer"
          ref={ref}
          onChange={(e) => {
            onChange?.(e);
            onCheckedChange?.(e.target.checked);
          }}
          {...props}
        />
        <div className={cn(
          "relative h-5 w-9 rounded-full border transition-all duration-200",
          "border-border bg-muted-foreground/20",
          "peer-checked:border-primary peer-checked:bg-primary",
          "after:absolute after:left-[3px] after:top-[3px] after:h-3 after:w-3 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 after:content-['']",
          "peer-checked:after:translate-x-4",
          className
        )} />
      </label>
    );
  }
);
Switch.displayName = "Switch";

export { Switch };
