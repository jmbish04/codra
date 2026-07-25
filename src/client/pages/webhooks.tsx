import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@client/lib/api';
import { Button } from '@client/components/ui/button';
import { Badge } from '@client/components/ui/badge';
import { Select } from '@client/components/ui/select';
import { Alert } from '@client/components/ui/alert';
import { PageHeader } from '@client/components/layout/page-header';
import { EmptyState } from '@client/components/shared/empty-state';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@client/components/ui/dialog';
import { Webhook, RefreshCw, DownloadCloud, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import type { WebhookDeliverySummary } from '@shared/api';

const OUTCOME_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All outcomes' },
  { value: 'job_created', label: 'Job created' },
  { value: 'queued', label: 'Queued' },
  { value: 'kb_updated', label: 'KB updated' },
  { value: 'no_action', label: 'No action' },
  { value: 'ignored_unsupported_event', label: 'Ignored: unsupported event' },
  { value: 'ignored_repo_disabled', label: 'Ignored: repo disabled' },
  { value: 'ignored_no_installation', label: 'Ignored: no installation' },
  { value: 'ignored_no_repository', label: 'Ignored: no repository' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'rejected_signature', label: 'Rejected: bad signature' },
  { value: 'invalid_payload', label: 'Invalid payload' },
  { value: 'error', label: 'Error' },
];

// Green = codra acted, gray = received/ignored, red = rejected/failed.
function outcomeVariant(outcome: string): 'success' | 'neutral' | 'danger' | 'secondary' {
  if (['job_created', 'kb_updated', 'queued'].includes(outcome)) return 'success';
  if (['rejected_signature', 'invalid_payload', 'error'].includes(outcome)) return 'danger';
  if (outcome === 'duplicate') return 'secondary';
  return 'neutral'; // no_action, ignored_*, received
}

function outcomeLabel(outcome: string) {
  return outcome.replace(/_/g, ' ');
}

const LIMIT = 50;

export function WebhooksPage() {
  const [items, setItems] = useState<WebhookDeliverySummary[]>([]);
  const [total, setTotal] = useState(0);
  const [outcome, setOutcome] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<(WebhookDeliverySummary & { payload: unknown }) | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await api.getWebhooks({ outcome: outcome || undefined, limit: LIMIT, offset: (page - 1) * LIMIT });
      setItems(res.items);
      setTotal(res.total);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load webhook deliveries.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [outcome, page]);

  useEffect(() => { void load(); }, [load]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await api.getWebhook(id);
      setSelected(res.delivery);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load delivery.');
    } finally {
      setDetailLoading(false);
    }
  };

  const runSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await api.syncOpenPrs();
      const repos = res.repos.length;
      toast.success(
        res.totalEnqueued > 0
          ? `Enqueued ${res.totalEnqueued} review${res.totalEnqueued === 1 ? '' : 's'} across ${repos} repo${repos === 1 ? '' : 's'}.`
          : 'No missing reviews — every open PR already has a job.',
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="space-y-6">
      <PageHeader
        category="Observability"
        title="Webhooks"
        description="Every GitHub webhook delivery and what codra did with it."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => load(true)} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button onClick={runSync} disabled={syncing}>
              <DownloadCloud className={`h-4 w-4 ${syncing ? 'animate-pulse' : ''}`} />
              {syncing ? 'Syncing…' : 'Sync open PRs'}
            </Button>
          </div>
        }
      />

      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="flex items-center gap-3">
        <Select
          label="Outcome"
          value={outcome}
          onValueChange={(v) => { setPage(1); setOutcome(v); }}
          options={OUTCOME_FILTERS}
        />
        <span className="text-sm text-muted-foreground">{total} deliveries</span>
      </div>

      {loading ? (
        <div className="h-40" role="status" aria-busy="true" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-6 w-6" />}
          title="No webhook deliveries yet"
          description="Once GitHub sends codra a webhook, every delivery shows up here with its outcome."
        />
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
                <tr
                  key={d.id}
                  onClick={() => openDetail(d.id)}
                  className="cursor-pointer border-t border-border/60 hover:bg-secondary/40"
                >
                  <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                    {new Date(d.received_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{d.event_name}</td>
                  <td className="px-4 py-2">{d.owner && d.repo ? `${d.owner}/${d.repo}` : '—'}</td>
                  <td className="px-4 py-2">
                    <Badge variant={outcomeVariant(d.outcome)}>{outcomeLabel(d.outcome)}</Badge>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {d.job_id && d.pr_number ? (
                      <Link
                        to={`/jobs/${d.job_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary hover:underline"
                      >
                        PR #{d.pr_number} → job
                      </Link>
                    ) : d.error ? (
                      <span className="text-danger">{d.error}</span>
                    ) : d.action ? (
                      d.action
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
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
                  {new Date(selected.received_at).toLocaleString()}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 text-sm">
                {selected.job_id && selected.pr_number && (
                  <div>
                    <Link to={`/jobs/${selected.job_id}`} className="text-primary hover:underline">
                      View review job for PR #{selected.pr_number}
                    </Link>
                  </div>
                )}
                {selected.error && <Alert variant="destructive">{selected.error}</Alert>}
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payload</p>
                  <pre className="max-h-80 overflow-auto rounded-md bg-secondary/60 p-3 text-xs">
                    {JSON.stringify(selected.payload, null, 2)}
                  </pre>
                </div>
              </div>
            </>
          )}
          {detailLoading && !selected && <div className="h-40" role="status" aria-busy="true" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default WebhooksPage;
