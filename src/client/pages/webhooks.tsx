import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@client/lib/api';
import { Button } from '@client/components/ui/button';
import { Badge } from '@client/components/ui/badge';
import { Alert } from '@client/components/ui/alert';
import { PageHeader } from '@client/components/layout/page-header';
import { EmptyState } from '@client/components/shared/empty-state';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@client/components/ui/dialog';
import { formatDateTime, formatNumber } from '@client/lib/format';
import { JsonViewer } from '@client/components/json-viewer';
import { Webhook, RefreshCw, DownloadCloud, ChevronLeft, ChevronRight, Inbox, X } from 'lucide-react';
import type { WebhookDeliverySummary, WebhookOutcomeStat, WebhookRepoRef } from '@shared/api';

function outcomeVariant(outcome: string): 'success' | 'neutral' | 'danger' | 'secondary' {
  if (['job_created', 'kb_updated', 'queued'].includes(outcome)) return 'success';
  if (['rejected_signature', 'invalid_payload', 'error'].includes(outcome)) return 'danger';
  if (outcome === 'duplicate' || outcome === 'review_cancelled') return 'secondary';
  return 'neutral';
}
const outcomeLabel = (o: string) => o.replace(/_/g, ' ');
const BAR_COLOR: Record<ReturnType<typeof outcomeVariant>, string> = {
  success: 'bg-success', neutral: 'bg-muted-foreground/50', danger: 'bg-danger', secondary: 'bg-primary/50',
};

const TIME_RANGES: { key: string; label: string; hours: number | null }[] = [
  { key: '24h', label: 'Last 24h', hours: 24 },
  { key: '7d', label: 'Last 7 days', hours: 24 * 7 },
  { key: '4w', label: 'Last 4 weeks', hours: 24 * 28 },
  { key: 'all', label: 'All time', hours: null },
];

const LIMIT = 50;

