import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type FleetJobDto } from '@client/lib/api';
import { Canvas } from '@client/components/ai-elements/canvas';
import { Edge } from '@client/components/ai-elements/edge';
import { Node, NodeHeader, NodeTitle, NodeDescription, NodeContent, NodeFooter } from '@client/components/ai-elements/node';
import { PageHeader } from '@client/components/layout/page-header';
import { Alert } from '@client/components/ui/alert';
import type { Node as FlowNode, Edge as FlowEdge } from '@xyflow/react';

const POLL_MS = 20000;
const ACTIVE_FLEET = new Set(['queued', 'running']);

type StageData = { label: string; description: string; count: number; hint: string; tone: 'default' | 'success' | 'danger' | 'info' | 'muted'; handles: { source: boolean; target: boolean } };

const nodeTypes = {
  stage: ({ data }: { data: StageData }) => (
    <Node handles={data.handles} tone={data.tone}>
      <NodeHeader>
        <NodeTitle>{data.label}</NodeTitle>
        <NodeDescription>{data.description}</NodeDescription>
      </NodeHeader>
      <NodeContent>
        <div className="text-2xl font-semibold tabular-nums">{data.count}</div>
      </NodeContent>
      <NodeFooter>{data.hint}</NodeFooter>
    </Node>
  ),
};

const edgeTypes = { animated: Edge.Animated, temporary: Edge.Temporary };

/**
 * JulesWorkflowPage
 */
export function JulesWorkflowPage() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [fleet, setFleet] = useState<FleetJobDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const load = () => Promise.all([api.getOrchestrationSummary(), api.getFleetJobs()])
      .then(([s, f]) => { if (mounted.current) { setCounts(s.summary.counts ?? {}); setFleet(f.jobs ?? []); setError(null); } })
      .catch((e) => { if (mounted.current) setError(e instanceof Error ? e.message : 'Failed to load workflow.'); });
    /**
     * load
     */
    load();
    const id = setInterval(load, POLL_MS);
    return () => { mounted.current = false; clearInterval(id); };
  }, []);

  const { nodes, edges } = useMemo(() => {
    const c = counts;
    const activeSessions = (c.planning ?? 0) + (c.plan_review ?? 0) + (c.awaiting_feedback ?? 0) + (c.executing ?? 0);
    const activeFleet = fleet.filter((j) => ACTIVE_FLEET.has(j.status));
    const dispatchCount = activeFleet.filter((j) => j.kind === 'analyze' || j.kind === 'dispatch' || j.kind === 'init').length;
    const mergeCount = activeFleet.filter((j) => j.kind === 'merge').length;
    const done = (c.pr_ready ?? 0) + (c.accepted ?? 0);
    const attention = (c.stuck ?? 0) + (c.failed ?? 0);

    const stage = (id: string, x: number, y: number, data: StageData): FlowNode => ({ id, type: 'stage', position: { x, y }, data: data as unknown as Record<string, unknown> });
    const nodes: FlowNode[] = [
      stage('sessions', 0, 0, { label: 'Jules Sessions', description: 'Planning + executing', count: activeSessions, hint: 'active orchestration tasks', tone: 'info', handles: { source: true, target: false } }),
      stage('review', 320, 0, { label: 'Codra Review', description: 'Kimi 2.7 reviews the plan', count: c.plan_review ?? 0, hint: 'awaiting plan approval', tone: 'info', handles: { source: true, target: true } }),
      stage('fleet', 640, 0, { label: 'Fleet Dispatch', description: 'analyze / dispatch (off-Worker)', count: dispatchCount, hint: 'fleet jobs queued/running', tone: 'info', handles: { source: true, target: true } }),
      stage('merge', 960, 0, { label: 'Merge Review', description: 'codra approves before merge', count: mergeCount, hint: 'merge jobs (circuit-broken)', tone: 'info', handles: { source: true, target: true } }),
      stage('done', 1280, 0, { label: 'PR / Accepted', description: 'shipped or accepted plan', count: done, hint: 'pr_ready + accepted', tone: 'success', handles: { source: false, target: true } }),
      stage('attention', 960, 240, { label: 'Needs Attention', description: 'stuck or failed', count: attention, hint: 'human intervention', tone: attention > 0 ? 'danger' : 'muted', handles: { source: false, target: true } }),
    ];
    const edges: FlowEdge[] = [
      { id: 'e1', source: 'sessions', target: 'review', type: 'animated' },
      { id: 'e2', source: 'review', target: 'fleet', type: 'animated' },
      { id: 'e3', source: 'fleet', target: 'merge', type: 'animated' },
      { id: 'e4', source: 'merge', target: 'done', type: 'animated' },
      { id: 'e5', source: 'review', target: 'attention', type: 'temporary' },
      { id: 'e6', source: 'merge', target: 'attention', type: 'temporary' },
    ];
    return { nodes, edges };
  }, [counts, fleet]);

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        category="Integrations"
        title="Jules workflow"
        description="Live orchestration pipeline — Jules sessions, codra reviews, fleet jobs, and gated merges. Stages show counts from cached D1 data; fleet/merge run off-Worker."
      />
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="min-h-[520px] flex-1 rounded-lg border border-border">
        <Canvas nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} />
      </div>
    </div>
  );
}
