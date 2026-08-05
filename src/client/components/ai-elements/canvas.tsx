import { ReactFlow, Background, Controls, type ReactFlowProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

/**
 * Vendored ai-elements Canvas, backed by @xyflow/react (Vite-safe — no Next/RSC).
 * Thin wrapper: nodes/edges/nodeTypes/edgeTypes are passed through.
 */
export function Canvas(props: ReactFlowProps) {
  return (
    <ReactFlow proOptions={{ hideAttribution: true }} fitView {...props}>
      <Background gap={20} className="!bg-muted/20" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
