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
        info:      'bg-[var(--info-bg)] text-[var(--info)] border-[var(--info-border)]',
        success:   'bg-[var(--success-bg)] text-[var(--success)] border-[var(--success-border)]',
        warning:   'bg-[var(--warning-bg)] text-[var(--warning)] border-[var(--warning-border)]',
        danger:    'bg-[var(--danger-bg)] text-[var(--danger)] border-[var(--danger-border)]',
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