export function WebhooksPage() {
  const [items, setItems] = useState<WebhookDeliverySummary[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<WebhookOutcomeStat[]>([]);
  const [repoOptions, setRepoOptions] = useState<WebhookRepoRef[]>([]);

  const [outcome, setOutcome] = useState('');
  const [rangeKey, setRangeKey] = useState('7d');
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<(WebhookDeliverySummary & { payload: unknown }) | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncLog, setSyncLog] = useState<string[]>([]);

  const since = useMemo(() => {
    const hours = TIME_RANGES.find((r) => r.key === rangeKey)?.hours;
    if (!hours) return undefined;
    return new Date(Date.now() - hours * 3600_000).toISOString();
  }, [rangeKey]);

  const reposParam = selectedRepos.length ? selectedRepos.join(',') : undefined;

  const load = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const [list, st] = await Promise.all([
        api.getWebhooks({ outcome: outcome || undefined, since, repos: reposParam, limit: LIMIT, offset: (page - 1) * LIMIT }),
        api.getWebhookStats({ since, repos: reposParam }),
      ]);
      setItems(list.items);
      setTotal(list.total);
      setStats(st.stats.slice().sort((a, b) => b.count - a.count));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load webhooks.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [outcome, since, reposParam, page]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api.getWebhookRepos().then((r) => setRepoOptions(r.repos)).catch(() => {}); }, []);

  const openDetail = async (id: string) => {
    try {
      const res = await api.getWebhook(id);
      setSelected(res.delivery);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load delivery.');
    }
  };

  const runSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncLog(['Starting sync…']);
    try {
      const res = await fetch('/api/webhooks/sync', {
        method: 'POST',
        headers: { 'x-requested-with': 'XMLHttpRequest' },
        credentials: 'same-origin',
      });
      if (!res.ok || !res.body) throw new Error(`Sync failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let totalEnqueued = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          if (evt.type === 'summary') { totalEnqueued = evt.totalEnqueued; continue; }
          if (evt.message) setSyncLog((prev) => [...prev, evt.message]);
        }
      }
      toast.success(totalEnqueued > 0 ? `Queued ${formatNumber(totalEnqueued)} review(s).` : 'Nothing new to queue — all caught up.');
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sync failed.';
      setSyncLog((prev) => [...prev, `Error: ${msg}`]);
      toast.error(msg);
    } finally {
      setSyncing(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const maxStat = Math.max(1, ...stats.map((s) => s.count));

  const toggleRepo = (repo: string) => {
    setPage(1);
    setSelectedRepos((prev) => (prev.includes(repo) ? prev.filter((r) => r !== repo) : [...prev, repo]));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        category="Observability"
        title="Webhooks"
        description="Every GitHub webhook delivery and what codra did with it."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => load(true)} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button onClick={runSync} disabled={syncing}>
              <DownloadCloud className={`h-4 w-4 ${syncing ? 'animate-pulse' : ''}`} />
              {syncing ? 'Syncing…' : 'Sync open PRs'}
            </Button>
          </div>
        }
      />

      {error && <Alert variant="destructive">{error}</Alert>}

      {/* Live sync progress */}
      {(syncing || syncLog.length > 0) && (
        <div className="rounded-lg border border-border bg-secondary/30 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            {syncing && <RefreshCw className="h-4 w-4 animate-spin" />}
            {syncing ? 'Syncing open PRs…' : 'Sync complete'}
            {!syncing && (
              <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setSyncLog([])} aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="max-h-40 overflow-auto font-mono text-xs text-muted-foreground">
            {syncLog.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}

      {/* Outcome chart */}
      <div className="rounded-lg border border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Deliveries by outcome</h2>
          <span className="text-sm text-muted-foreground">{formatNumber(total)} in view</span>
        </div>
        {stats.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deliveries in this window.</p>
        ) : (
          <div className="space-y-1.5">
            {stats.map((s) => {
              const variant = outcomeVariant(s.outcome);
              const active = outcome === s.outcome;
              return (
                <button
                  key={s.outcome}
                  onClick={() => { setPage(1); setOutcome(active ? '' : s.outcome); }}
                  className={`flex w-full items-center gap-3 rounded px-2 py-1 text-left transition-colors hover:bg-secondary/50 ${active ? 'bg-secondary' : ''}`}
                  title={active ? 'Clear filter' : `Filter by ${outcomeLabel(s.outcome)}`}
                >
                  <span className="w-40 shrink-0 text-xs">{outcomeLabel(s.outcome)}</span>
                  <span className="h-4 flex-1 overflow-hidden rounded bg-secondary/40">
                    <span className={`block h-full ${BAR_COLOR[variant]}`} style={{ width: `${(s.count / maxStat) * 100}%` }} />
                  </span>
                  <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums">{formatNumber(s.count)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          {TIME_RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => { setPage(1); setRangeKey(r.key); }}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${rangeKey === r.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {outcome && (
          <Badge variant={outcomeVariant(outcome)} className="cursor-pointer" onClick={() => setOutcome('')}>
            {outcomeLabel(outcome)} <X className="ml-1 inline h-3 w-3" />
          </Badge>
        )}
        {repoOptions.length > 0 && (
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary">
              Repos {selectedRepos.length > 0 ? `(${selectedRepos.length})` : ''}
            </summary>
            <div className="absolute z-10 mt-1 max-h-64 w-64 overflow-auto rounded-md border border-border bg-card p-2 shadow-lg">
              {repoOptions.map((r) => (
                <label key={`${r.owner}/${r.repo}`} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-secondary">
                  <input type="checkbox" checked={selectedRepos.includes(r.repo)} onChange={() => toggleRepo(r.repo)} />
                  <span className="truncate">{r.owner}/{r.repo}</span>
                </label>
              ))}
            </div>
          </details>
        )}
        {selectedRepos.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => { setPage(1); setSelectedRepos([]); }}>Clear repos</Button>
        )}
      </div>

      {loading ? (
        <div className="h-40" role="status" aria-busy="true" />
      ) : items.length === 0 ? (
        <EmptyState icon={<Inbox className="h-6 w-6" />} title="No webhook deliveries" description="Nothing matches these filters." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Event</th>
                <th className="px-4 py-2 font-medium">Repository</th>
                <th className="px-4 py-2 font-medium">Outcome</th>
                <th className="px-4 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} onClick={() => openDetail(d.id)} className="cursor-pointer border-t border-border/60 hover:bg-secondary/40">
                  <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{formatDateTime(d.received_at)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{d.event_name}</td>
                  <td className="px-4 py-2">{d.owner && d.repo ? `${d.owner}/${d.repo}` : '—'}</td>
                  <td className="px-4 py-2"><Badge variant={outcomeVariant(d.outcome)}>{outcomeLabel(d.outcome)}</Badge></td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {d.job_id && d.pr_number ? (
                      <Link to={`/jobs/${d.job_id}`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">
                        PR #{formatNumber(d.pr_number)} → job
                      </Link>
                    ) : d.error ? <span className="text-danger">{d.error}</span> : d.action ? d.action : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /> Prev</Button>
          <span className="text-sm text-muted-foreground">Page {formatNumber(page)} of {formatNumber(totalPages)}</span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight className="h-4 w-4" /></Button>
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Webhook className="h-4 w-4" />
                  {selected.event_name}
                  <Badge variant={outcomeVariant(selected.outcome)}>{outcomeLabel(selected.outcome)}</Badge>
                </DialogTitle>
                <DialogDescription>
                  {selected.owner && selected.repo ? `${selected.owner}/${selected.repo} · ` : ''}
                  {formatDateTime(selected.received_at)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                {selected.job_id && selected.pr_number && (
                  <Link to={`/jobs/${selected.job_id}`} className="text-primary hover:underline">
                    View review job for PR #{formatNumber(selected.pr_number)}
                  </Link>
                )}
                {selected.error && <Alert variant="destructive">{selected.error}</Alert>}
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payload</p>
                  <div className="max-h-96 overflow-auto rounded-md border border-border">
                    <JsonViewer data={selected.payload as any} rootName="payload" defaultExpanded={2} />
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default WebhooksPage;
