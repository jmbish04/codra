import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@client/lib/api';
import { Badge, type BadgeProps } from '@client/components/ui/badge';
import { Alert } from '@client/components/ui/alert';
import { PageHeader } from '@client/components/layout/page-header';
import { EmptyState } from '@client/components/shared/empty-state';
import { CopyButton } from '@client/components/ui/copy-button';
import { formatDateTime } from '@client/lib/format';
import { Bot, ExternalLink, GitPullRequest, RefreshCw } from 'lucide-react';
import type { JulesSessionDto, JulesSessionLiveDto } from '@shared/api';

const LIVE_POLL_MS = 15000;
const TERMINAL_LIVE_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

function stateTone(state: JulesSessionDto['state']): NonNullable<BadgeProps['variant']> {
  switch (state) {
    case 'launched': return 'success';
    case 'staged': return 'info';
    case 'skipped': return 'neutral';
    case 'error': return 'danger';
    default: return 'neutral';
  }
}

function liveTone(sessionState: string | null): NonNullable<BadgeProps['variant']> {
  const s = (sessionState ?? '').toUpperCase();
  if (s === 'COMPLETED') return 'success';
  if (s === 'FAILED' || s === 'CANCELLED') return 'danger';
  if (s === '') return 'neutral';
  return 'info'; // QUEUED / PLANNING / IN_PROGRESS / AWAITING_*
}

function prettyLiveState(sessionState: string | null): string {
  if (!sessionState) return 'unknown';
  return sessionState.replace(/_/g, ' ').toLowerCase();
}

function isNonTerminal(live: JulesSessionLiveDto): boolean {
  return live.live && !TERMINAL_LIVE_STATES.has((live.sessionState ?? '').toUpperCase());
}

export function JulesOperationsPage() {
  const [sessions, setSessions] = useState<JulesSessionDto[]>([]);
  const [live, setLive] = useState<Record<string, JulesSessionLiveDto>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;
  // Guard against setState after the page unmounts (fetches are fire-and-forget).
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    api.getJulesSessions({ limit: 200 })
      .then((res) => { if (mountedRef.current) { setSessions(res.sessions); setError(null); } })
      .catch((e) => { if (mountedRef.current) setError(e instanceof Error ? e.message : 'Failed to load Jules sessions.'); })
      .finally(() => { if (mountedRef.current) setLoading(false); });
  }, []);

  // Realtime: query Jules (server-side) for each launched session's current
  // state. Best-effort per session so one failure never blanks the others.
  const refreshLive = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    setRefreshing(true);
    const results = await Promise.allSettled(ids.map((id) => api.getJulesSessionLive(id)));
    if (!mountedRef.current) return;
    setLive((prev) => {
      // Rebuild from the ids currently being polled so entries for sessions that
      // are no longer launched are dropped (the map can't grow unbounded).
      const next: Record<string, JulesSessionLiveDto> = {};
      for (const id of ids) if (prev[id]) next[id] = prev[id];
      results.forEach((r, i) => { if (r.status === 'fulfilled') next[ids[i]] = r.value; });
      return next;
    });
    setRefreshing(false);
  }, []);

  const launchedIds = sessions.filter((s) => s.state === 'launched' && s.session_id).map((s) => s.id);
  // Sorted so a mere reorder of `sessions` doesn't tear down and rebuild the poll.
  const launchedKey = [...launchedIds].sort().join(',');

  useEffect(() => {
    if (launchedIds.length === 0) return;
    void refreshLive(launchedIds);
    const timer = setInterval(() => {
      // Stop hitting Jules once every launched session has reached a terminal
      // state; keep polling while any is still running.
      const anyRunning = launchedIds.some((id) => {
        const l = liveRef.current[id];
        return !l || isNonTerminal(l);
      });
      if (anyRunning) void refreshLive(launchedIds);
    }, LIVE_POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchedKey, refreshLive]);

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
          {launchedIds.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Live status refreshes every {LIVE_POLL_MS / 1000}s while sessions are running.
            </div>
          )}
          {sessions.map((s) => {
            const l = live[s.id];
            return (
              <div key={s.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={stateTone(s.state)} className="capitalize">{s.state}</Badge>
                    {s.state === 'launched' && (l?.sessionState || s.session_state) && (
                      <Badge variant={liveTone(l?.sessionState ?? s.session_state)} className="capitalize">
                        {prettyLiveState(l?.sessionState ?? s.session_state)}
                      </Badge>
                    )}
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
                    {(() => {
                      const url = l?.sessionUrl ?? s.session_url;
                      return url && url.startsWith('https://') ? (
                        <a href={url} target="_blank" rel="noopener noreferrer"
                           className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                          Open in Jules <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null;
                    })()}
                    {l?.pullRequestUrl && l.pullRequestUrl.startsWith('https://') && (
                      <a href={l.pullRequestUrl} target="_blank" rel="noopener noreferrer"
                         className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                        <GitPullRequest className="h-3.5 w-3.5" /> View PR
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default JulesOperationsPage;
