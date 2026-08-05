import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Bot, ExternalLink, GitPullRequest, ServerCog } from 'lucide-react';
import { Alert } from '@client/components/ui/alert';
import { Badge } from '@client/components/ui/badge';
import { Button } from '@client/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@client/components/ui/card';
import { PageHeader } from '@client/components/layout/page-header';
import { SkeletonCard } from '@client/components/shared/skeleton';
import { formatDateTime } from '@client/lib/format';
import { CodraEventTimeline, JulesActivityTimeline } from '@client/components/features/jules-monitoring/activity-timeline';
import { JulesStatusBadge } from '@client/components/features/jules-monitoring/status';
import {
  julesMonitoringClient,
  type JulesActivity,
  type JulesMonitorEvent,
  type JulesMonitorHealth,
  type JulesMonitorTask,
} from '@client/components/features/jules-monitoring/client';

const REFRESH_MS = 20_000;

/**
 * JulesSessionDetailPage
 */
export function JulesSessionDetailPage() {
  const { taskId = '' } = useParams();
  const [task, setTask] = useState<JulesMonitorTask | null>(null);
  const [health, setHealth] = useState<JulesMonitorHealth | null>(null);
  const [activities, setActivities] = useState<JulesActivity[]>([]);
  const [events, setEvents] = useState<JulesMonitorEvent[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (background = false) => {
    if (!taskId) return;
    if (!background) setLoading(true);
    const results = await Promise.allSettled([
      julesMonitoringClient.getTask(taskId),
      julesMonitoringClient.listEvents(taskId),
      julesMonitoringClient.listActivities(taskId),
    ]);
    const [taskResult, eventsResult, activityResult] = results;
    if (taskResult.status === 'fulfilled') {
      setTask(taskResult.value.task);
      setHealth(taskResult.value.health);
      setError(null);
    } else {
      setError(taskResult.reason instanceof Error ? taskResult.reason.message : 'The session could not be loaded.');
    }
    if (eventsResult.status === 'fulfilled') setEvents(eventsResult.value.events);
    if (activityResult.status === 'fulfilled') {
      setActivities(activityResult.value.activities);
      setSyncedAt(activityResult.value.syncedAt);
    }
    setLoading(false);
  }, [taskId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(true); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!taskId) return <Alert variant="destructive">A Jules task id is required.</Alert>;

  return (
    <div className="space-y-6">
      <Link to="/jules/monitor" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Back to sessions</Link>

      <PageHeader
        title={task?.packageTitle ?? 'Session details'}
        description={task ? `${task.repository} · ${task.sessionId ?? 'Session not started'}` : 'Loading session metadata and activity.'}
      />

      {error && <Alert variant="destructive"><p className="font-semibold">Session could not be loaded</p><p className="mt-1 text-sm">{error}</p></Alert>}

      {loading && !task ? (
        <div className="grid gap-3 md:grid-cols-3" aria-busy="true">{Array.from({ length: 3 }).map((_, index) => <SkeletonCard key={index} lines={2} />)}</div>
      ) : task ? (
        <>
          <section aria-label="Session summary" className="grid gap-3 md:grid-cols-3">
            <Card><CardHeader><CardTitle>Current state</CardTitle></CardHeader><CardContent className="space-y-2"><JulesStatusBadge status={task.status} /><p className="text-xs text-muted-foreground">Updated {formatDateTime(task.updatedAt)}</p></CardContent></Card>
            <Card><CardHeader><CardTitle>Orchestration</CardTitle></CardHeader><CardContent><div className="flex items-center gap-2 text-sm font-medium"><ServerCog className="h-4 w-4 text-primary" />{health?.mode === 'external_watcher' ? 'External watcher' : health?.mode === 'hybrid' ? 'Watcher + cron fallback' : 'Cron fallback'}</div><p className="mt-2 text-xs text-muted-foreground">Iteration {task.iterations} · activity synced {formatDateTime(syncedAt)}</p></CardContent></Card>
            <Card><CardHeader><CardTitle>Session links</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2">{task.sessionUrl && <Button variant="outline" size="sm" asChild><a href={task.sessionUrl} target="_blank" rel="noopener noreferrer"><Bot />Open Jules<ExternalLink /></a></Button>}{task.lastPrUrl && <Button variant="outline" size="sm" asChild><a href={task.lastPrUrl} target="_blank" rel="noopener noreferrer"><GitPullRequest />Open pull request<ExternalLink /></a></Button>}{!task.sessionUrl && !task.lastPrUrl && <p className="text-sm text-muted-foreground">No external links yet.</p>}</CardContent></Card>
          </section>

          {task.error && <Alert variant="destructive"><p className="font-semibold">This session needs attention</p><p className="mt-1 text-sm">{task.error}</p></Alert>}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(18rem,.75fr)]">
            <section aria-labelledby="activity-heading" className="space-y-3"><h2 id="activity-heading" className="text-lg font-semibold text-foreground">Jules activity</h2><JulesActivityTimeline activities={activities} loading={loading} /></section>
            <aside className="space-y-3" aria-labelledby="events-heading"><h2 id="events-heading" className="text-lg font-semibold text-foreground">Codra events</h2><Card><CardContent className="pt-5"><CodraEventTimeline events={events} /></CardContent></Card><Card><CardHeader><CardTitle>Task identity</CardTitle></CardHeader><CardContent className="space-y-3 text-xs"><div><span className="text-muted-foreground">Task</span><p className="mt-1 break-all font-mono text-foreground">{task.taskId}</p></div><div><span className="text-muted-foreground">Package</span><p className="mt-1 break-all font-mono text-foreground">{task.packageId}</p></div>{task.sessionId && <div><span className="text-muted-foreground">Jules session</span><p className="mt-1 break-all font-mono text-foreground">{task.sessionId}</p></div>}<div><span className="text-muted-foreground">Created</span><p className="mt-1 text-foreground">{formatDateTime(task.createdAt)}</p></div>{task.lastPrUrl && <Badge variant="success">Pull request available</Badge>}</CardContent></Card></aside>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default JulesSessionDetailPage;
