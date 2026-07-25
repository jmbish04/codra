import { useEffect, useState } from 'react';
import { api } from '@client/lib/api';
import { Badge } from '@client/components/ui/badge';
import { Alert } from '@client/components/ui/alert';
import { PageHeader } from '@client/components/layout/page-header';
import { EmptyState } from '@client/components/shared/empty-state';
import { formatDateTime } from '@client/lib/format';
import { History, ExternalLink } from 'lucide-react';
import type { AgentAction } from '@shared/api';

export function ActionsPage() {
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAgentActions({ limit: 100 })
      .then((res) => { setActions(res.actions); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load actions.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        category="Observability"
        title="Codra actions"
        description="Every follow-up PR codra opened on its own — what it changed, why, and which PR review triggered it."
      />

      {error && <Alert variant="destructive">{error}</Alert>}

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
