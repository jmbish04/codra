import { Link } from 'react-router-dom';
import { ChevronRight, ExternalLink, RotateCcw, Terminal } from 'lucide-react';
import { Button } from '@client/components/ui/button';
import type { JobDetail } from '@shared/schema';

interface JobHeaderProps {
  job: JobDetail;
  isRetrying: boolean;
  onRetry: () => void;
}

export function JobHeader({ job, isRetrying, onRetry }: JobHeaderProps) {
  return (
    <header className="flex flex-col sm:flex-row items-start justify-between gap-4">
      <div className="min-w-0 w-full">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <Link to="/jobs" className="hover:text-foreground transition-colors">Jobs</Link>
          <ChevronRight size={12} className="opacity-40" />
          <span className="text-foreground/60">{job.owner}/{job.repo}</span>
          <ChevronRight size={12} className="opacity-40" />
          <span
            className="font-mono text-[10px] font-medium lowercase tracking-normal text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-default"
            title={job.id}
          >
            {job.id.slice(0, 8)}…
          </span>
        </div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">
          <a
            href={`https://github.com/${job.owner}/${job.repo}/pull/${job.prNumber}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 hover:text-primary transition-colors"
          >
            {job.prTitle ?? 'Untitled pull request'}
            <ExternalLink size={16} className="text-muted-foreground/50" />
          </a>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground leading-snug max-w-[480px] truncate">
          PR #{job.prNumber}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
        <Button variant="outline" asChild className="w-full sm:w-auto gap-2">
          <Link to={`/jobs/${job.id}/logs`}>
            <Terminal size={14} />
            Raw Logs
          </Link>
        </Button>
        <Button
          variant={job.status === 'failed' ? 'destructive' : 'default'}
          disabled={isRetrying || job.status === 'running' || job.status === 'queued'}
          onClick={onRetry}
          className="shrink-0 gap-2 w-full sm:w-auto"
        >
          <RotateCcw size={14} />
          {isRetrying ? 'Starting…' : job.status === 'failed' ? 'Retry job' : 'Re-run job'}
        </Button>
      </div>
    </header>
  );
}
