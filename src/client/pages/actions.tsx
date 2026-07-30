import { useEffect, useState } from 'react';
import { api } from '@client/lib/api';
import { Badge } from '@client/components/ui/badge';
import { Alert } from '@client/components/ui/alert';
import { PageHeader } from '@client/components/layout/page-header';
import { EmptyState } from '@client/components/shared/empty-state';
import { CopyButton } from '@client/components/ui/copy-button';
import { formatDateTime } from '@client/lib/format';
import { History, ExternalLink } from 'lucide-react';
import type { AgentAction, JulesSessionDto } from '@shared/api';

export function ActionsPage() {
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jules, setJules] = useState<JulesSessionDto[]>([]);

  useEffect(() => {
    api.getAgentActions({ limit: 100 })
      .then((res) => { setActions(res.actions); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load actions.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.getJulesSessions({ limit: 100 })
      .then((res) => setJules(res.sessions))
      .catch(() => { /* section just stays empty */ });
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        category="Observability"
        title="Codra actions"
        description="Every follow-up PR codra opened on its own — what it changed, why, and which PR review triggered it."
      />

      {error && <Alert variant="destructive">{error}</Alert>}

      {jules.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Jules documentation sessions</h2>
          {jules.map((s) => (
            <div key={s.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant={s.state === 'launched' ? 'default' : 'secondary'}>{s.state}</Badge>
                  <span className="font-mono text-sm">{s.owner}/{s.repo}</span>
                  <span className="text-xs text-muted-foreground">triggered by PR #{s.triggering_pr_number}</span>
                </div>
                <span className="text-xs text-muted-foreground">{formatDateTime(s.created_at)}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">{s.gap_summary}</p>
              {s.error_msg && <p className="mt-1 text-xs text-destructive">{s.error_msg}</p>}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">Prompt sent to Jules</summary>
                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-secondary p-2 text-[11px]">{s.prompt}</pre>
              </details>
              {s.session_id && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <CopyButton value={s.session_id} label="Copy session ID" copiedLabel="Copied" />
                  {s.session_url && (
                    <a href={s.session_url} target="_blank" rel="noopener noreferrer"
                       className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                      Open in Jules <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="h-40" role="status" aria-busy="true" />
      ) : actions.length === 0 ? (
        <EmptyState
          icon={<History className="h-6 w-6" />}
          title="No actions yet"
          description="When codra opens a standardization or improvement PR during a review, it will be logged here."
        />
      ) : (
        <div className="space-y-3">
          {actions.map((a) => (
            <div key={a.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{a.action_type}</Badge>
                  <span className="font-mono text-sm">{a.owner}/{a.repo}</span>
                  {a.triggering_pr_number != null && (
                    <span className="text-xs text-muted-foreground">triggered by PR #{a.triggering_pr_number}</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">{formatDateTime(a.created_at)}</span>
              </div>

              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">{a.summary}</p>

              {a.files.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {a.files.map((f) => (
                    <li key={f} className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{f}</li>
                  ))}
                </ul>
              )}

              {a.pr_url && a.pr_number != null && (
                <a href={a.pr_url} target="_blank" rel="noopener noreferrer"
                   className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline">
                  Opened PR #{a.pr_number} <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ActionsPage;
