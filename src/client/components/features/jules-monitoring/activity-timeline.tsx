import {
  Bot,
  Check,
  CircleDot,
  FileCode2,
  GitPullRequest,
  ListChecks,
  MessageSquare,
  TerminalSquare,
  UserRound,
  XCircle,
} from 'lucide-react';
import { Badge } from '@client/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@client/components/ui/card';
import { EmptyState } from '@client/components/shared/empty-state';
import { SkeletonCard } from '@client/components/shared/skeleton';
import { formatDateTime } from '@client/lib/format';
import type { JulesActivity, JulesArtifact, JulesMonitorEvent } from './client';
import { activityLabel } from './status';

function ActivityIcon({ activity }: { activity: JulesActivity }) {
  const className = 'h-4 w-4';
  if (activity.type === 'userMessaged') return <UserRound className={className} />;
  if (activity.type === 'agentMessaged') return <Bot className={className} />;
  if (activity.type === 'planGenerated') return <ListChecks className={className} />;
  if (activity.type === 'planApproved') return <Check className={className} />;
  if (activity.type === 'sessionCompleted') return <Check className={className} />;
  if (activity.type === 'sessionFailed') return <XCircle className={className} />;
  return <CircleDot className={className} />;
}
function ArtifactSummary({ artifact }: { artifact: JulesArtifact }) {
  if (artifact.type === 'bashOutput') {
    return (
      <details className="rounded-md border border-border bg-code-bg p-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-code-fg">
          <TerminalSquare className="h-4 w-4" />{artifact.command || artifact.label || 'Command output'}
          {artifact.exitCode != null && <Badge variant={artifact.exitCode === 0 ? 'success' : 'danger'}>exit {artifact.exitCode}</Badge>}
        </summary>
        {artifact.output && <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-code-fg">{artifact.output}</pre>}
      </details>
    );
  }
  if (artifact.type === 'changeSet') {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary/35 p-3 text-xs text-muted-foreground">
        <FileCode2 className="h-4 w-4 text-primary" />
        <span className="font-medium text-foreground">{artifact.label || 'Code changes'}</span>
        {artifact.files != null && <span>{artifact.files} files</span>}
        {artifact.additions != null && <span className="text-success">+{artifact.additions}</span>}
        {artifact.deletions != null && <span className="text-danger">-{artifact.deletions}</span>}
      </div>
    );
  }
  return <div className="rounded-md border border-border bg-secondary/35 p-3 text-xs text-muted-foreground">{artifact.summary || artifact.label || artifact.type}</div>;
}

function ActivityBody({ activity }: { activity: JulesActivity }) {
  if (activity.type === 'planGenerated' && activity.plan) {
    return (
      <ol className="space-y-2">
        {activity.plan.steps.map((step, index) => (
          <li key={step.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 text-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{step.index ?? index + 1}</span>
            <div><p className="font-medium text-foreground">{step.title}</p>{step.description && <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>}</div>
          </li>
        ))}
      </ol>
    );
  }
  const content = activity.message || activity.description || activity.title || activity.reason;
  return content ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{content}</p> : null;
}

export function JulesActivityTimeline({ activities, loading }: { activities: JulesActivity[]; loading: boolean }) {
  if (loading) return <div className="space-y-3" aria-busy="true">{Array.from({ length: 3 }).map((_, index) => <SkeletonCard key={index} lines={2} />)}</div>;
  if (activities.length === 0) return <EmptyState icon={<MessageSquare />} title="No Jules activity yet" description="Activity appears after the session starts producing messages, plans, and progress updates." className="py-10" />;

  return (
    <ol className="relative space-y-3 before:absolute before:bottom-5 before:left-[1.1rem] before:top-5 before:w-px before:bg-border" aria-label="Jules activity timeline">
      {activities.map((activity) => (
        <li key={activity.id} className="relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3">
          <span className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-primary"><ActivityIcon activity={activity} /></span>
          <Card className="min-w-0">
            <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
              <div className="min-w-0"><CardTitle>{activityLabel(activity.type)}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{activity.originator} · {formatDateTime(activity.createTime)}</p></div>
              {activity.type === 'sessionCompleted' && <Badge variant="success">Complete</Badge>}
              {activity.type === 'sessionFailed' && <Badge variant="danger">Failed</Badge>}
            </CardHeader>
            <CardContent className="space-y-3"><ActivityBody activity={activity} />{activity.artifacts.map((artifact, index) => <ArtifactSummary key={`${activity.id}-${index}`} artifact={artifact} />)}</CardContent>
          </Card>
        </li>
      ))}
    </ol>
  );
}

export function CodraEventTimeline({ events }: { events: JulesMonitorEvent[] }) {
  if (events.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No Codra orchestration events recorded.</p>;
  return (
    <ol className="space-y-3" aria-label="Codra orchestration events">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3 text-sm">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-medium text-foreground">{event.event.replace(/_/g, ' ').toLowerCase()}</span><time className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</time></div>{event.summary && <p className="mt-1 text-xs text-muted-foreground">{event.summary}</p>}</div>
        </li>
      ))}
    </ol>
  );
}
