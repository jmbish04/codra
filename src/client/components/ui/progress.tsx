import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import { cn } from "@client/lib/utils"

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    indicatorClassName?: string;
  }
>(({ className, value, indicatorClassName, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-3 w-full overflow-hidden rounded-full bg-secondary/30 border border-border/10",
      className
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className={cn(
        "h-full w-full flex-1 bg-gradient-to-r from-primary/80 via-primary to-primary/95 transition-all relative overflow-hidden",
        indicatorClassName
      )}
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    >
      {/* Dynamic shimmer gloss */}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_25%,rgba(255,255,255,0.25)_50%,transparent_75%)] bg-[length:200%_100%] animate-[shimmer_1.5s_linear_infinite]" />
    </ProgressPrimitive.Indicator>
  </ProgressPrimitive.Root>
))
Progress.displayName = ProgressPrimitive.Root.displayName

const ProgressLabel = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    className={cn("text-xs font-semibold text-muted-foreground", className)}
    {...props}
  />
))
ProgressLabel.displayName = "ProgressLabel"

const ProgressValue = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & { value?: number }
>(({ className, value, ...props }, ref) => (
  <span
    ref={ref}
    className={cn("text-xs font-mono font-medium text-muted-foreground/80", className)}
    {...props}
  >
    {value !== undefined ? `${Math.round(value)}%` : ""}
  </span>
))
ProgressValue.displayName = "ProgressValue"

export { Progress, ProgressLabel, ProgressValue }
