import { useEffect, useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '@client/lib/api';
import { StatusBadge } from '@client/components/StatusBadge';
import { Skeleton } from '@client/components/Skeleton';
import { Button } from '@client/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@client/components/ui/card';
import { Badge } from '@client/components/ui/badge';
import { cn } from '@client/lib/utils';
import type { JobDetail, ParsedReviewComment } from '@shared/schema';
import { reviewSeverities, reviewCategories } from '@shared/schema';
import {
  ExternalLink, RotateCcw, ChevronRight, AlertCircle,
  FileText, AlertTriangle, Lightbulb, Sparkles,
  Bug, Zap, Shield, Code2, Star,
} from 'lucide-react';

// ── Severity icon mapping ───────────────────────────────────────────────
const severityConfig: Record<string, { icon: React.ElementType; bg: string; border: string; text: string; iconColor: string }> = {
  P0:   { icon: AlertCircle, bg: 'bg-red-50',    border: 'border-red-200',   text: 'text-red-700',   iconColor: 'text-red-500' },
  P1:   { icon: AlertTriangle, bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', iconColor: 'text-orange-500' },
  P2:   { icon: Lightbulb,  bg: 'bg-amber-50',   border: 'border-amber-200',  text: 'text-amber-700',  iconColor: 'text-amber-500' },
  P3:   { icon: Code2,   bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', iconColor: 'text-blue-500' },
  nit:  { icon: Sparkles,   bg: 'bg-muted/60',  border: 'border-border/60', text: 'text-muted-foreground', iconColor: 'text-muted-foreground' },
};


// ── Comment card ────────────────────────────────────────────────────────
function CommentCard({ comment, filePath }: { comment: ParsedReviewComment; filePath: string }) {
  const sev = severityConfig[comment.severity] ?? severityConfig.nit;
  const SevIcon = sev.icon;

  return (
    <article
      className={cn(
        'rounded-xl border p-4 transition-shadow hover:shadow-md',
        sev.bg, sev.border,
      )}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <SevIcon size={15} className={cn('shrink-0', sev.iconColor)} />
          <span className="font-semibold text-sm text-foreground leading-snug">{comment.title}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`severity-tag ${comment.severity}`}>{comment.severity}</span>
        </div>
      </div>

      {/* Meta: file · line */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1 font-mono bg-card/60 px-1.5 py-0.5 rounded text-foreground/70">
          <FileText size={10} /> {filePath}
        </span>
        {comment.line != null && (
          <span className="text-muted-foreground font-medium">line {comment.line}</span>
        )}
      </div>

      {/* Body */}
      <div className="prose prose-sm max-w-none text-foreground/90 leading-relaxed">
        <ReactMarkdown>{comment.body}</ReactMarkdown>
      </div>

      {/* Code suggestion (UI view) */}
      {comment.codeSuggestion && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground/80">
            Suggested fix
          </p>
          <div className="rounded-lg overflow-hidden border border-border/40 bg-card/40 prose prose-sm max-w-none prose-pre:m-0 prose-pre:rounded-none">
            <ReactMarkdown>
              {`\`\`\`javascript\n${comment.codeSuggestion.replace(/```suggestion\n?|```/g, '')}\n\`\`\``}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </article>
  );
}

// ── Main page ────────────────────────────────────────────────────────────
export function JobDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const pollInterval = useRef<number | null>(null);
  const [viewBy, setViewBy] = useState<'files' | 'severity'>('files');

  const fetchJob = async (silent = false) => {
    try {
      const response = await api.getJob(id);
      setJob(response.job);
      setError(null);
      if (response.job.status === 'done' || response.job.status === 'failed') stopPolling();
    } catch (loadError) {
      if (!silent) setError(loadError instanceof Error ? loadError.message : 'Failed to load job.');
    }
  };

  const startPolling = () => {
    if (pollInterval.current) return;
    pollInterval.current = window.setInterval(() => fetchJob(true), 3000);
  };

  const stopPolling = () => {
    if (pollInterval.current) {
      window.clearInterval(pollInterval.current);
      pollInterval.current = null;
    }
  };

  useEffect(() => { fetchJob(); return () => stopPolling(); }, [id]);
  useEffect(() => {
    if (job && (job.status === 'queued' || job.status === 'running')) startPolling();
    else stopPolling();
  }, [job?.status]);

  const handleRetry = async () => {
    if (!job) return;
    setIsRetrying(true);
    try {
      const response = await api.retryJob(job.id);
      navigate(`/jobs/${response.job.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to retry job.');
    } finally {
      setIsRetrying(false);
    }
  };

  // ── Loading skeleton ──
  if (!job) {
    return (
      <section className="flex flex-col gap-6">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        <header className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton width={120} height="0.75rem" />
            <Skeleton width={280} height="2rem" />
            <Skeleton width={200} height="0.9rem" />
          </div>
          <Skeleton width={100} height="2.25rem" borderRadius={12} />
        </header>
        <div className="grid grid-cols-2 gap-4">
          <Card><CardContent className="p-5 space-y-3">
            <Skeleton width="50%" height="1.2rem" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <Skeleton width={60} height="0.65rem" />
                <Skeleton width={100} height="1rem" />
              </div>
            ))}
          </CardContent></Card>
          <Card><CardContent className="p-5 space-y-3">
            <Skeleton width="50%" height="1.2rem" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl bg-muted/30 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Skeleton width={12} height={12} borderRadius="50%" />
                  <Skeleton width={120} height="0.9rem" />
                </div>
                <Skeleton width={40} height="0.75rem" />
              </div>
            ))}
          </CardContent></Card>
        </div>
      </section>
    );
  }

  const finishedFilesCount = job.files.filter((f) => f.fileStatus === 'done').length;
  const totalFilesCount = job.fileCount || 0;
  const progressPercent = totalFilesCount > 0 ? Math.round((finishedFilesCount / totalFilesCount) * 100) : 0;
  const allComments = job.files.flatMap((f) => f.parsedComments);

  // Severity counts
  const sevCounts = Object.fromEntries(
    reviewSeverities.map((s) => [s, allComments.filter((c) => c.severity === s).length]),
  );

  return (
    <section className="flex flex-col gap-6">
      {/* Page header */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            <Link to="/jobs" className="hover:text-accent transition-colors">Jobs</Link>
            <ChevronRight size={12} />
            <span>{job.owner}/{job.repo}</span>
          </div>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-foreground">
            <a
              href={`https://github.com/${job.owner}/${job.repo}/pull/${job.prNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 hover:text-accent transition-colors"
            >
              PR #{job.prNumber}
              <ExternalLink size={18} className="text-muted-foreground" />
            </a>
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{job.prTitle ?? 'Untitled pull request'}</p>
        </div>

        <Button
          variant={job.status === 'failed' ? 'destructive' : 'default'}
          disabled={isRetrying || job.status === 'running' || job.status === 'queued'}
          onClick={handleRetry}
          className="shrink-0 gap-2"
        >
          <RotateCcw size={14} />
          {isRetrying ? 'Starting…' : job.status === 'failed' ? 'Retry job' : 'Re-run job'}
        </Button>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Progress bar (running/queued only) */}
      {(job.status === 'running' || job.status === 'queued') && (
        <div className="rounded-xl bg-primary p-4 text-primary-foreground">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">
              {job.status === 'queued' ? 'Queued…' : 'Reviewing files…'}
            </span>
            <span className="opacity-80">{finishedFilesCount} / {totalFilesCount} files</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-white transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Job meta + Steps */}
      <div className="grid grid-cols-2 gap-4">
        {/* Details */}
        <Card>
          <CardHeader><CardTitle>Job details</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              {[
                { label: 'Status',  value: <StatusBadge label={job.status} /> },
                { label: 'Verdict', value: job.verdict ? <StatusBadge label={job.verdict} /> : <span className="text-muted-foreground">—</span> },
                { label: 'Trigger', value: <Badge variant="neutral" className="capitalize">{job.trigger}</Badge> },
                { label: 'Tokens',  value: <span className="font-mono text-sm">{(job.totalInputTokens + job.totalOutputTokens).toLocaleString()}</span> },
              ].map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Commit</dt>
                <dd>
                  <a
                    href={`https://github.com/${job.owner}/${job.repo}/commit/${job.commitSha}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-xs text-accent hover:underline"
                  >
                    {job.commitSha.slice(0, 7)}
                    <ExternalLink size={11} />
                  </a>
                </dd>
              </div>
              {job.reviewId && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Review</dt>
                  <dd>
                    <a
                      href={`https://github.com/${job.owner}/${job.repo}/pull/${job.prNumber}#pullrequestreview-${job.reviewId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                    >
                      View on GitHub <ExternalLink size={11} />
                    </a>
                  </dd>
                </div>
              )}
              {job.retryOfJobId && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Retry of</dt>
                  <dd>
                    <Link to={`/jobs/${job.retryOfJobId}`} className="font-mono text-xs text-muted-foreground hover:underline">
                      {job.retryOfJobId.slice(0, 8)}…
                    </Link>
                  </dd>
                </div>
              )}
              <div className="col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Created</dt>
                <dd className="text-sm text-muted-foreground">{new Date(job.createdAt).toLocaleString()}</dd>
              </div>
            </dl>

            {job.errorMessage && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3">
                <p className="mb-1 text-xs font-semibold text-red-700 uppercase tracking-wider">Error</p>
                <p className="text-sm text-red-600">{job.errorMessage}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Steps */}
        <Card>
          <CardHeader><CardTitle>Progress steps</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {(job.steps ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No detailed steps available yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {(job.steps ?? []).map((step, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-xl border border-border/40 bg-muted/20 px-4 py-2.5"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`step-dot ${step.status}`} />
                      <span className="text-sm font-medium text-foreground">{step.name}</span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      {step.status === 'running'
                        ? 'Processing…'
                        : step.finishedAt && step.startedAt
                        ? `${((new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime()) / 1000).toFixed(1)}s`
                        : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary */}
      {job.summaryMarkdown && (
        <Card>
          <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <div className="prose max-w-none">
              <ReactMarkdown>{job.summaryMarkdown}</ReactMarkdown>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Review findings overview */}
      {allComments.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Review findings</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-3">
              {reviewSeverities.map((sev) => {
                const count = sevCounts[sev];
                if (!count) return null;
                const cfg = severityConfig[sev];
                const Icon = cfg?.icon ?? AlertCircle;
                return (
                  <div
                    key={sev}
                    className={cn(
                      'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm',
                      cfg?.bg, cfg?.border,
                    )}
                  >
                    <Icon size={13} className={cfg?.iconColor} />
                    <span className={cn('font-medium capitalize', cfg?.text)}>{sev}</span>
                    <span className={cn('font-bold', cfg?.text)}>{count}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Findings list with view toggle */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-bold text-foreground">Findings</h2>
            {job.status === 'running' && <span className="pulsing-dot" />}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">View by</span>
            <div className="flex rounded-xl bg-secondary p-1 gap-0.5">
              {(['files', 'severity'] as const).map((view) => (
                <button
                  key={view}
                  onClick={() => setViewBy(view)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-all',
                    viewBy === view
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {view}
                </button>
              ))}
            </div>
          </div>
        </div>

        {viewBy === 'files' ? (
          <div className="flex flex-col gap-3">
            {job.files.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 p-12 text-center text-sm text-muted-foreground">
                No files reviewed yet.
              </div>
            ) : (
              job.files.map((file) => (
                <details key={file.id} className="group rounded-2xl border border-border/60 bg-card/80 shadow-sm backdrop-blur-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
                    <div className="flex items-center gap-2 min-w-0">
                      <ChevronRight size={15} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                      <span className="font-mono text-sm font-medium text-foreground truncate">{file.filePath}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge label={file.fileStatus} />
                      <StatusBadge label={file.verdict ?? 'comment'} />
                      {file.parsedComments.length > 0 && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
                          {file.parsedComments.length}
                        </span>
                      )}
                    </div>
                  </summary>

                  <div className="border-t border-border/40 px-5 pb-5 pt-4">
                    {/* File-level error */}
                    {file.fileStatus === 'failed' && file.errorMessage && (
                      <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3">
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-red-700">Review error</p>
                        <p className="font-mono text-xs text-red-600 break-all">{file.errorMessage}</p>
                      </div>
                    )}

                    {/* File summary (when review succeeded) */}
                    {file.fileStatus === 'done' && file.fileSummary && (
                      <div className="mb-4 rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Model summary</p>
                        <div className="prose prose-sm max-w-none text-foreground/90 leading-relaxed">
                          <ReactMarkdown>{file.fileSummary}</ReactMarkdown>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 mb-5">
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Prompt / diff
                        </p>
                        <pre className="code-block max-h-72">{file.diffInput ?? 'No prompt saved.'}</pre>
                      </div>
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Raw model output
                        </p>
                        <pre className="code-block max-h-72">{file.rawAiOutput ?? 'No raw output saved.'}</pre>
                      </div>
                    </div>

                    {file.parsedComments.length > 0 && (
                      <div>
                        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Inline comments ({file.parsedComments.length})
                        </p>
                        <div className="flex flex-col gap-3">
                          {file.parsedComments.map((comment, index) => (
                            <CommentCard key={`${file.id}-${index}`} comment={comment} filePath={file.filePath} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </details>
              ))
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {reviewSeverities.map((groupName) => {
              const comments = job.files.flatMap((f) =>
                f.parsedComments
                  .filter((c) => c.severity === groupName)
                  .map((c) => ({ ...c, filePath: f.filePath })),
              );
              if (comments.length === 0) return null;

              const sev = severityConfig[groupName];
              const GroupIcon = sev?.icon ?? FileText;

              return (
                <Card key={groupName}>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <GroupIcon
                        size={15}
                        className={sev?.iconColor ?? 'text-muted-foreground'}
                      />
                      <CardTitle className="uppercase font-mono text-sm">{groupName}</CardTitle>
                      <span className="ml-1 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
                        {comments.length}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex flex-col gap-3">
                      {comments.map((comment, index) => (
                        <CommentCard
                          key={`${groupName}-${index}`}
                          comment={comment}
                          filePath={comment.filePath}
                        />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
