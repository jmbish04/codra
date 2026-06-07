import * as React from 'react';
import { cn } from '@client/lib/utils';
import { UpdatesEmailPrompt } from '@client/components/features/dashboard/updates-email-prompt';

interface PageHeaderProps extends React.HTMLAttributes<HTMLElement> {
  category: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  versionBadge?: string;
}

export function PageHeader({ 
  category, 
  title, 
  description, 
  actions, 
  className, 
  ...props 
}: PageHeaderProps) {
  return (
    <>
      <header
        className={cn('flex flex-col sm:flex-row sm:items-end justify-between gap-4 sm:gap-0', className)}
        {...props}
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary/70 mb-1">
            {category}
          </p>
          <h1
            className="flex items-center gap-3 text-xl md:text-2xl font-bold text-foreground"
            style={{ letterSpacing: '-0.025em' }}
          >
            {title}
            {props.versionBadge && (
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-semibold text-primary">
                v{props.versionBadge}
              </span>
            )}
          </h1>
          {description && (
            <div className="mt-1 text-sm text-muted-foreground">
              {description}
            </div>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
            {actions}
          </div>
        )}
      </header>
      <UpdatesEmailPrompt />
    </>
  );
}
