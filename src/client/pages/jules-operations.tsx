import { useEffect, useState } from 'react';
import { api } from '@client/lib/api';
import { Badge, type BadgeProps } from '@client/components/ui/badge';
import { Alert } from '@client/components/ui/alert';
import { PageHeader } from '@client/components/layout/page-header';
import { EmptyState } from '@client/components/shared/empty-state';
import { CopyButton } from '@client/components/ui/copy-button';
import { formatDateTime } from '@client/lib/format';
import { Bot, ExternalLink } from 'lucide-react';
import type { JulesSessionDto } from '@shared/api';

function stateTone(state: JulesSessionDto['state']): NonNullable<BadgeProps['variant']> {
  switch (state) {
    case 'launched': return 'success';
    case 'staged': return 'info';
    case 'skipped': return 'neutral';
    case 'error': return 'danger';
    default: return 'neutral';
  }
}

export function JulesOperationsPage() {
  const [sessions, setSessions] = useState<JulesSessionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getJulesSessions({ limit: 200 })
      .then((res) => { setSessions(res.sessions); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load Jules sessions.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        category="Integrations"
        title="Jules operations"
        description="Every Jules session codra has staged or launched, including the full prompt sent — the complete record of what was sent to Jules."
      />

      {error && <Alert variant="destructive">{error}</Alert>}

      {loading ? (
        <div className="h-40" role="status" aria-busy="true" />
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={<Bot className="h-6 w-6" />}
          title="No Jules sessions yet"
          description="When codra's Docs Gap review step finds documentation gaps and the triggering PR is merged, the staged Jules session will be logged here."
        />
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <div key={s.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant={stateTone(s.state)} className="capitalize">{s.state}</Badge>
                  <span className="font-mono text-sm">{s.owner}/{s.repo}</span>
                  <span className="text-xs text-muted-foreground">triggered by PR #{s.triggering_pr_number}</span>
                </div>
                <span className="text-xs text-muted-foreground">{formatDateTime(s.created_at)}</span>
              </div>

              {s.gap_summary && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">{s.gap_summary}</p>
              )}
              {s.error_msg && <p className="mt-1 text-xs text-destructive">{s.error_msg}</p>}

              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">Prompt sent to Jules</summary>
                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-secondary p-2 text-[11px]">{s.prompt}</pre>
              </details>

              {s.session_id && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <CopyButton value={s.session_id} label="Copy session ID" copiedLabel="Copied" />
                  {s.session_url && s.session_url.startsWith('https://') && (
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
    </div>
  );
}

export default JulesOperationsPage;
