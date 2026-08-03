import type { ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { cn } from '@client/lib/utils';

/** Vendored ai-elements Node primitives (codra-styled). */
export function Node({
  handles, tone, children, className,
}: {
  handles?: { source?: boolean; target?: boolean };
  tone?: 'default' | 'success' | 'danger' | 'info' | 'muted';
  children: ReactNode;
  className?: string;
}) {
  const toneRing =
    tone === 'success' ? 'border-emerald-500/60' :
    tone === 'danger' ? 'border-destructive/60' :
    tone === 'info' ? 'border-sky-500/60' :
    tone === 'muted' ? 'border-border' : 'border-border';
  return (
    <div className={cn('min-w-[200px] rounded-lg border bg-card shadow-sm', toneRing, className)}>
      {handles?.target && <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />}
      {children}
      {handles?.source && <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />}
    </div>
  );
}

export function NodeHeader({ children }: { children: ReactNode }) {
  return <div className="border-b border-border px-3 py-2">{children}</div>;
}
export function NodeTitle({ children }: { children: ReactNode }) {
  return <div className="text-sm font-semibold">{children}</div>;
}
export function NodeDescription({ children }: { children: ReactNode }) {
  return <div className="text-xs text-muted-foreground">{children}</div>;
}
export function NodeContent({ children }: { children: ReactNode }) {
  return <div className="px-3 py-2">{children}</div>;
}
export function NodeFooter({ children }: { children: ReactNode }) {
  return <div className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">{children}</div>;
}
