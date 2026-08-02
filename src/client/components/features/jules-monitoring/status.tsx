import { Badge, type BadgeProps } from '@client/components/ui/badge';
import type { JulesActivityType, JulesMonitorStatus } from './client';

const ACTIVE_STATUSES = new Set<JulesMonitorStatus>([
  'pending',
  'planning',
  'plan_review',
  'awaiting_feedback',
  'executing',
]);

export function isActiveJulesStatus(status: JulesMonitorStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}
export function monitorStatusLabel(status: JulesMonitorStatus): string {
  const labels: Record<JulesMonitorStatus, string> = {
    pending: 'Pending',
    planning: 'Planning',
    plan_review: 'Plan review',
    awaiting_feedback: 'Awaiting feedback',
    executing: 'Executing',
    pr_ready: 'PR ready',
    accepted: 'Accepted',
    stuck: 'Stuck',
    failed: 'Failed',
  };
  return labels[status];
}

function monitorStatusTone(status: JulesMonitorStatus): NonNullable<BadgeProps['variant']> {
  if (status === 'accepted') return 'success';
  if (status === 'pr_ready') return 'default';
  if (status === 'stuck') return 'warning';
  if (status === 'failed') return 'danger';
  if (status === 'pending') return 'neutral';
  return 'info';
}

export function JulesStatusBadge({ status }: { status: JulesMonitorStatus }) {
  return (
    <Badge variant={monitorStatusTone(status)}>
      {isActiveJulesStatus(status) && (
        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse" aria-hidden="true" />
      )}
      {monitorStatusLabel(status)}
    </Badge>
  );
}

export function activityLabel(type: JulesActivityType): string {
  const labels: Record<string, string> = {
    userMessaged: 'User message',
    agentMessaged: 'Agent message',
    planGenerated: 'Plan generated',
    planApproved: 'Plan approved',
    progressUpdated: 'Progress update',
    sessionCompleted: 'Session completed',
    sessionFailed: 'Session failed',
  };
  return labels[type] ?? type.replace(/([a-z])([A-Z])/g, '$1 $2');
}
