import { FileCode2, Hourglass } from 'lucide-react';
import type { JobDetail } from '@shared/schema';
import { Progress } from '@client/components/ui/progress';

interface JobProgressProps {
  job: JobDetail;
}

export function JobProgress({ job }: JobProgressProps) {
  if (job.status !== 'running' && job.status !== 'queued') return null;

  const finishedCount = job.files.filter(f => f.fileStatus === 'done' || f.fileStatus === 'skipped').length;
  const total = job.fileCount || 0;
  const pct = total > 0 ? Math.round((finishedCount / total) * 100) : 0;
  const isQueued = job.status === 'queued';

  const activeFile = job.files.find(f => f.fileStatus === 'pending');
  const activeFilePath = activeFile?.filePath ?? null;

  // Shorten file path for display: keep last 2 segments
  const displayPath = activeFilePath
    ? activeFilePath.split('/').slice(-2).join('/')
    : null;
  const prefixPath = activeFilePath && activeFilePath.includes('/')
    ? activeFilePath.split('/').slice(0, -2).join('/') + '/'
    : null;

  return (
    <div
      className="relative overflow-hidden rounded-xl px-6 py-5"
      style={{
        background: 'var(--primary)',
        color: 'var(--primary-foreground)',
      }}
    >
      {/* Subtle grid texture */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.07]"
        style={{
          backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 23px, var(--primary-foreground) 23px, var(--primary-foreground) 24px),
            repeating-linear-gradient(90deg, transparent, transparent 23px, var(--primary-foreground) 23px, var(--primary-foreground) 24px)`,
        }}
      />

      <div className="relative">
        {/* Top row: label + count */}
        <div className="flex items-baseline justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            {isQueued
              ? <Hourglass size={13} className="opacity-70 shrink-0" />
              : <FileCode2 size={13} className="opacity-70 shrink-0" />
            }
            <span className="text-sm font-semibold tracking-tight">
              {isQueued ? 'Waiting in queue' : 'Reviewing files'}
            </span>
          </div>
          <span className="font-mono text-xs font-bold opacity-60 tabular-nums shrink-0">
            {isQueued ? '—' : `${finishedCount} / ${total}`}
          </span>
        </div>

        {/* Progress track */}
        <Progress 
          value={isQueued ? 0 : pct} 
          className="h-2.5 bg-primary-foreground/20 border-none"
          indicatorClassName="bg-gradient-to-r from-primary-foreground/80 via-primary-foreground to-primary-foreground/90"
        />

        {/* Active file + percent */}
        {!isQueued && (
          <div className="flex items-baseline justify-between gap-4 mt-2.5">
            <div className="min-w-0 flex items-baseline gap-0 font-mono text-[11px] opacity-55 truncate">
              {prefixPath && (
                <span className="opacity-60 shrink-0 hidden sm:inline">{prefixPath}</span>
              )}
              {displayPath
                ? <span className="font-semibold">{displayPath}</span>
                : <span className="italic opacity-40">—</span>
              }
            </div>
            <span className="font-mono text-xs font-bold opacity-50 tabular-nums shrink-0">{pct}%</span>
          </div>
        )}
      </div>
    </div>
  );
}
