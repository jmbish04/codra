import React from 'react';
import { cn } from '@client/lib/utils';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
  style?: React.CSSProperties;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width,
  height,
  borderRadius,
  className = '',
  style,
}) => {
  return (
    <div
      className={cn('skeleton', className)}
      style={{
        width: width ?? '100%',
        height: height ?? '1rem',
        borderRadius: borderRadius ?? undefined,
        ...style,
      }}
    />
  );
};

/** A full Skeleton card placeholder for loading states */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-md border border-border/60 bg-card/80 p-5 space-y-3">
      <Skeleton height="1.25rem" width="45%" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height="0.9rem" width={`${70 - i * 10}%`} />
      ))}
    </div>
  );
}
