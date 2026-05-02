import { Skeleton } from '@client/components/shared/skeleton';
import { Card, CardContent } from '@client/components/ui/card';

interface JobDetailSkeletonProps {
  error: string | null;
}

export function JobDetailSkeleton({ error }: JobDetailSkeletonProps) {
  return (
    <section className="flex flex-col gap-6">
      {error && (
        <div
          className="rounded-md border px-4 py-3 text-sm"
          style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-border)', color: 'var(--danger)' }}
        >
          {error}
        </div>
      )}
      <header className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton width={120} height="0.75rem" />
          <Skeleton width={280} height="2rem" />
          <Skeleton width={200} height="0.9rem" />
        </div>
        <Skeleton width={100} height="2.25rem" borderRadius={12} />
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card><CardContent className="p-5 space-y-3">
          <Skeleton width="50%" height="1.2rem" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton width={60} height="0.65rem" />
              <Skeleton width={100} height="1rem" />
            </div>
          ))}
        </CardContent></Card>
        <Card><CardContent className="p-5 space-y-3">
          <Skeleton width="50%" height="1.2rem" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between rounded-md bg-muted/30 px-4 py-3">
              <div className="flex items-center gap-3">
                <Skeleton width={12} height={12} borderRadius="50%" />
                <Skeleton width={120} height="0.9rem" />
              </div>
              <Skeleton width={40} height="0.75rem" />
            </div>
          ))}
        </CardContent></Card>
      </div>
    </section>
  );
}
