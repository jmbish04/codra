import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, Search, TriangleAlert, Wifi, WifiOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@client/components/ui/card';
import { Input } from '@client/components/ui/input';
import { Select } from '@client/components/ui/select';
import { PageHeader } from '@client/components/layout/page-header';
import { JulesSessionList, SessionsLoadError } from '@client/components/features/jules-monitoring/session-list';
import {
  julesMonitoringClient,
  type JulesMonitorStatus,
  type JulesMonitorSummary,
  type JulesMonitorTask,
} from '@client/components/features/jules-monitoring/client';

const REFRESH_MS = 30_000;
const statusOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'pr_ready', label: 'PR ready' },
  { value: 'stuck', label: 'Stuck' },
  { value: 'failed', label: 'Failed' },
];

/**
 * SummaryCard
 */
function SummaryCard({ label, value, icon: Icon, tone = 'default' }: { label: string; value: number | string; icon: React.ElementType; tone?: 'default' | 'danger' | 'success' }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle><Icon className={`h-4 w-4 ${tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-primary'}`} /></CardHeader>
      <CardContent><div className="text-2xl font-bold tracking-tight text-foreground">{value}</div></CardContent>
    </Card>
  );
}

/**
 * JulesMonitorPage
 */
export function JulesMonitorPage() {
  const [tasks, setTasks] = useState<JulesMonitorTask[]>([]);
  const [summary, setSummary] = useState<JulesMonitorSummary | null>(null);
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const response = await julesMonitoringClient.listTasks({
        status: status as JulesMonitorStatus | 'active' | 'all',
        query: debouncedQuery || undefined,
      });
      setTasks(response.tasks);
      setSummary(response.summary);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Jules monitor could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [status, debouncedQuery]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(true); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const watcherOnline = summary?.health.watcher.state === 'online';
  const watcherLabel = useMemo(() => {
    if (!summary) return 'Unknown';
    return summary.health.watcher.state === 'online' ? 'Online' : summary.health.watcher.state === 'stale' ? 'Stale' : 'Offline';
  }, [summary]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Session monitor"
        description="See where every Jules task needs attention."
      />

      <section aria-label="Jules monitor summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Active sessions" value={summary?.active ?? '—'} icon={Activity} />
        <SummaryCard label="Needs attention" value={summary?.needsAttention ?? '—'} icon={TriangleAlert} tone="danger" />
        <SummaryCard label="Accepted plans" value={summary?.accepted ?? '—'} icon={CheckCircle2} tone="success" />
        <SummaryCard label="Watcher" value={watcherLabel} icon={watcherOnline ? Wifi : WifiOff} tone={watcherOnline ? 'success' : 'default'} />
      </section>

      <section aria-labelledby="sessions-heading" className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h2 id="sessions-heading" className="text-lg font-semibold text-foreground">Sessions</h2>
          <div className="grid gap-3 sm:grid-cols-[minmax(14rem,1fr)_11rem]">
            <label className="relative block"><span className="sr-only">Search sessions</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search package or repo" className="h-9 pl-9" /></label>
            <Select value={status} onValueChange={setStatus} options={statusOptions} variant="page" />
          </div>
        </div>

        {error && tasks.length === 0 ? <SessionsLoadError message={error} onRetry={() => void load()} /> : <JulesSessionList tasks={tasks} loading={loading} onRetry={() => void load()} />}
        {error && tasks.length > 0 && <p role="status" className="text-xs text-warning">Showing the last loaded data. Refresh failed: {error}</p>}
      </section>
    </div>
  );
}

export default JulesMonitorPage;
