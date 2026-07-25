import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

type Target = {
  kind: string;
  method: string | null;
  target: string;
  reason: string | null;
  status: string;
  statusCode: number | null;
  result: any;
  screenshotUrl: string | null;
  error: string | null;
};
type Report = { jobId: string; repo: string; prNumber: number; targetCount: number; targets: Target[] };

const STATUS_STYLE: Record<string, string> = {
  passed: 'text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900/40',
  failed: 'text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/40',
  blocked_auth: 'text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/40',
  skipped: 'text-zinc-600 bg-zinc-100 dark:text-zinc-300 dark:bg-zinc-800',
  error: 'text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/40',
  pending: 'text-zinc-600 bg-zinc-100 dark:text-zinc-300 dark:bg-zinc-800',
};

export function TestReportPage() {
  const { jobId } = useParams();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/reviews/${jobId}/tests.json`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'No test report for this job.' : `Failed (${r.status})`))))
      .then((d) => setReport(d as Report))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [jobId]);

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-10">
      <h1 className="text-xl font-bold">🧪 Codra PR Test Report</h1>
      {report && (
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-mono">{report.repo}</span> · PR #{report.prNumber} · {report.targetCount} target(s)
        </p>
      )}

      {loading && <div className="mt-8 h-40" role="status" aria-busy="true" />}
      {error && <div className="mt-8 rounded-md border border-red-300 bg-red-50 p-4 text-red-700 dark:bg-red-900/20">{error}</div>}

      {report && (
        <div className="mt-6 space-y-3">
          {report.targets.map((t, i) => (
            <div key={i} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-semibold uppercase">{t.kind}</span>
                  <span className="font-mono text-sm">{t.method ? `${t.method} ` : ''}{t.target}</span>
                </div>
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[t.status] ?? STATUS_STYLE.pending}`}>
                  {t.status.replace('_', ' ')}{t.statusCode ? ` · ${t.statusCode}` : ''}
                </span>
              </div>
              {t.reason && <p className="mt-1 text-sm text-muted-foreground">{t.reason}</p>}
              {t.error && <p className="mt-1 text-sm text-red-600">{t.error}</p>}
              {t.screenshotUrl && (
                <a href={t.screenshotUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block">
                  <img src={t.screenshotUrl} alt="page screenshot" className="max-h-96 w-full rounded border border-border object-contain" />
                </a>
              )}
              {t.result?.bodySample && (
                <pre className="mt-2 max-h-56 overflow-auto rounded bg-secondary/60 p-2 text-xs">{typeof t.result.bodySample === 'string' ? t.result.bodySample : JSON.stringify(t.result.bodySample, null, 2)}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default TestReportPage;
