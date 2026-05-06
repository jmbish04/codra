import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@client/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold border tracking-wide transition-colors',
  {
    variants: {
      variant: {
        default:   'bg-primary/10 text-primary border-primary/25',
        secondary: 'bg-secondary text-secondary-foreground border-border/50',
        neutral:   'bg-secondary text-secondary-foreground border-border/50',
        info:      'bg-info-bg text-info border-info-border',
        success:   'bg-success-bg text-success border-success-border',
        warning:   'bg-warning-bg text-[oklch(50%_0.14_65)] border-warning-border dark:text-warning',
        danger:    'bg-danger-bg text-danger border-danger-border',
        outline:   'text-foreground border-border bg-transparent',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
