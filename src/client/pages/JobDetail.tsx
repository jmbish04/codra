import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '@client/lib/api';
import { StatusBadge } from '@client/components/StatusBadge';
import type { JobDetail } from '@shared/schema';

export function JobDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isRetrying, setIsRetrying] = useState(false);
  const pollInterval = useRef<number | null>(null);

  const fetchJob = async (silent = false) => {
    try {
      const response = await api.getJob(id);
      setJob(response.job);
      setError(null);
      
      // Stop polling if job is finished
      if (response.job.status === 'done' || response.job.status === 'failed') {
        stopPolling();
      }
    } catch (loadError) {
      if (!silent) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load job.');
      }
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

  useEffect(() => {
    fetchJob();
    return () => stopPolling();
  }, [id]);

  useEffect(() => {
    if (job && (job.status === 'queued' || job.status === 'running')) {
      startPolling();
    } else {
      stopPolling();
    }
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

  if (!job) {
    return (
      <section className="page">
        <div className="panel">{error ?? 'Loading job...'}</div>
      </section>
    );
  }

  const finishedFilesCount = job.files.filter((f) => f.fileStatus === 'done').length;
  const totalFilesCount = job.fileCount || 0;
  const progressPercent = totalFilesCount > 0 ? Math.round((finishedFilesCount / totalFilesCount) * 100) : 0;

  return (
    <section className="page">
      <header className="page-header split">
        <div>
          <div className="eyebrow">
            <Link to="/jobs" style={{ textDecoration: 'none', color: 'inherit' }}>
              Jobs
            </Link>{' '}
            / {job.owner}/{job.repo}
          </div>
          <h1>PR #{job.prNumber}</h1>
          <p className="muted">{job.prTitle ?? 'Untitled pull request'}</p>
        </div>

        <div className="actions">
          <button
            className={`primary-button ${job.status === 'failed' ? 'danger' : ''}`}
            type="button"
            disabled={isRetrying || job.status === 'running' || job.status === 'queued'}
            onClick={handleRetry}
          >
            {isRetrying ? 'Starting...' : job.status === 'failed' ? 'Retry job' : 'Re-run job'}
          </button>
        </div>
      </header>

      {error ? <div className="error-box">{error}</div> : null}

      {(job.status === 'running' || job.status === 'queued') && (
        <div className="panel progress-panel">
          <div className="progress-header">
            <strong>{job.status === 'queued' ? 'Queued...' : 'Reviewing files...'}</strong>
            <span>
              {finishedFilesCount} / {totalFilesCount} files
            </span>
          </div>
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }}></div>
          </div>
        </div>
      )}

      <div className="grid two">
        <div className="panel">
          <h2>Job details</h2>
          <dl className="meta-grid">
            <div>
              <dt>Status</dt>
              <dd>
                <StatusBadge label={job.status} />
              </dd>
            </div>
            <div>
              <dt>Verdict</dt>
              <dd>{job.verdict ? <StatusBadge label={job.verdict} /> : <span className="muted">—</span>}</dd>
            </div>
            <div>
              <dt>Trigger</dt>
              <dd>
                <span className="badge neutral" style={{ textTransform: 'capitalize' }}>{job.trigger}</span>
              </dd>
            </div>
            <div>
              <dt>Tokens</dt>
              <dd>{(job.totalInputTokens + job.totalOutputTokens).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Commit</dt>
              <dd>
                <code className="text-sm">{job.commitSha.slice(0, 7)}</code>
              </dd>
            </div>
            {job.retryOfJobId && (
              <div>
                <dt>Retry of</dt>
                <dd>
                  <Link to={`/jobs/${job.retryOfJobId}`} className="muted text-sm">
                    {job.retryOfJobId.slice(0, 8)}...
                  </Link>
                </dd>
              </div>
            )}
            <div>
              <dt>Created</dt>
              <dd className="muted text-sm">{new Date(job.createdAt).toLocaleString()}</dd>
            </div>
          </dl>

          {job.errorMessage && (
            <div className="error-message-block">
              <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Error</h3>
              <p style={{ margin: 0, fontSize: '0.9rem' }}>{job.errorMessage}</p>
            </div>
          )}
        </div>

        <div className="panel">
          <h2>Progress steps</h2>
          <div className="step-list">
            {(job.steps ?? []).length === 0 ? (
              <div className="muted">No detailed steps available yet.</div>
            ) : (
              (job.steps ?? []).map((step, idx) => (
                <div key={idx} className="step-item">
                  <div className="step-info">
                    <div className={`step-dot ${step.status}`} />
                    <strong>{step.name}</strong>
                  </div>
                  <div className="step-time">
                    {step.status === 'running' ? (
                      'Processing...'
                    ) : step.finishedAt && step.startedAt ? (
                      `${((new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime()) / 1000).toFixed(1)}s`
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {job.summaryMarkdown && (
        <div className="panel">
          <h2>Summary</h2>
          <div className="code-block" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
            {job.summaryMarkdown}
          </div>
        </div>
      )}

      <div className="stack">
        <div className="section-header">
          <h2>File reviews ({job.files.length})</h2>
          {job.status === 'running' && <span className="pulsing-dot"></span>}
        </div>

        {job.files.length === 0 ? (
          <div className="panel muted" style={{ textAlign: 'center', padding: '40px' }}>
            No files reviewed yet.
          </div>
        ) : (
          job.files.map((file) => (
            <details key={file.id} className="panel">
              <summary className="summary-row">
                <span style={{ fontWeight: 600 }}>{file.filePath}</span>
                <span className="summary-meta">
                  <StatusBadge label={file.fileStatus} />
                  <StatusBadge label={file.verdict ?? 'comment'} />
                </span>
              </summary>

              <div className="grid two" style={{ marginTop: '20px' }}>
                <div>
                  <h3>Prompt / diff</h3>
                  <pre className="code-block" style={{ fontSize: '0.75rem', maxHeight: '300px' }}>
                    {file.diffInput ?? 'No prompt saved.'}
                  </pre>
                </div>
                <div>
                  <h3>Raw model output</h3>
                  <pre className="code-block" style={{ fontSize: '0.75rem', maxHeight: '300px' }}>
                    {file.rawAiOutput ?? 'No raw output saved.'}
                  </pre>
                </div>
              </div>

              <div className="comments-list" style={{ marginTop: '20px' }}>
                <h4 style={{ marginBottom: '12px' }}>Inline comments ({file.parsedComments.length})</h4>
                {file.parsedComments.map((comment, index) => (
                  <article key={`${file.id}-${index}`} className="comment-card">
                    <div className="comment-header">
                      <span className="comment-title">{comment.title}</span>
                      <span className={`severity-tag ${comment.severity}`}>{comment.severity}</span>
                    </div>
                    <div className="muted" style={{ fontSize: '0.85rem', marginBottom: '8px' }}>
                      {comment.category} • line {comment.line ?? 'n/a'}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{comment.body}</div>
                    {comment.codeSuggestion && (
                      <div style={{ marginTop: '12px' }}>
                        <div className="eyebrow" style={{ marginBottom: '4px' }}>
                          Suggestion
                        </div>
                        <pre className="code-block" style={{ fontSize: '0.8rem' }}>
                          {comment.codeSuggestion}
                        </pre>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </details>
          ))
        )}
      </div>
    </section>
  );
}
