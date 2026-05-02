import { Link } from 'react-router-dom';
import { StatusBadge } from '@client/components/shared/status-badge';
import { Skeleton } from '@client/components/shared/skeleton';
import { cn } from '@client/lib/utils';
import type { JobSummary } from '@shared/schema';

type Column = 'repo' | 'pr' | 'trigger' | 'status' | 'verdict' | 'files' | 'tokens' | 'created';

interface JobsTableProps {
  jobs: JobSummary[];
  loading: boolean;
  /** Columns to show. Defaults to all. */
  columns?: Column[];
}

const DEFAULT_COLUMNS: Column[] = [
  'repo', 'pr', 'trigger', 'status', 'verdict', 'files', 'tokens', 'created',
];

const thCls = 'px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground select-none';

const COLUMN_CLASSES: Record<Column, string> = {
  repo: '',
  pr: '',
  trigger: 'hidden lg:table-cell',
  status: '',
  verdict: '',
  files: 'hidden md:table-cell',
  tokens: 'hidden lg:table-cell',
  created: 'hidden sm:table-cell',
};

const COLUMN_HEADERS: Record<Column, string> = {
  repo: 'Repository',
  pr: 'Pull request',
  trigger: 'Trigger',
  status: 'Status',
  verdict: 'Verdict',
  files: 'Files',
  tokens: 'Tokens',
  created: 'Created',
};

const SKELETON_WIDTHS: Record<Column, number | string> = {
  repo: 100, pr: '75%', trigger: 55, status: 65, verdict: 65, files: 26, tokens: 54, created: 80,
};

export function JobsTable({ jobs, loading, columns }: JobsTableProps) {
  const cols: Column[] = columns ?? DEFAULT_COLUMNS;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {cols.map((col) => (
              <th
                key={col}
                className={cn(
                  thCls,
                  COLUMN_CLASSES[col],
                  (col === 'files' || col === 'tokens') && 'text-right'
                )}
              >
                {COLUMN_HEADERS[col]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && jobs.length === 0 ? (
            Array.from({ length: 7 }).map((_, i) => (
              <tr key={i} className="border-b border-border/40">
                {cols.map((col) => (
                  <td key={col} className={cn("px-4 py-3.5", COLUMN_CLASSES[col])}>
                    <Skeleton width={SKELETON_WIDTHS[col]} />
                  </td>
                ))}
              </tr>
            ))
          ) : (
            jobs.map((job) => (
              <tr
                key={job.id}
                className="border-b border-border/40 transition-colors hover:bg-primary/[0.03] cursor-default last:border-0"
              >
                {cols.includes('repo') && (
                  <td className={cn("px-4 py-3.5", COLUMN_CLASSES['repo'])}>
                    <Link
                      to={`/jobs/${job.id}`}
                      className="font-semibold text-primary hover:underline underline-offset-2 text-sm"
                    >
                      {job.owner}/{job.repo}
                    </Link>
                  </td>
                )}

                {cols.includes('pr') && (
                  <td className={cn("px-4 py-3.5 max-w-[260px]", COLUMN_CLASSES['pr'])}>
                    <div className="flex items-baseline gap-1.5 min-w-0">
                      <span className="shrink-0 font-mono text-[11px] font-semibold text-muted-foreground">
                        #{job.prNumber}
                      </span>
                      <span className="truncate text-foreground">
                        {job.prTitle ?? 'Untitled PR'}
                      </span>
                    </div>
                  </td>
                )}

                {cols.includes('trigger') && (
                  <td className={cn("px-4 py-3.5", COLUMN_CLASSES['trigger'])}>
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-secondary text-secondary-foreground">
                      {job.trigger}
                    </span>
                  </td>
                )}

                {cols.includes('status') && (
                  <td className={cn("px-4 py-3.5", COLUMN_CLASSES['status'])}>
                    <StatusBadge label={job.status} job={job} />
                  </td>
                )}

                {cols.includes('verdict') && (
                  <td className={cn("px-4 py-3.5", COLUMN_CLASSES['verdict'])}>
                    {job.verdict
                      ? <StatusBadge label={job.verdict} />
                      : <span className="text-muted-foreground/40">—</span>}
                  </td>
                )}

                {cols.includes('files') && (
                  <td className={cn("px-4 py-3.5 text-right font-mono text-xs text-muted-foreground tabular-nums", COLUMN_CLASSES['files'])}>
                    {job.fileCount}
                  </td>
                )}

                {cols.includes('tokens') && (
                  <td className={cn("px-4 py-3.5 text-right font-mono text-xs text-muted-foreground tabular-nums", COLUMN_CLASSES['tokens'])}>
                    {(job.totalInputTokens + job.totalOutputTokens).toLocaleString()}
                  </td>
                )}

                {cols.includes('created') && (
                  <td className={cn("px-4 py-3.5 whitespace-nowrap", COLUMN_CLASSES['created'])}>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm text-muted-foreground">
                        {new Date(job.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      <span className="text-[11px] font-mono text-muted-foreground/60">
                        {new Date(job.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
