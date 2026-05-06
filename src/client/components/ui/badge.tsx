import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@client/lib/utils';
import type { JobSummary } from '@shared/schema';
import { LiveReviewStepper } from '@client/components/features/reviews/live-review-stepper';

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
        warning:   'badge-warning',
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

type BadgeVariant = NonNullable<BadgeProps['variant']>;

function getTone(value: string): BadgeVariant {
  switch (value) {
    case 'done':
    case 'approve':
      return 'success';
    case 'running':
      return 'info';
    case 'comment':
      return 'warning';
    case 'failed':
    case 'request_changes':
      return 'danger';
    case 'queued':
    case 'superseded':
      return 'neutral';
    default:
      return 'neutral';
  }
}

function StatusBadge({ label, job }: { label: string; job?: JobSummary }) {
  if (job && (label === 'running' || label === 'queued')) {
    return <LiveReviewStepper job={job} />;
  }

  return (
    <Badge variant={getTone(label)} className="capitalize">
      {label.replace(/_/g, ' ')}
    </Badge>
  );
}

export { Badge, StatusBadge, badgeVariants };
