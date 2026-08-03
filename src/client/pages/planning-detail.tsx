import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type PlanningPackageDetailResponse, type FullRevision, type PackageTask } from '@client/lib/api';
import { PageHeader } from '@client/components/layout/page-header';
import { Badge } from '@client/components/ui/badge';
import { Button } from '@client/components/ui/button';
import { Alert } from '@client/components/ui/alert';
import { formatDateTime } from '@client/lib/format';
import { Play, ExternalLink } from 'lucide-react';

const TASK_STATES = ['pending', 'in_progress', 'in_review', 'blocked', 'deferred', 'done'];

export function PlanningDetailPage() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<PlanningPackageDetailResponse | null>(null);
  const [revNum, setRevNum] = useState<number | null>(null);
  const [rev, setRev] = useState<FullRevision | null>(null);
  const [tasks, setTasks] = useState<PackageTask[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.getPlanningPackage(id)
    .then((d) => {
      setDetail(d); setTasks(d.tasks); setError(null);
      const latest = d.revisions[d.revisions.length - 1];
      if (latest && revNum == null) setRevNum(latest.revision_number);
    })
    .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load package.'));

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);
  useEffect(() => {
    if (revNum == null) { setRev(null); return; }
    let live = true;
    api.getPlanningRevision(id, revNum).then((r) => { if (live) setRev(r.revision); }).catch(() => { if (live) setRev(null); });
    return () => { live = false; };
  }, [id, revNum]);

  const orchestrate = async () => {
    setError(null);
    try { await api.orchestratePlanningPackage(id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to start Jules.'); }
  };

  const setTask = async (taskKey: string, patch: { status?: string; assignee?: string | null }) => {
    setTasks((ts) => ts.map((t) => t.task_key === taskKey ? { ...t, ...('status' in patch ? { status: patch.status! } : {}), ...('assignee' in patch ? { assignee: patch.assignee ?? null } : {}) } : t));
    try { await api.updatePlanningTask(id, taskKey, patch); } catch { load(); }
  };

  if (error && !detail) return <Alert variant="destructive">{error}</Alert>;
  if (!detail) return <div className="h-40" role="status" aria-busy="true" />;
  const pkg = detail.package;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        category={pkg.repository ?? 'Planning'}
        title={pkg.title}
        description={`Created ${formatDateTime(pkg.created_at)}`}
        actions={<Button onClick={orchestrate} className="gap-1.5"><Play className="h-4 w-4" />Run Jules</Button>}
      />
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="info">{pkg.status.replace(/_/g, ' ')}</Badge>
        <span className="text-muted-foreground">{detail.revisions.length} revision(s)</span>
      </div>

      {/* Revision history selector */}
      {detail.revisions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {detail.revisions.map((r) => (
            <button
              key={r.id}
              onClick={() => setRevNum(r.revision_number)}
              className={`rounded-md border px-2.5 py-1 text-xs ${revNum === r.revision_number ? 'border-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'}`}
              title={`${r.source} · ${r.status}`}
            >
              rev {r.revision_number} · {r.source}
            </button>
          ))}
        </div>
      )}

      {/* Live task board (survives revisions) */}
      {tasks.length > 0 && (
        <section className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2 text-sm font-semibold">Tasks</div>
          <div className="divide-y divide-border">
            {tasks.map((t) => (
              <div key={t.task_key} className="flex items-center justify-between gap-3 px-4 py-2">
                <div className="min-w-0 text-sm"><span className="font-mono text-xs text-muted-foreground">{t.task_key}</span></div>
                <div className="flex items-center gap-2">
                  <input
                    defaultValue={t.assignee ?? ''}
                    onBlur={(e) => e.target.value !== (t.assignee ?? '') && setTask(t.task_key, { assignee: e.target.value || null })}
                    placeholder="assignee"
                    className="w-28 rounded border border-border bg-background px-2 py-1 text-xs"
                  />
                  <select value={t.status} onChange={(e) => setTask(t.task_key, { status: e.target.value })} className="rounded border border-border bg-background px-2 py-1 text-xs">
                    {TASK_STATES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Selected revision detail */}
      {rev && (
        <div className="flex flex-col gap-4">
          {rev.summary && <Prose label="Summary" text={rev.summary} />}
          {rev.problem && <Prose label="Problem" text={rev.problem} />}
          {rev.approach && <Prose label="Approach" text={rev.approach} />}

          {rev.changeItems.length > 0 && (
            <Section title="Preview change list">
              <ul className="space-y-1 text-sm">
                {rev.changeItems.map((c) => <li key={c.id}><span className="mr-2 font-mono text-xs text-muted-foreground">{c.kind}</span>{c.text}</li>)}
              </ul>
            </Section>
          )}

          {rev.codeCards.length > 0 && (
            <Section title="Code">
              {rev.codeCards.map((c) => (
                <div key={c.id} className="mb-3">
                  <div className="mb-1 text-xs text-muted-foreground">{c.file_path ?? c.intent ?? c.language ?? 'snippet'}</div>
                  <pre className="overflow-x-auto rounded bg-muted/50 p-3 text-xs"><code>{c.content}</code></pre>
                </div>
              ))}
            </Section>
          )}

          {rev.apiChanges.length > 0 && (
            <Section title="API changes">
              <ul className="space-y-1 text-sm font-mono text-xs">
                {rev.apiChanges.map((a) => <li key={a.id}>{a.method} {a.path}{a.description ? ` — ${a.description}` : ''}</li>)}
              </ul>
            </Section>
          )}

          {rev.migrations.length > 0 && (
            <Section title="Migrations">
              {rev.migrations.map((m) => (
                <pre key={m.id} className="mb-2 overflow-x-auto rounded bg-muted/50 p-3 text-xs"><code>{m.sql}</code></pre>
              ))}
            </Section>
          )}

          {rev.verification && <Prose label="Verification" text={rev.verification} />}

          {rev.context_r2_key && (
            <a href={`/api/planning-packages/${id}/context?rev=${rev.revision_number}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-500 hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> Raw Jules transcript ({rev.context_bytes ?? 0} bytes)
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border">
      <div className="border-b border-border px-4 py-2 text-sm font-semibold">{title}</div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}
function Prose({ label, text }: { label: string; text: string }) {
  return (
    <section>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <p className="whitespace-pre-wrap text-sm">{text}</p>
    </section>
  );
}
