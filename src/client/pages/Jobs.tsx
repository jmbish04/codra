import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@client/lib/api';
import { StatusBadge } from '@client/components/StatusBadge';
import type { JobSummary } from '@shared/schema';

export function JobsPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    status: '',
    verdict: '',
    search: '',
    page: 1,
  });

  const limit = 20;

  useEffect(() => {
    let stopped = false;

    const load = async () => {
      try {
        const response = await api.getJobs({
          status: filters.status || undefined,
          verdict: filters.verdict || undefined,
          search: filters.search || undefined,
          limit,
          offset: (filters.page - 1) * limit,
        });
        if (!stopped) {
          setJobs(response.jobs);
          setTotal(response.total);
          setError(null);
          setLoading(false);
        }
      } catch (loadError) {
        if (!stopped) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load jobs.');
          setLoading(false);
        }
      }
    };

    load();
    const timer = window.setInterval(load, 10_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [filters]);

  const totalPages = Math.ceil(total / limit);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <div className="eyebrow">Overview</div>
          <h1>Recent review jobs</h1>
        </div>
      </header>

      <div className="filters-row">
        <div className="field search">
          <label className="eyebrow">Search PRs</label>
          <input
            type="text"
            placeholder="Title or #number..."
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))}
          />
        </div>
        <div className="field">
          <label className="eyebrow">Status</label>
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value, page: 1 }))}
          >
            <option value="">All Statuses</option>
            <option value="queued">Queued</option>
            <option value="running">Running</option>
            <option value="done">Done</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div className="field">
          <label className="eyebrow">Verdict</label>
          <select
            value={filters.verdict}
            onChange={(e) => setFilters((f) => ({ ...f, verdict: e.target.value, page: 1 }))}
          >
            <option value="">All Verdicts</option>
            <option value="approve">Approved</option>
            <option value="comment">Commented</option>
            <option value="request_changes">Changes Requested</option>
          </select>
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <div className="panel table-panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Repo</th>
              <th>PR</th>
              <th>Trigger</th>
              <th>Status</th>
              <th>Verdict</th>
              <th>Files</th>
              <th>Tokens</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && jobs.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center' }}>Loading jobs...</td></tr>
            ) : jobs.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center' }}>No jobs found matching criteria.</td></tr>
            ) : (
              jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <Link to={`/jobs/${job.id}`}>{job.owner}/{job.repo}</Link>
                  </td>
                  <td>
                    <strong>#{job.prNumber}</strong> {job.prTitle ?? 'Untitled PR'}
                  </td>
                  <td><span className="badge neutral">{job.trigger}</span></td>
                  <td><StatusBadge label={job.status} /></td>
                  <td>{job.verdict ? <StatusBadge label={job.verdict} /> : <span className="muted">—</span>}</td>
                  <td>{job.fileCount}</td>
                  <td>{(job.totalInputTokens + job.totalOutputTokens).toLocaleString()}</td>
                  <td className="muted">{new Date(job.createdAt).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="pagination">
            <button
              className="ghost-button"
              disabled={filters.page === 1}
              onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
            >
              Previous
            </button>
            <span className="muted">Page {filters.page} of {totalPages}</span>
            <button
              className="ghost-button"
              disabled={filters.page === totalPages}
              onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
