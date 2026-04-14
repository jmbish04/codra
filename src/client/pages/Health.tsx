import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@client/lib/api';
import { StatusBadge } from '@client/components/StatusBadge';
import { Button } from '@client/components/ui/button';
import {
  AlertTriangle, RefreshCw, RotateCcw, Trash2,
  CheckCircle2, ShieldAlert, ServerCrash,
} from 'lucide-react';
import { cn } from '@client/lib/utils';
import type { JobSummary } from '@shared/schema';
import type { DlqMessage } from '@shared/api';

/* Tiny health indicator pill */
function HealthPill({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide border',
      )}
      style={ok
        ? { background: 'var(--success-bg)', color: 'var(--success)', borderColor: 'var(--success-border)' }
        : { background: 'var(--danger-bg)',  color: 'var(--danger)',  borderColor: 'var(--danger-border)' }
      }
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: 'currentColor' }}
      />
      {ok ? 'Healthy' : 'Issues'}
    </span>
  );
}

export function HealthPage() {
  const [failedJobs,   setFailedJobs]   = useState<JobSummary[]>([]);
  const [dlqMessages,  setDlqMessages]  = useState<DlqMessage[]>([]);
  const [loadingJobs,  setLoadingJobs]  = useState(true);
  const [loadingDlq,   setLoadingDlq]   = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [processing,   setProcessing]   = useState(false);

  const loadData = async () => {
    setError(null);
    try {
      const [jobsRes, dlqRes] = await Promise.all([
        api.getJobs({ status: 'failed', limit: 50 }),
        api.getDlqMessages(50),
      ]);
      setFailedJobs(jobsRes.jobs);
      setDlqMessages(dlqRes.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load health data.');
    } finally {
      setLoadingJobs(false);
      setLoadingDlq(false);
    }
  };

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 30_000);
    return () => clearInterval(timer);
  }, []);

  const handleReplayDlq = async (leaseIds: string[]) => {
    if (processing) return;
    setProcessing(true);
    try {
      const res = await api.replayDlqMessages(leaseIds);
      alert(`Replayed ${res.replayedCount} message(s).`);
      await loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Replay failed.');
    } finally {
      setProcessing(false);
    }
  };

  const handlePurgeDlq = async (leaseIds: string[]) => {
    if (processing || !confirm('Permanently discard these messages?')) return;
    setProcessing(true);
    try {
      const res = await api.purgeDlqMessages(leaseIds);
      alert(`Purged ${res.purged} message(s).`);
      await loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Purge failed.');
    } finally {
      setProcessing(false);
    }
  };

  const dlqOk     = dlqMessages.length === 0  && !loadingDlq;
  const failedOk  = failedJobs.length  === 0  && !loadingJobs;
  const allOk     = dlqOk && failedOk;

  const thCls = 'px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground';
  const tdCls = 'px-4 py-3.5 text-sm';

  return (
    <section className="page-enter flex flex-col gap-6">

      {/* Header */}
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary/70 mb-1">
            Monitoring
          </p>
          <h1
            className="text-2xl font-bold text-foreground"
            style={{ letterSpacing: '-0.025em' }}
          >
            System health
          </h1>
          <div className="mt-2">
            <HealthPill ok={allOk} />
          </div>
        </div>
        <Button
          id="health-refresh-btn"
          variant="outline"
          size="sm"
          onClick={loadData}
          disabled={loadingJobs || loadingDlq}
          className="gap-2"
        >
          <RefreshCw
            size={13}
            className={(loadingJobs || loadingDlq) ? 'animate-spin' : ''}
          />
          Refresh
        </Button>
      </header>

      {/* Summary strip */}
      <div className="surface grid grid-cols-2 divide-x divide-border">
        {[
          {
            icon: ShieldAlert,
            label: 'Dead Letter Queue',
            count: dlqMessages.length,
            ok: dlqOk,
            loading: loadingDlq,
          },
          {
            icon: ServerCrash,
            label: 'Failed jobs',
            count: failedJobs.length,
            ok: failedOk,
            loading: loadingJobs,
          },
        ].map(({ icon: Icon, label, count, ok, loading }) => (
          <div key={label} className="flex items-center gap-4 px-6 py-4">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0"
              style={ok
                ? { background: 'var(--success-bg)', color: 'var(--success)' }
                : { background: 'var(--danger-bg)',  color: 'var(--danger)' }
              }
            >
              {ok
                ? <CheckCircle2 size={18} strokeWidth={2} />
                : <Icon size={18} strokeWidth={2} />
              }
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">{label}</p>
              <p className="text-xl font-bold text-foreground mt-0.5" style={{ letterSpacing: '-0.03em' }}>
                {loading ? '—' : count}
              </p>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div
          className="rounded-md border px-4 py-3 text-sm"
          style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-border)', color: 'var(--danger)' }}
        >
          {error}
        </div>
      )}

      {/* ── DLQ section ── */}
      <div className="surface overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <ShieldAlert
              size={14}
              strokeWidth={1.75}
              style={{ color: dlqMessages.length > 0 ? 'var(--warning)' : 'var(--muted-foreground)' }}
            />
            <span className="text-sm font-semibold text-foreground">Dead Letter Queue</span>
            {dlqMessages.length > 0 && (
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}
              >
                {dlqMessages.length}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline" size="sm"
              onClick={() => handleReplayDlq(dlqMessages.map((m) => m.lease_id))}
              disabled={processing || dlqMessages.length === 0}
              className="h-7 px-2.5 text-xs gap-1.5"
            >
              <RotateCcw size={11} /> Replay all
            </Button>
            <Button
              variant="destructive" size="sm"
              onClick={() => handlePurgeDlq(dlqMessages.map((m) => m.lease_id))}
              disabled={processing || dlqMessages.length === 0}
              className="h-7 px-2.5 text-xs gap-1.5"
            >
              <Trash2 size={11} /> Purge all
            </Button>
          </div>
        </div>
        <p className="px-5 py-2.5 text-xs text-muted-foreground border-b border-border/50">
          Messages that exhausted all retry attempts and are parked for manual action.
        </p>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className={thCls}>Timestamp</th>
              <th className={thCls}>Attempts</th>
              <th className={thCls}>Payload</th>
              <th className={thCls}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loadingDlq ? (
              <tr><td colSpan={4} className={`${tdCls} text-center text-muted-foreground`}>Loading…</td></tr>
            ) : dlqMessages.length === 0 ? (
              <tr>
                <td colSpan={4} className={`${tdCls} py-8 text-center text-muted-foreground`}>
                  <div className="flex flex-col items-center gap-2">
                    <CheckCircle2 size={22} style={{ color: 'var(--success)' }} strokeWidth={1.5} />
                    DLQ is empty — no failed messages.
                  </div>
                </td>
              </tr>
            ) : (
              dlqMessages.map((msg) => (
                <tr key={msg.lease_id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                  <td className={`${tdCls} whitespace-nowrap font-mono text-xs text-muted-foreground`}>
                    {new Date(msg.metadata.timestamp).toLocaleString()}
                  </td>
                  <td className={tdCls}>
                    <span
                      className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold"
                      style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}
                    >
                      {msg.metadata.attempts}×
                    </span>
                  </td>
                  <td className={`${tdCls} max-w-xs`}>
                    <pre className="rounded bg-muted/50 p-2 text-[11px] overflow-hidden text-muted-foreground font-mono leading-relaxed max-h-24">
                      {JSON.stringify(msg.body, null, 2)}
                    </pre>
                  </td>
                  <td className={tdCls}>
                    <div className="flex gap-1.5">
                      <Button
                        variant="outline" size="sm"
                        onClick={() => handleReplayDlq([msg.lease_id])}
                        disabled={processing}
                        className="h-7 px-2 text-xs gap-1"
                      >
                        <RotateCcw size={10} /> Replay
                      </Button>
                      <Button
                        variant="destructive" size="sm"
                        onClick={() => handlePurgeDlq([msg.lease_id])}
                        disabled={processing}
                        className="h-7 px-2 text-xs gap-1"
                      >
                        <Trash2 size={10} /> Purge
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Failed jobs section ── */}
      <div className="surface overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border">
          <ServerCrash
            size={14}
            strokeWidth={1.75}
            style={{ color: failedJobs.length > 0 ? 'var(--danger)' : 'var(--muted-foreground)' }}
          />
          <span className="text-sm font-semibold text-foreground">Failed jobs</span>
          {failedJobs.length > 0 && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold"
              style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}
            >
              {failedJobs.length}
            </span>
          )}
        </div>
        <p className="px-5 py-2.5 text-xs text-muted-foreground border-b border-border/50">
          Review jobs that encountered errors during execution.
        </p>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className={thCls}>Repository</th>
              <th className={thCls}>PR</th>
              <th className={thCls}>Status</th>
              <th className={thCls}>Error</th>
              <th className={thCls}>Finished</th>
              <th className={thCls} />
            </tr>
          </thead>
          <tbody>
            {loadingJobs ? (
              <tr><td colSpan={6} className={`${tdCls} text-center text-muted-foreground`}>Loading…</td></tr>
            ) : failedJobs.length === 0 ? (
              <tr>
                <td colSpan={6} className={`${tdCls} py-8 text-center text-muted-foreground`}>
                  <div className="flex flex-col items-center gap-2">
                    <CheckCircle2 size={22} style={{ color: 'var(--success)' }} strokeWidth={1.5} />
                    No failed jobs found.
                  </div>
                </td>
              </tr>
            ) : (
              failedJobs.map((job) => (
                <tr key={job.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                  <td className={tdCls}>
                    <Link to={`/jobs/${job.id}`} className="font-semibold text-primary hover:underline underline-offset-2">
                      {job.owner}/{job.repo}
                    </Link>
                  </td>
                  <td className={`${tdCls} font-mono text-xs text-muted-foreground`}>#{job.prNumber}</td>
                  <td className={tdCls}><StatusBadge label={job.status} /></td>
                  <td className={`${tdCls} max-w-[220px]`}>
                    <p
                      className="text-xs break-words leading-relaxed line-clamp-2"
                      style={{ color: 'var(--danger)' }}
                    >
                      {job.errorMessage || 'Unknown error'}
                    </p>
                  </td>
                  <td className={`${tdCls} whitespace-nowrap text-xs text-muted-foreground`}>
                    {job.finishedAt ? new Date(job.finishedAt).toLocaleString() : '—'}
                  </td>
                  <td className={tdCls}>
                    <Button variant="outline" size="sm" asChild className="h-7 px-2.5 text-xs">
                      <Link to={`/jobs/${job.id}`}>Details</Link>
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
