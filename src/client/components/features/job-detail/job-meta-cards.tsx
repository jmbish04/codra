import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@client/components/ui/card';
import { Badge, StatusBadge } from '@client/components/ui/badge';
import type { JobDetail } from '@shared/schema';

interface JobMetaCardsProps {
  job: JobDetail;
}

export function JobMetaCards({ job }: JobMetaCardsProps) {
  const isPartialReview = job.status === 'done' && job.errorMessage?.startsWith('Partial review:');

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Details */}
      <Card className="surface-static surface-static-shadow">
        <CardHeader><CardTitle>Job details</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
            {[
              { label: 'Status',  value: <StatusBadge label={job.status} job={job} /> },
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
                  className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-foreground hover:text-primary hover:underline"
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
                    className="inline-flex items-center gap-1 text-xs font-semibold text-foreground hover:text-primary hover:underline"
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
            <div
              className="mt-4 rounded-md border p-3"
              style={{
                background: isPartialReview ? 'var(--warning-bg)' : 'var(--danger-bg)',
                borderColor: isPartialReview ? 'var(--warning-border)' : 'var(--danger-border)',
                color: isPartialReview ? 'var(--warning)' : 'var(--danger)',
              }}
            >
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: isPartialReview ? 'var(--warning)' : 'var(--danger)' }}>
                {isPartialReview ? 'Partial review' : 'Error'}
              </p>
              <p className="text-sm" style={{ color: isPartialReview ? 'var(--warning)' : 'var(--danger)' }}>{job.errorMessage}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Steps */}
      <Card className="surface-static surface-static-shadow">
        <CardHeader><CardTitle>Progress steps</CardTitle></CardHeader>
        <CardContent className="pt-0">
          {(job.steps ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No detailed steps available yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {(job.steps ?? []).map((step, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-md border border-border/40 bg-muted/20 px-4 py-2.5"
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
  );
}
