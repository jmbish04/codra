import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

/**
 * bezier
 */
function bezier(props: EdgeProps) {
  const [path] = getBezierPath({
    sourceX: props.sourceX, sourceY: props.sourceY, sourcePosition: props.sourcePosition,
    targetX: props.targetX, targetY: props.targetY, targetPosition: props.targetPosition,
  });
  return path;
}

/** Vendored ai-elements Edge variants. */
export const Edge = {
  Animated(props: EdgeProps) {
    return (
      <BaseEdge
        id={props.id}
        path={bezier(props)}
        style={{ stroke: 'var(--color-muted-foreground, #94a3b8)', strokeWidth: 1.5, strokeDasharray: 6, animation: 'ai-dash 0.6s linear infinite' }}
      />
    );
  },
  Temporary(props: EdgeProps) {
    return (
      <BaseEdge
        id={props.id}
        path={bezier(props)}
        style={{ stroke: 'var(--color-border, #cbd5e1)', strokeWidth: 1.5, strokeDasharray: 4, opacity: 0.5 }}
      />
    );
  },
};
